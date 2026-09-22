import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { orders } from "./store.js";
import {
  activeShiftForCashier,
  cashMovements,
  expectedCashForShift,
  refundedAmount,
  refunds,
  shifts,
  suspendedOrders,
  type CashMovement,
  type Refund,
  type Shift,
  type SuspendedOrder
} from "./operations.js";

const money = z.number().int().nonnegative().max(100_000_000);
const identity = z.string().trim().min(1).max(100);
const reason = z.string().trim().min(3).max(250);

const openShiftSchema = z.object({ cashierId: identity, openingFloat: money });
const closeShiftSchema = z.object({ countedCash: money });
const movementSchema = z.object({ type: z.enum(["cash_in", "cash_out"]), amount: money.positive(), reason, actorId: identity });
const suspendedOrderSchema = z.object({
  shiftId: z.string().uuid(),
  type: z.enum(["dine_in", "takeaway", "delivery"]),
  lines: z.array(z.object({
    productId: identity,
    quantity: z.number().int().positive().max(99),
    discount: money.optional(),
    notes: z.string().trim().max(250).optional()
  })).min(1).max(100),
  note: z.string().trim().max(250).optional(),
  suspendedBy: identity
});
const refundSchema = z.object({ amount: money.positive(), method: z.enum(["cash", "card", "mada", "apple_pay", "stc_pay"]), reason });

function managerIdentity(request: FastifyRequest) {
  const configuredToken = process.env.MANAGER_APPROVAL_TOKEN;
  const token = request.headers["x-manager-approval-token"];
  const actorId = request.headers["x-actor-id"];
  const role = request.headers["x-actor-role"];
  if (!configuredToken || token !== configuredToken || role !== "manager" || typeof actorId !== "string" || !actorId.trim()) return null;
  return actorId.trim();
}

export async function registerOperationsRoutes(app: FastifyInstance) {
  app.get("/api/v1/shifts", async () => ({ data: [...shifts.values()].slice(-50).reverse() }));

  app.post("/api/v1/shifts/open", async (request, reply) => {
    const parsed = openShiftSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_SHIFT", issues: parsed.error.issues });
    const existing = activeShiftForCashier(parsed.data.cashierId);
    if (existing) return reply.code(409).send({ error: "SHIFT_ALREADY_OPEN", shiftId: existing.id });
    const shift: Shift = { id: crypto.randomUUID(), ...parsed.data, status: "open", openedAt: new Date().toISOString() };
    shifts.set(shift.id, shift);
    return reply.code(201).send({ data: shift });
  });

  app.post("/api/v1/shifts/:shiftId/movements", async (request, reply) => {
    const shiftId = z.string().uuid().safeParse((request.params as { shiftId?: string }).shiftId);
    const parsed = movementSchema.safeParse(request.body);
    if (!shiftId.success || !parsed.success) return reply.code(422).send({ error: "INVALID_CASH_MOVEMENT" });
    const shift = shifts.get(shiftId.data);
    if (!shift) return reply.code(404).send({ error: "SHIFT_NOT_FOUND" });
    if (shift.status !== "open") return reply.code(409).send({ error: "SHIFT_CLOSED" });
    const movement: CashMovement = { id: crypto.randomUUID(), shiftId: shift.id, ...parsed.data, createdAt: new Date().toISOString() };
    cashMovements.set(movement.id, movement);
    return reply.code(201).send({ data: movement });
  });

  app.post("/api/v1/shifts/:shiftId/close", async (request, reply) => {
    const shiftId = z.string().uuid().safeParse((request.params as { shiftId?: string }).shiftId);
    const parsed = closeShiftSchema.safeParse(request.body);
    if (!shiftId.success || !parsed.success) return reply.code(422).send({ error: "INVALID_SHIFT_CLOSE" });
    const shift = shifts.get(shiftId.data);
    if (!shift) return reply.code(404).send({ error: "SHIFT_NOT_FOUND" });
    if (shift.status !== "open") return reply.code(409).send({ error: "SHIFT_ALREADY_CLOSED" });
    const cashSales = [...orders.values()]
      .filter((order) => order.shiftId === shift.id)
      .flatMap((order) => order.payments)
      .filter((payment) => payment.method === "cash")
      .reduce((sum, payment) => sum + payment.amount, 0);
    const expectedCash = expectedCashForShift(shift, cashSales);
    Object.assign(shift, { status: "closed" as const, closedAt: new Date().toISOString(), expectedCash, countedCash: parsed.data.countedCash, variance: parsed.data.countedCash - expectedCash });
    return reply.send({ data: shift });
  });

  app.get("/api/v1/suspended-orders", async () => ({ data: [...suspendedOrders.values()].filter((order) => !order.resumedAt) }));

  app.post("/api/v1/suspended-orders", async (request, reply) => {
    const parsed = suspendedOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_SUSPENDED_ORDER", issues: parsed.error.issues });
    const shift = shifts.get(parsed.data.shiftId);
    if (!shift) return reply.code(404).send({ error: "SHIFT_NOT_FOUND" });
    if (shift.status !== "open") return reply.code(409).send({ error: "SHIFT_CLOSED" });
    const suspended: SuspendedOrder = { id: crypto.randomUUID(), ...parsed.data, suspendedAt: new Date().toISOString() };
    suspendedOrders.set(suspended.id, suspended);
    return reply.code(201).send({ data: suspended });
  });

  app.post("/api/v1/suspended-orders/:orderId/resume", async (request, reply) => {
    const orderId = z.string().uuid().safeParse((request.params as { orderId?: string }).orderId);
    if (!orderId.success) return reply.code(422).send({ error: "INVALID_SUSPENDED_ORDER_ID" });
    const suspended = suspendedOrders.get(orderId.data);
    if (!suspended) return reply.code(404).send({ error: "SUSPENDED_ORDER_NOT_FOUND" });
    if (suspended.resumedAt) return reply.code(409).send({ error: "SUSPENDED_ORDER_ALREADY_RESUMED" });
    suspended.resumedAt = new Date().toISOString();
    return reply.send({ data: suspended });
  });

  app.post("/api/v1/orders/:orderId/refunds", async (request, reply) => {
    const approvedBy = managerIdentity(request);
    if (!approvedBy) return reply.code(403).send({ error: "MANAGER_APPROVAL_REQUIRED" });
    const orderId = identity.safeParse((request.params as { orderId?: string }).orderId);
    const parsed = refundSchema.safeParse(request.body);
    if (!orderId.success || !parsed.success) return reply.code(422).send({ error: "INVALID_REFUND" });
    const order = orders.get(orderId.data);
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    const remaining = order.totals.total - refundedAmount(order.id);
    if (parsed.data.amount > remaining) return reply.code(409).send({ error: "REFUND_EXCEEDS_REMAINING", remaining });
    const refund: Refund = { id: crypto.randomUUID(), orderId: order.id, ...parsed.data, approvedBy, createdAt: new Date().toISOString() };
    refunds.set(refund.id, refund);
    return reply.code(201).send({ data: refund, remaining: remaining - refund.amount });
  });
}
