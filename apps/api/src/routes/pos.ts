import type { FastifyInstance } from "fastify";
import {
  cashVarianceLines, formatSar, maskPhone, normalizeSaudiMobile,
  type HeldCart, type Permission, type OrderRecord, type Product, type ShiftRecord, type SyncResult
} from "@cooffeup/shared";
import { z } from "zod";
import { actor, audit, authenticate, fail, guarded, HttpError, newId, now, parse, type AppContext } from "../context.js";
import { emit } from "../services/events.js";
import { renderInvoicePage } from "../services/invoice-page.js";
import { postJournal } from "../services/ledger.js";
import { createOrder, refundOrder, type OrderInput } from "../services/orders.js";
import { sendSms } from "../services/sms.js";
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
  payments: z.array(z.object({ method: paymentMethod, amount: z.number().int().positive(), reference: z.string().max(64).optional() })).min(1).max(5),
  customerId: z.string().optional(),
  tableId: z.string().optional()
});

const productSchema = z.object({
  sku: z.string().min(1).max(64), barcode: z.string().max(64).optional(), nameAr: z.string().min(1).max(120), nameEn: z.string().max(120).default(""),
  category: z.string().min(1).max(60), price: money, cost: money.optional(), taxRateBps: z.number().int().min(0).max(10_000).default(1500),
  stock: z.number().int().default(0), reorderLevel: z.number().int().nonnegative().optional(), active: z.boolean().default(true)
});

const idempotencyKey = (value: unknown) => typeof value === "string" && value.length >= 8 && value.length <= 100 ? value : undefined;

export function shiftCashSummary(ctx: AppContext, shift: ShiftRecord) {
  const orders = [...ctx.store.orders.values()].filter((order) => order.shiftId === shift.id);
  const cashSales = orders.reduce((sum, order) => sum + order.payments.filter((payment) => payment.method === "cash").reduce((s, p) => s + p.amount, 0) - order.change, 0);
  const cashRefunds = [...ctx.store.refunds.values()].filter((refund) => refund.shiftId === shift.id && refund.method === "cash").reduce((sum, refund) => sum + refund.total, 0);
  const cashExpenses = [...ctx.store.expenses.values()].filter((expense) => expense.shiftId === shift.id && expense.paidFrom === "cash").reduce((sum, expense) => sum + expense.total, 0);
  return { orders: orders.length, cashSales, cashRefunds, cashExpenses, expectedCash: shift.openingFloat + cashSales - cashRefunds - cashExpenses };
}

export function registerPosRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;
  const auth = authenticate(ctx);
  const guard = (...permissions: Permission[]) => guarded(ctx, ...permissions);

  // ---------- Catalogue ----------
  app.get("/api/v1/products", { preHandler: auth }, async (request) => {
    const query = parse(z.object({ q: z.string().max(80).optional(), includeInactive: z.coerce.boolean().default(false) }), request.query);
    const term = query.q?.trim().toLowerCase();
    const data = [...store.products.values()].filter((product) => (query.includeInactive || product.active) &&
      (!term || `${product.nameAr} ${product.nameEn} ${product.sku} ${product.barcode ?? ""}`.toLowerCase().includes(term)));
    return { data };
  });

  app.post("/api/v1/products", guard("inventory.manage"), async (request, reply) => {
    const body = parse(productSchema, request.body);
    if (store.productBySku(body.sku)) fail(409, "SKU_EXISTS");
    const product: Product = { id: newId(), ...body };
    store.products.set(product.id, product);
    enqueueStoreSync(ctx, [product.id]);
    audit(ctx, request, "product.created", { type: "product", id: product.id });
    return reply.code(201).send({ data: product });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/products/:id", guard("inventory.manage"), async (request) => {
    const product = store.products.get(request.params.id) ?? fail(404, "PRODUCT_NOT_FOUND");
    const body = parse(productSchema.omit({ stock: true }).partial(), request.body);
    Object.assign(product, body);
    enqueueStoreSync(ctx, [product.id]);
    audit(ctx, request, "product.updated", { type: "product", id: product.id }, body);
    return { data: product };
  });

  app.post<{ Params: { id: string } }>("/api/v1/products/:id/adjust", guard("inventory.manage"), async (request) => {
    const product = store.products.get(request.params.id) ?? fail(404, "PRODUCT_NOT_FOUND");
    const body = parse(z.object({ quantity: z.number().int().refine((value) => value !== 0), reason: z.string().min(2).max(200) }), request.body);
    product.stock += body.quantity;
    store.movements.push({ id: newId(), productId: product.id, quantity: body.quantity, reason: "adjustment", refId: body.reason, createdAt: now() });
    enqueueStoreSync(ctx, [product.id]);
    audit(ctx, request, "stock.adjusted", { type: "product", id: product.id }, body);
    return { data: product };
  });

  // ---------- Orders ----------
  app.get("/api/v1/orders", guard("pos.sell"), async (request) => {
    const query = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), request.query);
    return { data: [...store.orders.values()].slice(-query.limit).reverse() };
  });

  app.get<{ Params: { id: string } }>("/api/v1/orders/:id", guard("pos.sell"), async (request) => ({
    data: store.orders.get(request.params.id) ?? fail(404, "ORDER_NOT_FOUND")
  }));

  app.post("/api/v1/orders", guard("pos.sell"), async (request, reply) => {
    const key = idempotencyKey(request.headers["idempotency-key"]);
    if (!key) return reply.code(400).send({ error: "VALID_IDEMPOTENCY_KEY_REQUIRED" });
    const existing = store.idempotency.get(key);
    if (existing) return reply.code(200).send({ data: existing, replayed: true });
    const body = parse(orderSchema, request.body);
    const { order, change } = createOrder(ctx, body, { staff: actor(request), channel: "pos" });
    store.idempotency.set(key, order);
    if (order.lines.some((line) => line.priceOverride)) audit(ctx, request, "order.price_override", { type: "order", id: order.id });
    return reply.code(201).send({ data: order, change });
  });

  app.post<{ Params: { id: string } }>("/api/v1/orders/:id/refund", guard("pos.refund"), async (request, reply) => {
    const body = parse(z.object({
      lines: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).min(1),
      method: z.enum(["cash", "card", "mada", "apple_pay", "stc_pay", "online", "delivery_platform"]).optional(),
      reason: z.string().min(3).max(250)
    }), request.body);
    const refund = refundOrder(ctx, request.params.id, body, actor(request));
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
      if (existing) return { id: entry.id, status: "duplicate", receiptNumber: existing.receiptNumber };
      try {
        const { order } = createOrder(ctx, entry.payload as OrderInput, {
          staff: actor(request), channel: "pos", offline: { deviceId: body.deviceId, localReceipt: entry.localReceipt, capturedAt: entry.capturedAt }
        });
        store.idempotency.set(entry.id, order);
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
  app.get("/api/v1/shifts/current", guard("shifts.manage"), async () => {
    const shift = store.openShift();
    return { data: shift ? { ...shift, summary: shiftCashSummary(ctx, shift) } : null };
  });

  app.post("/api/v1/shifts/open", guard("shifts.manage"), async (request, reply) => {
    const body = parse(z.object({ openingFloat: money }), request.body);
    if (store.openShift()) fail(409, "SHIFT_ALREADY_OPEN");
    const shift: ShiftRecord = { id: newId(), staffId: actor(request).id, status: "open", openedAt: now(), openingFloat: body.openingFloat };
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
