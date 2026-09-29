import type { FastifyInstance } from "fastify";
import {
  cashTransferLines, cashVarianceLines, formatSar, maskPhone, normalizeSaudiMobile,
  type HeldCart, type Permission, type OrderRecord, type Product, type ShiftRecord, type SyncResult
} from "@cooffeup/shared";
import { z } from "zod";
import { actor, audit, authenticate, branchOf, fail, guarded, HttpError, newId, now, parse, type AppContext } from "../context.js";
import { emit } from "../services/events.js";
import { renderInvoicePage } from "../services/invoice-page.js";
import { postJournal } from "../services/ledger.js";
import { createOrder, refundOrder, type OrderInput } from "../services/orders.js";
import { shiftCashSummary, shiftReport } from "../services/shifts.js";
import { sendSms } from "../services/sms.js";
import { MAIN_BRANCH_ID, type CashMovement } from "../store.js";
import { enqueueStoreSync } from "../services/store-sync.js";

const money = z.number().int().nonnegative();
const paymentMethod = z.enum(["cash", "card", "mada", "apple_pay", "stc_pay"]);

export const orderSchema = z.object({
  type: z.enum(["dine_in", "takeaway", "delivery"]),
  lines: z.array(z.object({
    productId: z.string().min(1), quantity: z.number().int().positive().max(99), discount: money.optional(),
    unitPrice: money.optional(), notes: z.string().max(250).optional()
  })).min(1).max(100),
  orderDiscount: money.optional(),
  // Empty only when a reward makes the order free; createOrder rejects any shortfall.
  payments: z.array(z.object({ method: paymentMethod, amount: z.number().int().positive().max(100_000_000), reference: z.string().max(64).optional() })).max(5),
  customerId: z.string().optional(),
  tableId: z.string().optional(),
  redeemReward: z.enum(["free_drink"]).optional(),
  pickupDueAt: z.string().datetime().optional()
});

const productSchema = z.object({
  sku: z.string().min(1).max(64), barcode: z.string().max(64).optional(), nameAr: z.string().min(1).max(120), nameEn: z.string().max(120).default(""),
  category: z.string().min(1).max(60), price: money, cost: money.optional(), taxRateBps: z.number().int().min(0).max(10_000).default(1500),
  stock: z.number().int().default(0), reorderLevel: z.number().int().nonnegative().optional(), active: z.boolean().default(true)
});

const idempotencyKey = (value: unknown) => typeof value === "string" && value.length >= 8 && value.length <= 100 ? value : undefined;

/** Stable fingerprint of a request body: the same key must always carry the same order. */
const fingerprint = (value: unknown) => JSON.stringify(value);

export function registerPosRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;
  const auth = authenticate(ctx);
  const guard = (...permissions: Permission[]) => guarded(ctx, ...permissions);

  /** Products as seen from a branch: `stock` is that branch's quantity, `totalStock` the company-wide one. */
  const atBranch = (product: Product, branchId: string) => ({ ...product, stock: store.stockAt(branchId, product.id), totalStock: product.stock });

  // ---------- Catalogue ----------
  app.get("/api/v1/products", { preHandler: auth }, async (request) => {
    const query = parse(z.object({ q: z.string().max(80).optional(), includeInactive: z.coerce.boolean().default(false) }), request.query);
    const term = query.q?.trim().toLowerCase();
    const data = [...store.products.values()].filter((product) => (query.includeInactive || product.active) &&
      (!term || `${product.nameAr} ${product.nameEn} ${product.sku} ${product.barcode ?? ""}`.toLowerCase().includes(term)));
    return { data: data.map((product) => atBranch(product, branchOf(request))) };
  });

  app.post("/api/v1/products", guard("inventory.manage"), async (request, reply) => {
    const { stock, ...body } = parse(productSchema, request.body);
    if (store.productBySku(body.sku)) fail(409, "SKU_EXISTS");
    const product: Product = { id: newId(), ...body, stock: 0 };
    store.products.set(product.id, product);
    // Opening stock is placed at the branch the product was created from.
    if (stock) {
      store.adjustStock(branchOf(request), product.id, stock);
      store.movements.push({ id: newId(), branchId: branchOf(request), productId: product.id, quantity: stock, reason: "adjustment", refId: "opening stock", createdAt: now() });
    }
    enqueueStoreSync(ctx, [product.id]);
    audit(ctx, request, "product.created", { type: "product", id: product.id });
    return reply.code(201).send({ data: atBranch(product, branchOf(request)) });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/products/:id", guard("inventory.manage"), async (request) => {
    const product = store.products.get(request.params.id) ?? fail(404, "PRODUCT_NOT_FOUND");
    const body = parse(productSchema.omit({ stock: true }).partial(), request.body);
    Object.assign(product, body);
    enqueueStoreSync(ctx, [product.id]);
    audit(ctx, request, "product.updated", { type: "product", id: product.id }, body);
    return { data: atBranch(product, branchOf(request)) };
  });

  app.post<{ Params: { id: string } }>("/api/v1/products/:id/adjust", guard("inventory.manage"), async (request) => {
    const product = store.products.get(request.params.id) ?? fail(404, "PRODUCT_NOT_FOUND");
    const body = parse(z.object({ quantity: z.number().int().refine((value) => value !== 0), reason: z.string().min(2).max(200) }), request.body);
    store.adjustStock(branchOf(request), product.id, body.quantity);
    store.movements.push({ id: newId(), branchId: branchOf(request), productId: product.id, quantity: body.quantity, reason: "adjustment", refId: body.reason, createdAt: now() });
    enqueueStoreSync(ctx, [product.id]);
    audit(ctx, request, "stock.adjusted", { type: "product", id: product.id }, { ...body, branchId: branchOf(request) });
    return { data: atBranch(product, branchOf(request)) };
  });

  // ---------- Orders ----------
  app.get("/api/v1/orders", guard("pos.sell"), async (request) => {
    const query = parse(z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      q: z.string().trim().max(60).optional(),
      status: z.enum(["paid", "partially_refunded", "refunded"]).optional(),
      /** "all" lists every branch; only staff who are not tied to one branch may use it. */
      scope: z.enum(["branch", "all"]).default("branch")
    }), request.query);
    if (query.scope === "all" && actor(request).branchId) fail(403, "BRANCH_NOT_ALLOWED");
    const term = query.q?.toLowerCase();
    const data = [...store.orders.values()].filter((order) =>
      (query.scope === "all" || (order.branchId ?? MAIN_BRANCH_ID) === branchOf(request)) &&
      (!query.status || order.status === query.status) &&
      (!term || order.receiptNumber.toLowerCase().includes(term) || order.externalOrderId?.toLowerCase().includes(term) || order.offline?.localReceipt.toLowerCase().includes(term)));
    return { data: data.slice(-query.limit).reverse() };
  });

  app.get<{ Params: { id: string } }>("/api/v1/orders/:id", guard("pos.sell"), async (request) => {
    const order = store.orders.get(request.params.id) ?? fail(404, "ORDER_NOT_FOUND");
    const customer = order.customerId ? store.customers.get(order.customerId) : undefined;
    return {
      data: order,
      refunds: [...store.refunds.values()].filter((refund) => refund.orderId === order.id),
      customerName: customer?.name,
      invoiceUrl: `${ctx.config.publicBaseUrl}/i/${order.invoiceToken}`
    };
  });

  app.post("/api/v1/orders", guard("pos.sell"), async (request, reply) => {
    const key = idempotencyKey(request.headers["idempotency-key"]);
    if (!key) return reply.code(400).send({ error: "VALID_IDEMPOTENCY_KEY_REQUIRED" });
    const body = parse(orderSchema, request.body);
    const existing = store.idempotency.get(key);
    if (existing) {
      if (store.idempotencyFingerprints.get(key) !== fingerprint(body)) return reply.code(409).send({ error: "IDEMPOTENCY_KEY_REUSED" });
      return reply.code(200).send({ data: existing, change: existing.change, replayed: true });
    }
    const { order, change } = createOrder(ctx, body, { staff: actor(request), channel: "pos", branchId: branchOf(request) });
    store.idempotency.set(key, order);
    store.idempotencyFingerprints.set(key, fingerprint(body));
    if (order.lines.some((line) => line.priceOverride)) audit(ctx, request, "order.price_override", { type: "order", id: order.id });
    return reply.code(201).send({ data: order, change });
  });

  app.post<{ Params: { id: string } }>("/api/v1/orders/:id/refund", guard("pos.refund"), async (request, reply) => {
    const body = parse(z.object({
      lines: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).min(1),
      method: z.enum(["cash", "card", "mada", "apple_pay", "stc_pay", "online", "delivery_platform"]).optional(),
      reason: z.string().min(3).max(250)
    }), request.body);
    // An optional idempotency key lets a till retry a refund after a timeout without paying twice.
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const print = fingerprint({ orderId: request.params.id, ...body });
    const previous = key ? store.refundRequests.get(key) : undefined;
    if (previous) {
      if (previous.fingerprint !== print) return reply.code(409).send({ error: "IDEMPOTENCY_KEY_REUSED" });
      return reply.code(200).send({ data: store.refunds.get(previous.refundId), replayed: true });
    }
    const refund = refundOrder(ctx, request.params.id, body, actor(request), branchOf(request));
    if (key) store.refundRequests.set(key, { fingerprint: print, refundId: refund.id });
    audit(ctx, request, "order.refunded", { type: "order", id: request.params.id }, { total: refund.total, reason: body.reason });
    return reply.code(201).send({ data: refund });
  });

  // ---------- Offline sync ----------
  app.post("/api/v1/sync/orders", guard("pos.sell"), async (request) => {
    const body = parse(z.object({
      deviceId: z.string().min(4).max(64),
      entries: z.array(z.object({
        id: z.string().min(8).max(100), localReceipt: z.string().max(40), capturedAt: z.string().datetime(), payload: orderSchema
      })).min(1).max(50)
    }), request.body);
    const results: SyncResult[] = body.entries.map((entry) => {
      const existing = store.idempotency.get(entry.id);
      if (existing) {
        return store.idempotencyFingerprints.get(entry.id) === fingerprint(entry.payload)
          ? { id: entry.id, status: "duplicate", receiptNumber: existing.receiptNumber }
          : { id: entry.id, status: "rejected", error: "IDEMPOTENCY_KEY_REUSED" };
      }
      try {
        const { order } = createOrder(ctx, entry.payload as OrderInput, {
          staff: actor(request), channel: "pos", branchId: branchOf(request), offline: { deviceId: body.deviceId, localReceipt: entry.localReceipt, capturedAt: entry.capturedAt }
        });
        store.idempotency.set(entry.id, order);
        store.idempotencyFingerprints.set(entry.id, fingerprint(entry.payload));
        return { id: entry.id, status: "created", receiptNumber: order.receiptNumber };
      } catch (error) {
        if (error instanceof HttpError) return { id: entry.id, status: "rejected", error: error.code };
        throw error;
      }
    });
    audit(ctx, request, "sync.orders", { type: "device", id: body.deviceId }, { count: results.length });
    return { data: results };
  });

  // ---------- Held carts ----------
  app.get("/api/v1/held-carts", guard("pos.hold_cart"), async () => ({ data: [...store.heldCarts.values()].reverse() }));

  app.post("/api/v1/held-carts", guard("pos.hold_cart"), async (request, reply) => {
    const body = parse(z.object({ id: z.string().min(8).max(100).optional(), label: z.string().min(1).max(60), payload: orderSchema.omit({ payments: true }) }), request.body);
    const cart: HeldCart = { id: body.id ?? newId(), label: body.label, payload: body.payload, heldBy: actor(request).id, heldAt: now() };
    store.heldCarts.set(cart.id, cart);
    return reply.code(201).send({ data: cart });
  });

  app.delete<{ Params: { id: string } }>("/api/v1/held-carts/:id", guard("pos.hold_cart"), async (request, reply) => {
    store.heldCarts.delete(request.params.id);
    return reply.code(204).send();
  });

  // ---------- Shifts & cash drawer ----------
  app.get("/api/v1/shifts/current", guard("shifts.manage"), async (request) => {
    const shift = store.openShift(branchOf(request));
    return { data: shift ? { ...shift, summary: shiftCashSummary(ctx, shift) } : null, requireOpenShift: store.settings.requireOpenShift };
  });

  app.get("/api/v1/shifts", guard("shifts.manage"), async (request) => ({
    data: [...store.shifts.values()].filter((shift) => (shift.branchId ?? MAIN_BRANCH_ID) === branchOf(request)).slice(-50).reverse()
  }));

  app.get<{ Params: { id: string } }>("/api/v1/shifts/:id/report", guard("shifts.manage"), async (request) => {
    const shift = store.shifts.get(request.params.id) ?? fail(404, "SHIFT_NOT_FOUND");
    return { data: shiftReport(ctx, shift) };
  });

  app.post<{ Params: { id: string } }>("/api/v1/shifts/:id/movements", guard("shifts.manage"), async (request, reply) => {
    const shift = store.shifts.get(request.params.id) ?? fail(404, "SHIFT_NOT_FOUND");
    if (shift.status !== "open") fail(409, "SHIFT_NOT_OPEN");
    const body = parse(z.object({ type: z.enum(["cash_in", "cash_out"]), amount: money.refine((value) => value > 0), reason: z.string().trim().min(3).max(250) }), request.body);
    if (body.type === "cash_out") {
      const inDrawer = shiftCashSummary(ctx, shift).expectedCash;
      if (body.amount > inDrawer) fail(409, "INSUFFICIENT_CASH_IN_DRAWER", { available: inDrawer });
    }
    const movement: CashMovement = { id: newId(), shiftId: shift.id, ...body, staffId: actor(request).id, createdAt: now() };
    store.cashMovements.set(movement.id, movement);
    // Cash moves between the drawer and the safe/bank, so it is a transfer between asset accounts.
    postJournal(ctx, {
      description: body.type === "cash_in" ? `إيداع نقد في الصندوق: ${body.reason}` : `سحب نقد من الصندوق: ${body.reason}`,
      source: { type: "shift", id: shift.id }, createdBy: actor(request).id,
      lines: body.type === "cash_in" ? cashTransferLines("1101", "1102", body.amount) : cashTransferLines("1102", "1101", body.amount)
    });
    audit(ctx, request, `shift.${body.type}`, { type: "shift", id: shift.id }, { amount: body.amount, reason: body.reason });
    return reply.code(201).send({ data: movement, summary: shiftCashSummary(ctx, shift) });
  });

  app.post("/api/v1/shifts/open", guard("shifts.manage"), async (request, reply) => {
    const body = parse(z.object({ openingFloat: money }), request.body);
    if (store.openShift(branchOf(request))) fail(409, "SHIFT_ALREADY_OPEN");
    const shift: ShiftRecord = { id: newId(), branchId: branchOf(request), staffId: actor(request).id, status: "open", openedAt: now(), openingFloat: body.openingFloat };
    store.shifts.set(shift.id, shift);
    audit(ctx, request, "shift.opened", { type: "shift", id: shift.id }, body);
    return reply.code(201).send({ data: shift });
  });

  app.post<{ Params: { id: string } }>("/api/v1/shifts/:id/close", guard("shifts.manage"), async (request) => {
    const shift = store.shifts.get(request.params.id) ?? fail(404, "SHIFT_NOT_FOUND");
    if (shift.status !== "open") fail(409, "SHIFT_NOT_OPEN");
    const body = parse(z.object({ countedCash: money, notes: z.string().max(500).optional() }), request.body);
    const summary = shiftCashSummary(ctx, shift);
    Object.assign(shift, {
      status: "closed", closedAt: now(), closedBy: actor(request).id, countedCash: body.countedCash,
      expectedCash: summary.expectedCash, variance: body.countedCash - summary.expectedCash, notes: body.notes
    });
    postJournal(ctx, { description: "فرق إغلاق الصندوق", source: { type: "shift", id: shift.id }, lines: cashVarianceLines(shift.variance!), createdBy: actor(request).id });
    audit(ctx, request, "shift.closed", { type: "shift", id: shift.id }, { variance: shift.variance });
    emit(ctx, "shift.closed", { ...shift, summary });
    return { data: { ...shift, summary } };
  });

  // ---------- E-invoice by SMS ----------
  app.post<{ Params: { id: string } }>("/api/v1/orders/:id/send-invoice", { ...guard("invoices.send"), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const order = store.orders.get(request.params.id) ?? fail(404, "ORDER_NOT_FOUND");
    const body = parse(z.object({ phone: z.string().min(1).max(20) }), request.body);
    const phone = normalizeSaudiMobile(body.phone) ?? fail(422, "INVALID_SAUDI_MOBILE");
    const previous = [...store.sms.values()].filter((message) => message.orderId === order.id).length;
    if (previous >= 3) fail(429, "INVOICE_SMS_LIMIT_REACHED");
    const link = `${ctx.config.publicBaseUrl}/i/${order.invoiceToken}`;
    const text = `${store.settings.sellerName}: فاتورتك ${order.receiptNumber} بقيمة ${formatSar(order.totals.total)}. عرض الفاتورة: ${link}`;
    const result = await sendSms(ctx, phone, text);
    const message = {
      id: newId(), orderId: order.id, toMasked: maskPhone(phone), body: text, provider: result.provider,
      status: result.ok ? "sent" as const : "failed" as const, error: result.error, sentBy: actor(request).id, createdAt: now()
    };
    store.sms.set(message.id, message);
    audit(ctx, request, "invoice.sms", { type: "order", id: order.id }, { to: message.toMasked, status: message.status });
    return reply.code(result.ok ? 201 : 502).send({ data: message, link });
  });

  app.get("/api/v1/sms", guard("invoices.send"), async () => ({ data: [...store.sms.values()].reverse().slice(0, 100) }));

  app.get<{ Params: { token: string } }>("/i/:token", async (request, reply) => {
    const order = [...store.orders.values()].find((candidate: OrderRecord) => candidate.invoiceToken === request.params.token);
    if (!order) return reply.code(404).type("text/html; charset=utf-8").send("<p dir=\"rtl\">الفاتورة غير موجودة</p>");
    return reply.type("text/html; charset=utf-8").header("cache-control", "private, no-store").send(await renderInvoicePage(order, store.settings));
  });
}
