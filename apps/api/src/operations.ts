import type { CartLine, OrderType, PaymentMethod } from "@cooffeup/shared";

export type ShiftStatus = "open" | "closed";
export type CashMovementType = "cash_in" | "cash_out";

export interface Shift {
  id: string;
  cashierId: string;
  openingFloat: number;
  status: ShiftStatus;
  openedAt: string;
  closedAt?: string;
  expectedCash?: number;
  countedCash?: number;
  variance?: number;
}

export interface CashMovement {
  id: string;
  shiftId: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  actorId: string;
  createdAt: string;
}

export interface SuspendedOrder {
  id: string;
  shiftId: string;
  type: OrderType;
  lines: Array<Pick<CartLine, "productId" | "quantity" | "discount" | "notes">>;
  note?: string;
  suspendedBy: string;
  suspendedAt: string;
  resumedAt?: string;
}

export interface Refund {
  id: string;
  orderId: string;
  shiftId: string;
  amount: number;
  method: PaymentMethod;
  reason: string;
  approvedBy: string;
  createdAt: string;
}

export const shifts = new Map<string, Shift>();
export const cashMovements = new Map<string, CashMovement>();
export const suspendedOrders = new Map<string, SuspendedOrder>();
export const refunds = new Map<string, Refund>();

export const activeShiftForCashier = (cashierId: string) =>
  [...shifts.values()].find((shift) => shift.cashierId === cashierId && shift.status === "open");

export const refundedAmount = (orderId: string) =>
  [...refunds.values()].filter((refund) => refund.orderId === orderId).reduce((sum, refund) => sum + refund.amount, 0);

export const expectedCashForShift = (shift: Shift, cashSales: number, cashRefunds = 0) => {
  const movementTotal = [...cashMovements.values()]
    .filter((movement) => movement.shiftId === shift.id)
    .reduce((sum, movement) => sum + (movement.type === "cash_in" ? movement.amount : -movement.amount), 0);
  return shift.openingFloat + cashSales - cashRefunds + movementTotal;
};
