import {
  calculateLine, calculateTotals, discountAllowed, distributeDiscount, FREE_DRINK_POINTS, hasFeature, maxDiscountBps, refundEntryLines, refundSlice, saleEntryLines,
  type Branch, type CartLine, type Totals, type OrderLineRecord, type OrderRecord, type OrderType, type PaymentMethod, type RefundRecord, type SalesChannel
} from "@cooffeup/shared";
import { accessOf, fail, newId, now, staffCan, type AppContext } from "../context.js";
import { randomToken } from "../security.js";
import { MAIN_BRANCH_ID, type StaffMember } from "../store.js";
import { emit } from "./events.js";
import { postJournal } from "./ledger.js";
import { applyOrderLoyalty, reverseOrderLoyalty } from "./loyalty.js";
import { shiftCashSummary } from "./shifts.js";
import { enqueueStoreSync } from "./store-sync.js";

export interface OrderInput {
  type: OrderType;
  lines: Array<{ productId: string; quantity: number; discount?: number; unitPrice?: number; notes?: string }>;
  orderDiscount?: number;
  payments: Array<{ method: PaymentMethod; amount: number; reference?: string }>;
  customerId?: string;
  tableId?: string;
  /** Spend loyalty points on one reward-eligible drink in this order. */
  redeemReward?: "free_drink";
}

export interface OrderOptions {
  staff: StaffMember;
  channel: SalesChannel;
  /** Branch whose stock, shift and kitchen the order uses. */
  branchId: string;
  externalOrderId?: string;
  /** Sales captured offline already happened, so they are recorded even if stock went negative. */
  offline?: { deviceId: string; localReceipt: string; capturedAt: string };
  /** Orders already accepted by an online store must be recorded even when local stock is short. */
  allowNegativeStock?: boolean;
}

/** Temporary branches (booths) only trade between their start and end dates. */
export function branchIsOpen(branch: Branch, at = new Date()) {
  if (!branch.active) return false;
  const time = at.toISOString();
  return (!branch.startsAt || time >= branch.startsAt) && (!branch.endsAt || time <= branch.endsAt);
}

const STOCK_REASON: Record<string, "sale" | "online_sale" | "delivery_sale"> = { pos: "sale", zid: "online_sale", salla: "online_sale" };

/** Validates the lines and prices the order without changing any state. */
export function priceOrder(ctx: AppContext, input: Pick<OrderInput, "lines" | "orderDiscount" | "customerId" | "redeemReward">, options: OrderOptions) {
  const { store } = ctx;
  const fromPos = options.channel === "pos";
  let stockConflict = false;

  const requested = new Map<string, number>();
  const cart: CartLine[] = input.lines.map((line) => {
    const product = store.products.get(line.productId);
    if (!product?.active) return fail(404, "PRODUCT_NOT_FOUND", { productId: line.productId });
    const totalRequested = (requested.get(product.id) ?? 0) + line.quantity;
    requested.set(product.id, totalRequested);
    const available = store.stockAt(options.branchId, product.id);
    if (available < totalRequested) {
      if (!options.offline && !options.allowNegativeStock) fail(409, "INSUFFICIENT_STOCK", { productId: product.id, available });
      stockConflict = true;
    }
    const unitPrice = line.unitPrice ?? product.price;
    if (unitPrice !== product.price && fromPos && !staffCan(options.staff, "pos.price_override")) {
      fail(403, "PRICE_OVERRIDE_NOT_ALLOWED", { productId: product.id });
    }
    return { productId: product.id, name: product.nameAr, unitPrice, quantity: line.quantity, taxRateBps: product.taxRateBps, discount: line.discount, notes: line.notes };
  });

  // The reward is applied before the order discount so the discount spreads over what is left to pay.
  let rewardDiscount = 0;
  if (input.redeemReward === "free_drink") {
    if (!input.customerId) fail(422, "CUSTOMER_REQUIRED_FOR_REWARD");
    const points = store.loyalty.get(input.customerId!)?.points ?? 0;
    if (points < FREE_DRINK_POINTS) fail(409, "INSUFFICIENT_LOYALTY_POINTS", { required: FREE_DRINK_POINTS, available: points });
    const eligible = cart.filter((line) => store.products.get(line.productId)?.rewardEligible && line.unitPrice * line.quantity - (line.discount ?? 0) >= line.unitPrice)
      .sort((a, b) => b.unitPrice - a.unitPrice)[0];
    if (!eligible) fail(422, "NO_REWARD_ELIGIBLE_DRINK");
    eligible!.discount = (eligible!.discount ?? 0) + eligible!.unitPrice;
    rewardDiscount = eligible!.unitPrice;
  }

  let lines: CartLine[];
  let totals: Totals;
  try {
    lines = distributeDiscount(cart, input.orderDiscount ?? 0);
    totals = calculateTotals(lines);
  } catch {
    return fail(422, "INVALID_DISCOUNT");
  }
  // A redeemed reward is paid for with points, so it does not count against the cashier's discount limit.
  const access = accessOf(options.staff);
  if (fromPos && !discountAllowed(access, totals.subtotal, totals.discount - rewardDiscount)) {
    fail(403, "DISCOUNT_NOT_ALLOWED", { maxDiscount: Math.floor((totals.subtotal * maxDiscountBps(access)) / 10_000) });
  }
  return { lines, totals, stockConflict };
}

export function createOrder(ctx: AppContext, input: OrderInput, options: OrderOptions): { order: OrderRecord; change: number } {
  const { store } = ctx;
  const fromPos = options.channel === "pos";
  const branch = store.branches.get(options.branchId) ?? fail(404, "BRANCH_NOT_FOUND");
  // Offline sales already happened, so only live sales are held to the branch's opening window.
  if (!options.offline && !branchIsOpen(branch)) fail(409, "BRANCH_CLOSED");
  const shift = store.openShift(branch.id);
  // Offline sales are replayed after the fact and platform orders are not rung up at the till.
  if (fromPos && !options.offline && store.settings.requireOpenShift && !shift) fail(409, "SHIFT_REQUIRED");
  if (input.customerId && !store.customers.has(input.customerId)) fail(404, "CUSTOMER_NOT_FOUND");
  const { lines, totals, stockConflict } = priceOrder(ctx, input, options);

  const paid = input.payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (paid < totals.total) fail(422, "PAYMENT_SHORT", { due: totals.total - paid });
  const change = paid - totals.total;
  const cashPaid = input.payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amount, 0);
  if (change > cashPaid) fail(422, "OVERPAYMENT_WITHOUT_CASH", { change });

  const table = input.tableId ? store.tables.get(input.tableId) : undefined;
  if (input.tableId && !table) fail(404, "TABLE_NOT_FOUND");
  if (table && input.type !== "dine_in") fail(422, "TABLE_REQUIRES_DINE_IN");
  if (table && (table.branchId ?? MAIN_BRANCH_ID) !== branch.id) fail(422, "TABLE_IN_OTHER_BRANCH");

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
    store.adjustStock(branch.id, line.productId, -line.quantity);
    store.movements.push({ id: newId(), branchId: branch.id, productId: line.productId, quantity: -line.quantity, reason: STOCK_REASON[options.channel] ?? "delivery_sale", refId: orderId, createdAt });
  }

  const order: OrderRecord = {
    id: orderId, receiptNumber: store.nextReceipt(), type: input.type, channel: options.channel, status: "paid",
    lines: recordLines, payments: input.payments, change, totals, cashierId: options.staff.id, branchId: branch.id,
    customerId: input.customerId, tableId: input.tableId, shiftId: shift?.id, externalOrderId: options.externalOrderId,
    offline: options.offline ? { ...options.offline, stockConflict } : undefined,
    invoiceToken: randomToken(), createdAt
  };
  store.orders.set(order.id, order);
  applyOrderLoyalty(ctx, order, input.redeemReward === "free_drink");
  postJournal(ctx, { description: `فاتورة مبيعات ${order.receiptNumber}`, source: { type: "order", id: order.id }, lines: lineEntries, createdBy: options.staff.id });

  if (table) {
    table.status = "occupied";
    table.orderIds.push(order.id);
    table.occupiedSince ??= createdAt;
  }
  if (hasFeature(store.settings.businessType, "kitchen")) {
    const ticketId = newId();
    store.kitchenTickets.set(ticketId, {
      id: ticketId, branchId: branch.id, orderId: order.id, receiptNumber: order.receiptNumber, channel: order.channel, orderType: order.type, tableLabel: table?.label,
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

/** What is still refundable through each payment method of an order. */
function refundableByMethod(ctx: AppContext, order: OrderRecord) {
  const available = new Map<PaymentMethod, number>();
  for (const payment of order.payments) available.set(payment.method, (available.get(payment.method) ?? 0) + payment.amount);
  if (order.change) available.set("cash", (available.get("cash") ?? 0) - order.change);
  for (const refund of ctx.store.refunds.values()) {
    if (refund.orderId === order.id) available.set(refund.method, (available.get(refund.method) ?? 0) - refund.total);
  }
  return available;
}

/** Refunds happen at `branchId`: returned goods go back into its stock and cash leaves its drawer. */
export function refundOrder(ctx: AppContext, orderId: string, input: RefundInput, staff: StaffMember, branchId = MAIN_BRANCH_ID): RefundRecord {
  const { store } = ctx;
  const order = store.orders.get(orderId);
  if (!order) return fail(404, "ORDER_NOT_FOUND");
  const createdAt = now();
  const requested = new Map<string, number>();
  const refundLines = input.lines.map((request) => {
    const line = order.lines.find((candidate) => candidate.productId === request.productId);
    if (!line) return fail(422, "LINE_NOT_IN_ORDER", { productId: request.productId });
    const already = line.refundedQuantity + (requested.get(line.productId) ?? 0);
    if (request.quantity > line.quantity - already) fail(422, "REFUND_EXCEEDS_SOLD", { productId: line.productId, refundable: line.quantity - already });
    requested.set(line.productId, (requested.get(line.productId) ?? 0) + request.quantity);
    return { line, quantity: request.quantity, ...refundSlice(line, already, request.quantity), cost: line.unitCost * request.quantity };
  });
  const taxable = refundLines.reduce((sum, line) => sum + line.taxable, 0);
  const tax = refundLines.reduce((sum, line) => sum + line.tax, 0);
  const cost = refundLines.reduce((sum, line) => sum + line.cost, 0);
  const total = taxable + tax;

  // Money goes back the way it came in: never more than was collected through that method.
  const available = refundableByMethod(ctx, order);
  const method = input.method ?? [...available.entries()].find(([, amount]) => amount >= total)?.[0];
  if (!method || (available.get(method) ?? 0) < total) {
    fail(409, "REFUND_METHOD_MISMATCH", { available: Object.fromEntries(available) });
  }
  const shift = store.openShift(branchId);
  if (method === "cash" && order.channel === "pos") {
    if (store.settings.requireOpenShift && !shift) fail(409, "SHIFT_REQUIRED");
    if (shift) {
      const inDrawer = shiftCashSummary(ctx, shift).expectedCash;
      if (total > inDrawer) fail(409, "INSUFFICIENT_CASH_IN_DRAWER", { available: inDrawer });
    }
  }

  for (const { line, quantity } of refundLines) {
    line.refundedQuantity += quantity;
    store.adjustStock(branchId, line.productId, quantity);
    store.movements.push({ id: newId(), branchId, productId: line.productId, quantity, reason: "refund", refId: order.id, createdAt });
  }
  order.status = order.lines.every((line) => line.refundedQuantity === line.quantity) ? "refunded" : "partially_refunded";
  const refund: RefundRecord = {
    id: newId(), orderId: order.id, receiptNumber: order.receiptNumber, total, method: method!, reason: input.reason, staffId: staff.id,
    shiftId: shift?.id, createdAt,
    lines: refundLines.map(({ line, quantity, taxable, tax, cost }) => ({ productId: line.productId, quantity, taxable, tax, cost }))
  };
  store.refunds.set(refund.id, refund);
  const refundedTotal = [...store.refunds.values()].filter((entry) => entry.orderId === order.id).reduce((sum, entry) => sum + entry.total, 0);
  reverseOrderLoyalty(ctx, order, refundedTotal);
  postJournal(ctx, { description: `مرتجع مبيعات للفاتورة ${order.receiptNumber}`, source: { type: "refund", id: refund.id }, lines: refundEntryLines({ method: method!, taxable, tax, cost }), createdBy: staff.id });
  enqueueStoreSync(ctx, refundLines.map(({ line }) => line.productId));
  emit(ctx, "order.refunded", refund);
  return refund;
}
