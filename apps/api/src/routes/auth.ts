import type { FastifyInstance } from "fastify";
import {
  PERMISSIONS, ROLE_LABELS, SECTOR_PROFILES, maxDiscountBps, permissionsFor, type Role
} from "@cooffeup/shared";
import { z } from "zod";
import { accessOf, actor, audit, authenticate, fail, newId, now, parse, requirePermission, type AppContext } from "../context.js";
import { hashPin, verifyPin } from "../security.js";
import type { StaffMember } from "../store.js";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;
const TOKEN_TTL_SECONDS = 12 * 3600;

const roleSchema = z.enum(Object.keys(ROLE_LABELS) as [Role, ...Role[]]);
const permissionSchema = z.enum(PERMISSIONS);
const pinSchema = z.string().regex(/^\d{4,8}$/, "PIN must be 4-8 digits");

export function publicStaff(staff: StaffMember) {
  const access = accessOf(staff);
  return {
    id: staff.id, name: staff.name, role: staff.role, roleLabel: ROLE_LABELS[staff.role], active: staff.active,
    grants: staff.grants, revokes: staff.revokes, maxDiscountBps: maxDiscountBps(access), permissions: [...permissionsFor(access)]
  };
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;
  const auth = authenticate(ctx);

  app.get("/api/v1/auth/staff-directory", async () => ({
    data: [...store.staff.values()].filter((staff) => staff.active).map((staff) => ({ id: staff.id, name: staff.name, roleLabel: ROLE_LABELS[staff.role] }))
  }));

  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = parse(z.object({ staffId: z.string().min(1), pin: z.string().min(1).max(12) }), request.body);
    const staff = store.staff.get(body.staffId);
    if (!staff || !staff.active) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    if (staff.lockedUntil && staff.lockedUntil > now()) return reply.code(423).send({ error: "ACCOUNT_LOCKED", until: staff.lockedUntil });
    if (!verifyPin(body.pin, staff.pinHash)) {
      staff.failedAttempts += 1;
      if (staff.failedAttempts >= MAX_ATTEMPTS) {
        staff.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
        staff.failedAttempts = 0;
      }
      audit(ctx, request, "auth.failed", { type: "staff", id: staff.id });
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }
    staff.failedAttempts = 0;
    staff.lockedUntil = undefined;
    audit(ctx, request, "auth.login", { type: "staff", id: staff.id });
    return { token: ctx.crypto.signToken({ sub: staff.id, ver: staff.tokenVersion }, TOKEN_TTL_SECONDS), staff: publicStaff(staff) };
  });

  app.get("/api/v1/auth/me", { preHandler: auth }, async (request) => ({ staff: publicStaff(actor(request)) }));

  app.get("/api/v1/settings", { preHandler: auth }, async () => {
    const profile = SECTOR_PROFILES[store.settings.businessType];
    return { data: { ...store.settings, sector: profile, sectors: SECTOR_PROFILES } };
  });

  app.patch("/api/v1/settings", { preHandler: [auth, requirePermission(ctx, "staff.manage")] }, async (request) => {
    const body = parse(z.object({
      businessType: z.enum(Object.keys(SECTOR_PROFILES) as [keyof typeof SECTOR_PROFILES, ...Array<keyof typeof SECTOR_PROFILES>]).optional(),
      sellerName: z.string().min(2).max(120).optional(),
      sellerVat: z.string().regex(/^3\d{13}3$/).optional(),
      branchName: z.string().min(1).max(120).optional(),
      requireOpenShift: z.boolean().optional()
    }), request.body);
    Object.assign(store.settings, body);
    audit(ctx, request, "settings.updated", { type: "settings" }, body);
    return { data: store.settings };
  });

  const staffGuard = { preHandler: [auth, requirePermission(ctx, "staff.manage")] };

  app.get("/api/v1/staff", staffGuard, async () => ({ data: [...store.staff.values()].map(publicStaff), roles: ROLE_LABELS }));

  app.post("/api/v1/staff", staffGuard, async (request, reply) => {
    const body = parse(z.object({
      name: z.string().min(2).max(80), role: roleSchema, pin: pinSchema,
      grants: z.array(permissionSchema).default([]), revokes: z.array(permissionSchema).default([]),
      maxDiscountBps: z.number().int().min(0).max(10_000).optional()
    }), request.body);
    if (body.role === "owner" && actor(request).role !== "owner") fail(403, "ONLY_OWNER_CAN_CREATE_OWNER");
    const staff: StaffMember = {
      id: newId(), name: body.name, role: body.role, pinHash: hashPin(body.pin), grants: body.grants, revokes: body.revokes,
      maxDiscountBps: body.maxDiscountBps, active: true, failedAttempts: 0, tokenVersion: 1
    };
    store.staff.set(staff.id, staff);
    audit(ctx, request, "staff.created", { type: "staff", id: staff.id }, { role: staff.role });
    return reply.code(201).send({ data: publicStaff(staff) });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/staff/:id", staffGuard, async (request) => {
    const staff = store.staff.get(request.params.id) ?? fail(404, "STAFF_NOT_FOUND");
    const body = parse(z.object({
      name: z.string().min(2).max(80).optional(), role: roleSchema.optional(), pin: pinSchema.optional(), active: z.boolean().optional(),
      grants: z.array(permissionSchema).optional(), revokes: z.array(permissionSchema).optional(),
      maxDiscountBps: z.number().int().min(0).max(10_000).nullable().optional()
    }), request.body);
    const me = actor(request);
    if ((staff.role === "owner" || body.role === "owner") && me.role !== "owner") fail(403, "ONLY_OWNER_CAN_CHANGE_OWNER");
    if (staff.id === me.id && (body.active === false || (body.role && body.role !== me.role))) fail(422, "CANNOT_DEMOTE_SELF");
    if (body.name) staff.name = body.name;
    if (body.role) staff.role = body.role;
    if (body.pin) staff.pinHash = hashPin(body.pin);
    if (body.active !== undefined) staff.active = body.active;
    if (body.grants) staff.grants = body.grants;
    if (body.revokes) staff.revokes = body.revokes;
    if (body.maxDiscountBps !== undefined) staff.maxDiscountBps = body.maxDiscountBps ?? undefined;
    // Any change to access invalidates existing sessions for that member.
    staff.tokenVersion += 1;
    audit(ctx, request, "staff.updated", { type: "staff", id: staff.id }, { ...body, pin: body.pin ? "***" : undefined });
    return { data: publicStaff(staff) };
  });

  app.get("/api/v1/audit", staffGuard, async (request) => {
    const query = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), request.query);
    return { data: store.audit.slice(-query.limit).reverse() };
  });
}
