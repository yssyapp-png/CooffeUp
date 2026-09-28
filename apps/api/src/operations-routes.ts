import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loyaltyAccounts, loyaltyLedger, orders, products, refreshLoyaltyTier } from "./store.js";
import { managerIdentity } from "./manager-approval.js";
import {
  activeShiftForCashier,
  cashMovements,
  expectedCashForShift,
  refundedAmount,
  refundedQuantity,
  refundRequests,
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
const refundSchema = z.object({
  shiftId: z.string().uuid(),
  method: z.enum(["cash", "card", "mada", "apple_pay", "stc_pay"]),
  lines: z.array(z.object({ productId: identity, quantity: z.number().int().positive().max(99) })).min(1).max(100)
    .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, "DUPLICATE_REFUND_PRODUCT"),
  reason
});

const cashSalesForShift = (shiftId: string) => [...orders.values()]
  .filter((order) => order.shiftId === shiftId)
  .reduce((sum, order) => {
    const cashTendered = order.payments.filter((payment) => payment.method === "cash").reduce((paymentSum, payment) => paymentSum + payment.amount, 0);
    return sum + cashTendered - order.change;
  }, 0);

const cashRefundsForShift = (shiftId: string) => [...refunds.values()]
  .filter((refund) => refund.shiftId === shiftId && refund.method === "cash")
  .reduce((sum, refund) => sum + refund.amount, 0);

export async function registerOperationsRoutes(app: FastifyInstance) {
  app.get("/api/v1/operations/readiness", async () => ({
    data: {
      productionReady: false,
      persistence: "memory",
      managerApproval: "legacy-token",
      blockers: ["PERSISTENT_DATABASE_REQUIRED", "AUTHENTICATED_EMPLOYEE_SESSIONS_REQUIRED"]
    }
  }));

  app.get("/api/v1/shifts", async () => ({ data: [...shifts.values()].slice(-50).reverse() }));

  app.get("/api/v1/shifts/:shiftId/report", async (request, reply) => {
    if (!managerIdentity(request)) return reply.code(403).send({ error: "MANAGER_APPROVAL_REQUIRED" });
    const shiftId = z.string().uuid().safeParse((request.params as { shiftId?: string }).shiftId);
    if (!shiftId.success) return reply.code(422).send({ error: "INVALID_SHIFT_ID" });
    const shift = shifts.get(shiftId.data);
    if (!shift) return reply.code(404).send({ error: "SHIFT_NOT_FOUND" });
    const shiftOrders = [...orders.values()].filter((order) => order.shiftId === shift.id);
    const shiftRefunds = [...refunds.values()].filter((refund) => refund.shiftId === shift.id);
    const movements = [...cashMovements.values()].filter((movement) => movement.shiftId === shift.id);
    const sales = shiftOrders.reduce((sum, order) => sum + order.totals.total, 0);
    const refunded = shiftRefunds.reduce((sum, refund) => sum + refund.amount, 0);
    const paymentMethods = ["cash", "card", "mada", "apple_pay", "stc_pay"] as const;
    const tenders = Object.fromEntries(paymentMethods.map((method) => [method,
      shiftOrders.reduce((sum, order) => sum + order.payments.filter((payment) => payment.method === method).reduce((total, payment) => total + payment.amount, 0) - (method === "cash" ? order.change : 0), 0)
    ]));
    const refundsByMethod = Object.fromEntries(paymentMethods.map((method) => [method,
      shiftRefunds.filter((refund) => refund.method === method).reduce((sum, refund) => sum + refund.amount, 0)
    ]));
    const expectedCash = expectedCashForShift(shift, cashSalesForShift(shift.id), cashRefundsForShift(shift.id));
    return { data: {
      shiftId: shift.id, status: shift.status, openingFloat: shift.openingFloat,
      orderCount: shiftOrders.length, refundCount: shiftRefunds.length,
      sales, refunded, netSales: sales - refunded, tenders, refundsByMethod,
      cashIn: movements.filter((movement) => movement.type === "cash_in").reduce((sum, movement) => sum + movement.amount, 0),
      cashOut: movements.filter((movement) => movement.type === "cash_out").reduce((sum, movement) => sum + movement.amount, 0),
      expectedCash, countedCash: shift.countedCash ?? null, variance: shift.variance ?? null
    } };
  });

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
    if (parsed.data.type === "cash_out") {
      const availableCash = expectedCashForShift(shift, cashSalesForShift(shift.id), cashRefundsForShift(shift.id));
      if (parsed.data.amount > availableCash) return reply.code(409).send({ error: "INSUFFICIENT_CASH_IN_DRAWER", available: availableCash });
    }
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
    const expectedCash = expectedCashForShift(shift, cashSalesForShift(shift.id), cashRefundsForShift(shift.id));
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
    const shift = shifts.get(suspended.shiftId);
    if (!shift) return reply.code(404).send({ error: "SHIFT_NOT_FOUND" });
    if (shift.status !== "open") return reply.code(409).send({ error: "SHIFT_CLOSED" });
    suspended.resumedAt = new Date().toISOString();
    return reply.send({ data: suspended });
  });

  app.post("/api/v1/orders/:orderId/refunds", async (request, reply) => {
    const approvedBy = managerIdentity(request);
    if (!approvedBy) return reply.code(403).send({ error: "MANAGER_APPROVAL_REQUIRED" });
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 100) return reply.code(400).send({ error: "VALID_IDEMPOTENCY_KEY_REQUIRED" });
    const orderId = identity.safeParse((request.params as { orderId?: string }).orderId);
    const parsed = refundSchema.safeParse(request.body);
    if (!orderId.success || !parsed.success) return reply.code(422).send({ error: "INVALID_REFUND" });
    const fingerprint = JSON.stringify({ orderId: orderId.data, ...parsed.data });
    const previous = refundRequests.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return reply.code(409).send({ error: "IDEMPOTENCY_KEY_REUSED" });
      const refund = refunds.get(previous.refundId);
      if (!refund) return reply.code(409).send({ error: "REFUND_REPLAY_UNAVAILABLE" });
      return reply.send({ data: refund, remaining: previous.remaining, replayed: true });
    }
    const order = orders.get(orderId.data);
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    const shift = shifts.get(parsed.data.shiftId);
    if (!shift) return reply.code(404).send({ error: "SHIFT_NOT_FOUND" });
    if (shift.status !== "open") return reply.code(409).send({ error: "SHIFT_CLOSED" });
    const remaining = order.totals.total - refundedAmount(order.id);
    let amount = 0;
    for (const requestedLine of parsed.data.lines) {
      const original = order.lines.find((line) => line.productId === requestedLine.productId);
      if (!original) return reply.code(422).send({ error: "REFUND_PRODUCT_NOT_IN_ORDER", productId: requestedLine.productId });
      const alreadyRefunded = refundedQuantity(order.id, requestedLine.productId);
      if (requestedLine.quantity > original.quantity - alreadyRefunded) return reply.code(409).send({ error: "REFUND_QUANTITY_EXCEEDS_REMAINING", productId: requestedLine.productId, remaining: original.quantity - alreadyRefunded });
      const discountBefore = Math.round((original.discount * alreadyRefunded) / original.quantity);
      const discountAfter = Math.round((original.discount * (alreadyRefunded + requestedLine.quantity)) / original.quantity);
      const taxableBefore = original.unitPrice * alreadyRefunded - discountBefore;
      const taxableAfter = original.unitPrice * (alreadyRefunded + requestedLine.quantity) - discountAfter;
      const taxBefore = Math.round((taxableBefore * original.taxRateBps) / 10_000);
      const taxAfter = Math.round((taxableAfter * original.taxRateBps) / 10_000);
      amount += taxableAfter - taxableBefore + taxAfter - taxBefore;
    }
    if (amount > remaining) return reply.code(409).send({ error: "REFUND_EXCEEDS_REMAINING", remaining });
    const paidByMethod = order.payments.filter((payment) => payment.method === parsed.data.method).reduce((sum, payment) => sum + payment.amount, 0) - (parsed.data.method === "cash" ? order.change : 0);
    const refundedByMethod = [...refunds.values()].filter((refund) => refund.orderId === order.id && refund.method === parsed.data.method).reduce((sum, refund) => sum + refund.amount, 0);
    if (amount > paidByMethod - refundedByMethod) return reply.code(409).send({ error: "REFUND_METHOD_MISMATCH", available: Math.max(0, paidByMethod - refundedByMethod) });
    if (parsed.data.method === "cash") {
      const available = expectedCashForShift(shift, cashSalesForShift(shift.id), cashRefundsForShift(shift.id));
      if (amount > available) return reply.code(409).send({ error: "INSUFFICIENT_CASH_IN_DRAWER", available });
    }
    const refund: Refund = { id: crypto.randomUUID(), orderId: order.id, shiftId: parsed.data.shiftId, amount, method: parsed.data.method, lines: parsed.data.lines, reason: parsed.data.reason, approvedBy, createdAt: new Date().toISOString() };
    refunds.set(refund.id, refund);
    const fullyRefunded = order.lines.every((line) => refundedQuantity(order.id, line.productId) === line.quantity);
    for (const line of parsed.data.lines) {
      const product = products.get(line.productId);
      if (product) product.stock += line.quantity;
    }
    if (order.customerMobile) {
      const account = loyaltyAccounts.get(order.customerMobile);
      if (account) {
        const earned = loyaltyLedger.filter((entry) => entry.orderId === order.id && entry.type === "earn").reduce((sum, entry) => sum + entry.points, 0);
        const previouslyReversed = -loyaltyLedger.filter((entry) => entry.orderId === order.id && entry.type === "refund_earn_reversal").reduce((sum, entry) => sum + entry.points, 0);
        const targetReversal = fullyRefunded ? earned : order.totals.total === 0 ? 0 : Math.min(earned, Math.floor((earned * refundedAmount(order.id)) / order.totals.total));
        const pointsToReverse = Math.max(0, targetReversal - previouslyReversed);
        account.points = Math.max(0, account.points - pointsToReverse);
        if (pointsToReverse) loyaltyLedger.push({ id: crypto.randomUUID(), customerMobile: account.customerMobile, orderId: order.id, type: "refund_earn_reversal", points: -pointsToReverse, createdAt: new Date().toISOString() });
        if (fullyRefunded) {
          const redeemed = -loyaltyLedger.filter((entry) => entry.orderId === order.id && entry.type === "redeem").reduce((sum, entry) => sum + entry.points, 0);
          const restored = loyaltyLedger.filter((entry) => entry.orderId === order.id && entry.type === "refund_redeem_restore").reduce((sum, entry) => sum + entry.points, 0);
          if (redeemed > restored) {
            const pointsToRestore = redeemed - restored;
            account.points += pointsToRestore;
            loyaltyLedger.push({ id: crypto.randomUUID(), customerMobile: account.customerMobile, orderId: order.id, type: "refund_redeem_restore", points: pointsToRestore, createdAt: new Date().toISOString() });
          }
        }
        account.visits = Math.max(0, account.visits - (fullyRefunded ? 1 : 0));
        refreshLoyaltyTier(account);
      }
    }
    refundRequests.set(key, { fingerprint, refundId: refund.id, remaining: remaining - amount });
    return reply.code(201).send({ data: refund, remaining: remaining - amount });
  });
}
