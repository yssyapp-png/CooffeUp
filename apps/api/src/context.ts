import type { FastifyReply, FastifyRequest } from "fastify";
import { can, type Permission, type StaffAccess } from "@cooffeup/shared";
import type { z } from "zod";
import type { AppConfig } from "./config.js";
import type { Crypto } from "./security.js";
import { MAIN_BRANCH_ID, type StaffMember, type Store } from "./store.js";

declare module "fastify" {
  interface FastifyRequest {
    staff?: StaffMember;
    /** Branch the request acts on: the `x-branch-id` header, else the staff member's home branch. */
    branchId?: string;
    rawBody?: string;
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface AppContext {
  store: Store;
  config: AppConfig;
  crypto: Crypto;
  fetch: FetchLike;
  /** Runs background work (webhook deliveries, store sync, SMS) after `delay` ms; cleared on shutdown. */
  schedule(task: () => Promise<void>, delay?: number): void;
  /** Resolves when every scheduled task that is currently due has finished (used by tests). */
  flush(): Promise<void>;
}

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

export const accessOf = (staff: StaffMember): StaffAccess => ({ role: staff.role, grants: staff.grants, revokes: staff.revokes, maxDiscountBps: staff.maxDiscountBps });
export const staffCan = (staff: StaffMember, permission: Permission) => can(accessOf(staff), permission);

/** The authenticated staff member; only call inside routes protected by `authenticate`. */
export const actor = (request: FastifyRequest) => request.staff!;
export const branchOf = (request: FastifyRequest) => request.branchId ?? MAIN_BRANCH_ID;

export function audit(ctx: AppContext, request: FastifyRequest | undefined, action: string, target?: { type: string; id?: string }, details?: Record<string, unknown>) {
  ctx.store.audit.push({ id: newId(), staffId: request?.staff?.id, action, targetType: target?.type, targetId: target?.id, details, ip: request?.ip, createdAt: now() });
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, public details?: Record<string, unknown>) {
    super(code);
  }
}

export const fail = (status: number, code: string, details?: Record<string, unknown>): never => {
  throw new HttpError(status, code, details);
};

export function authenticate(ctx: AppContext) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const claims = token ? ctx.crypto.verifyToken<{ sub: string; ver: number }>(token) : null;
    const staff = claims ? ctx.store.staff.get(claims.sub) : undefined;
    if (!staff || !staff.active || staff.tokenVersion !== claims!.ver) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    request.staff = staff;
    const requested = request.headers["x-branch-id"];
    const branchId = typeof requested === "string" && requested ? requested : staff.branchId ?? MAIN_BRANCH_ID;
    if (!ctx.store.branches.has(branchId)) return reply.code(404).send({ error: "BRANCH_NOT_FOUND" });
    if (staff.branchId && staff.branchId !== branchId) return reply.code(403).send({ error: "BRANCH_NOT_ALLOWED" });
    request.branchId = branchId;
  };
}

export function requirePermission(ctx: AppContext, ...permissions: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const staff = request.staff;
    const missing = permissions.filter((permission) => !staff || !staffCan(staff, permission));
    if (missing.length) {
      audit(ctx, request, "permission.denied", { type: "route", id: request.routeOptions.url }, { missing });
      return reply.code(403).send({ error: "FORBIDDEN", missing });
    }
  };
}

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) return fail(422, "VALIDATION_FAILED", { issues: result.error.issues });
  return result.data;
}

export const guarded = (ctx: AppContext, ...permissions: Permission[]) => ({ preHandler: [authenticate(ctx), requirePermission(ctx, ...permissions)] });
