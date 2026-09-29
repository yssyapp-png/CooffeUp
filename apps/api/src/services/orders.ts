import {
  calculateLine, calculateTotals, discountAllowed, distributeDiscount, hasFeature, maxDiscountBps, refundEntryLines, saleEntryLines,
  type CartLine, type Totals, type OrderLineRecord, type OrderRecord, type OrderType, type PaymentMethod, type RefundRecord, type SalesChannel
} from "@cooffeup/shared";
import { accessOf, fail, newId, now, staffCan, type AppContext } from "../context.js";
import { randomToken } from "../security.js";
import type { StaffMember } from "../store.js";
import { emit } from "./events.js";
import { postJournal } from "./ledger.js";
import { enqueueStoreSync } from "./store-sync.js";

export interface OrderInput {
  type: OrderType;
  lines: Array<{ productId: string; quantity: number; discount?: number; unitPrice?: number; notes?: string }>;
  orderDiscount?: number;
  payments: Array<{ method: PaymentMethod; amount: number; reference?: string }>;
  customerId?: string;
  tableId?: string;
}

export interface OrderOptions {
  staff: StaffMember;
  channel: SalesChannel;
  externalOrderId?: string;
  /** Sales captured offline already happened, so they are recorded even if stock went negative. */
  offline?: { deviceId: string; localReceipt: string; capturedAt: string };
  /** Orders already accepted by an online store must be recorded even when local stock is short. */
  allowNegativeStock?: boolean;
}

const STOCK_REASON: Record<string, "sale" | "online_sale" | "delivery_sale"> = { pos: "sale", zid: "online_sale", salla: "online_sale" };

/** Validates the lines and prices the order without changing any state. */
export function priceOrder(ctx: AppContext, input: Pick<OrderInput, "lines" | "orderDiscount">, options: OrderOptions) {
  const { store } = ctx;
  const fromPos = options.channel === "pos";
  let stockConflict = false;

  const requested = new Map<string, number>();
  const cart: CartLine[] = input.lines.map((line) => {
    const product = store.products.get(line.productId);
    if (!product?.active) return fail(404, "PRODUCT_NOT_FOUND", { productId: line.productId });
    const totalRequested = (requested.get(product.id) ?? 0) + line.quantity;
    requested.set(product.id, totalRequested);
    if (product.stock < totalRequested) {
      if (!options.offline && !options.allowNegativeStock) fail(409, "INSUFFICIENT_STOCK", { productId: product.id, available: product.stock });
      stockConflict = true;
    }
    const unitPrice = line.unitPrice ?? product.price;
    if (unitPrice !== product.price && fromPos && !staffCan(options.staff, "pos.price_override")) {
      fail(403, "PRICE_OVERRIDE_NOT_ALLOWED", { productId: product.id });
    }
    return { productId: product.id, name: product.nameAr, unitPrice, quantity: line.quantity, taxRateBps: product.taxRateBps, discount: line.discount, notes: line.notes };
  });

  let lines: CartLine[];
  let totals: Totals;
  try {
    lines = distributeDiscount(cart, input.orderDiscount ?? 0);
    totals = calculateTotals(lines);
  } catch {
    return fail(422, "INVALID_DISCOUNT");
  }
  const access = accessOf(options.staff);
  if (fromPos && !discountAllowed(access, totals.subtotal, totals.discount)) {
    fail(403, "DISCOUNT_NOT_ALLOWED", { maxDiscount: Math.floor((totals.subtotal * maxDiscountBps(access)) / 10_000) });
  }
  return { lines, totals, stockConflict };
}

export function createOrder(ctx: AppContext, input: OrderInput, options: OrderOptions): { order: OrderRecord; change: number } {
  const { store } = ctx;
  const fromPos = options.channel === "pos";
  const { lines, totals, stockConflict } = priceOrder(ctx, input, options);

  const paid = input.payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (paid < totals.total) fail(422, "PAYMENT_SHORT", { due: totals.total - paid });
  const change = paid - totals.total;
  const cashPaid = input.payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amount, 0);
  if (change > cashPaid) fail(422, "OVERPAYMENT_WITHOUT_CASH", { change });

  if (input.customerId && !store.customers.has(input.customerId)) fail(404, "CUSTOMER_NOT_FOUND");
  const table = input.tableId ? store.tables.get(input.tableId) : undefined;
  if (input.tableId && !table) fail(404, "TABLE_NOT_FOUND");
  if (table && input.type !== "dine_in") fail(422, "TABLE_REQUIRES_DINE_IN");

  const createdAt = now();
  const orderId = newId();
  const recordLines: OrderLineRecord[] = lines.map((line) => {
    const product = store.products.get(line.productId)!;
    const computed = calculateLine(line);
    return {
      productId: product.id, sku: product.sku, name: product.nameAr, category: product.category, quantity: line.quantity,
      unitPrice: line.unitPrice, unitCost: product.cost ?? 0, discount: computed.discount, taxRateBps: line.taxRateBps, tax: computed.tax,
      refundedQuantity: 0, notes: line.notes,
      ...(line.unitPrice !== product.price && fromPos ? { priceOverride: { originalPrice: product.price, approvedBy: options.staff.id } } : {})
    };
  });

  const cost = recordLines.reduce((sum, line) => sum + line.unitCost * line.quantity, 0);
  const lineEntries = saleEntryLines({ payments: input.payments, change, taxable: totals.taxable, tax: totals.tax, cost });

  for (const line of recordLines) {
    store.products.get(line.productId)!.stock -= line.quantity;
    store.movements.push({ id: newId(), productId: line.productId, quantity: -line.quantity, reason: STOCK_REASON[options.channel] ?? "delivery_sale", refId: orderId, createdAt });
  }

  const order: OrderRecord = {
    id: orderId, receiptNumber: store.nextReceipt(), type: input.type, channel: options.channel, status: "paid",
    lines: recordLines, payments: input.payments, change, totals, cashierId: options.staff.id,
    customerId: input.customerId, tableId: input.tableId, shiftId: store.openShift()?.id, externalOrderId: options.externalOrderId,
    offline: options.offline ? { ...options.offline, stockConflict } : undefined,
    invoiceToken: randomToken(), createdAt
  };
  store.orders.set(order.id, order);
  postJournal(ctx, { description: `فاتورة مبيعات ${order.receiptNumber}`, source: { type: "order", id: order.id }, lines: lineEntries, createdBy: options.staff.id });

  if (table) {
    table.status = "occupied";
    table.orderIds.push(order.id);
    table.occupiedSince ??= createdAt;
  }
  if (hasFeature(store.settings.businessType, "kitchen")) {
    const ticketId = newId();
    store.kitchenTickets.set(ticketId, {
      id: ticketId, orderId: order.id, receiptNumber: order.receiptNumber, channel: order.channel, orderType: order.type, tableLabel: table?.label,
      items: recordLines.map((line) => ({ name: line.name, quantity: line.quantity, notes: line.notes })), status: "new", createdAt
    });
  }
  enqueueStoreSync(ctx, recordLines.map((line) => line.productId));
  emit(ctx, "order.created", order);
  return { order, change };
}

export interface RefundInput {
  lines: Array<{ productId: string; quantity: number }>;
  method?: PaymentMethod;
  reason: string;
}

export function refundOrder(ctx: AppContext, orderId: string, input: RefundInput, staff: StaffMember): RefundRecord {
  const order = ctx.store.orders.get(orderId);
  if (!order) return fail(404, "ORDER_NOT_FOUND");
  const createdAt = now();
  const refundLines = input.lines.map((requested) => {
    const line = order.lines.find((candidate) => candidate.productId === requested.productId);
    if (!line) return fail(422, "LINE_NOT_IN_ORDER", { productId: requested.productId });
    if (requested.quantity > line.quantity - line.refundedQuantity) fail(422, "REFUND_EXCEEDS_SOLD", { productId: line.productId, refundable: line.quantity - line.refundedQuantity });
    const lineTaxable = line.unitPrice * line.quantity - line.discount;
    return {
      line, quantity: requested.quantity,
      taxable: Math.round((lineTaxable * requested.quantity) / line.quantity),
      tax: Math.round((line.tax * requested.quantity) / line.quantity),
      cost: line.unitCost * requested.quantity
    };
  });
  const taxable = refundLines.reduce((sum, line) => sum + line.taxable, 0);
  const tax = refundLines.reduce((sum, line) => sum + line.tax, 0);
  const cost = refundLines.reduce((sum, line) => sum + line.cost, 0);
  const method = input.method ?? order.payments[0].method;

  for (const { line, quantity } of refundLines) {
    line.refundedQuantity += quantity;
    ctx.store.products.get(line.productId)!.stock += quantity;
    ctx.store.movements.push({ id: newId(), productId: line.productId, quantity, reason: "refund", refId: order.id, createdAt });
  }
  order.status = order.lines.every((line) => line.refundedQuantity === line.quantity) ? "refunded" : "partially_refunded";
  const refund: RefundRecord = {
    id: newId(), orderId: order.id, receiptNumber: order.receiptNumber, total: taxable + tax, method, reason: input.reason, staffId: staff.id,
    shiftId: ctx.store.openShift()?.id, createdAt,
    lines: refundLines.map(({ line, quantity, taxable, tax, cost }) => ({ productId: line.productId, quantity, taxable, tax, cost }))
  };
  ctx.store.refunds.set(refund.id, refund);
  postJournal(ctx, { description: `مرتجع مبيعات للفاتورة ${order.receiptNumber}`, source: { type: "refund", id: refund.id }, lines: refundEntryLines({ method, taxable, tax, cost }), createdBy: staff.id });
  enqueueStoreSync(ctx, refundLines.map(({ line }) => line.productId));
  emit(ctx, "order.refunded", refund);
  return refund;
}
