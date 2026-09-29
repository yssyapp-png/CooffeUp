import type { PaymentMethod, ShiftRecord } from "@cooffeup/shared";
import type { AppContext } from "../context.js";

const METHODS: PaymentMethod[] = ["cash", "card", "mada", "apple_pay", "stc_pay", "online", "delivery_platform"];

/** Cash that should be in the drawer: float + cash sales − change − cash refunds − cash expenses ± movements. */
export function shiftCashSummary(ctx: AppContext, shift: ShiftRecord) {
  const { store } = ctx;
  const orders = [...store.orders.values()].filter((order) => order.shiftId === shift.id);
  const refunds = [...store.refunds.values()].filter((refund) => refund.shiftId === shift.id);
  const movements = [...store.cashMovements.values()].filter((movement) => movement.shiftId === shift.id);
  const cashSales = orders.reduce((sum, order) => sum + order.payments.filter((payment) => payment.method === "cash").reduce((s, p) => s + p.amount, 0) - order.change, 0);
  const cashRefunds = refunds.filter((refund) => refund.method === "cash").reduce((sum, refund) => sum + refund.total, 0);
  const cashExpenses = [...store.expenses.values()].filter((expense) => expense.shiftId === shift.id && expense.paidFrom === "cash").reduce((sum, expense) => sum + expense.total, 0);
  const cashIn = movements.filter((movement) => movement.type === "cash_in").reduce((sum, movement) => sum + movement.amount, 0);
  const cashOut = movements.filter((movement) => movement.type === "cash_out").reduce((sum, movement) => sum + movement.amount, 0);
  return {
    orders: orders.length, cashSales, cashRefunds, cashExpenses, cashIn, cashOut,
    expectedCash: shift.openingFloat + cashSales - cashRefunds - cashExpenses + cashIn - cashOut
  };
}

/** Manager report for one shift: sales, refunds and collections per payment method. */
export function shiftReport(ctx: AppContext, shift: ShiftRecord) {
  const orders = [...ctx.store.orders.values()].filter((order) => order.shiftId === shift.id);
  const refunds = [...ctx.store.refunds.values()].filter((refund) => refund.shiftId === shift.id);
  const tenders = Object.fromEntries(METHODS.map((method) => [method, orders.reduce((sum, order) =>
    sum + order.payments.filter((payment) => payment.method === method).reduce((s, p) => s + p.amount, 0) - (method === "cash" ? order.change : 0), 0)]));
  const refundsByMethod = Object.fromEntries(METHODS.map((method) => [method, refunds.filter((refund) => refund.method === method).reduce((sum, refund) => sum + refund.total, 0)]));
  const sales = orders.reduce((sum, order) => sum + order.totals.total, 0);
  const refunded = refunds.reduce((sum, refund) => sum + refund.total, 0);
  return {
    shift, ...shiftCashSummary(ctx, shift), refundCount: refunds.length, sales, refunded, netSales: sales - refunded,
    discounts: orders.reduce((sum, order) => sum + order.totals.discount, 0), tenders, refundsByMethod
  };
}
