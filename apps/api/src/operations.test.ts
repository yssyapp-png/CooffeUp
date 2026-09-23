import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { cashMovements, refunds, shifts, suspendedOrders } from "./operations.js";
import { idempotency, loyaltyAccounts, loyaltyLedger, orders, products } from "./store.js";

process.env.NODE_ENV = "test";
process.env.MANAGER_APPROVAL_TOKEN = "test-manager-token";
const app = await buildApp();
const initialStocks = new Map([...products].map(([id, product]) => [id, product.stock]));
beforeAll(() => app.ready());
afterAll(() => app.close());
beforeEach(() => {
  shifts.clear(); cashMovements.clear(); suspendedOrders.clear(); refunds.clear(); orders.clear(); idempotency.clear(); loyaltyAccounts.clear(); loyaltyLedger.length = 0;
  for (const [id, stock] of initialStocks) products.get(id)!.stock = stock;
});

async function openShift() {
  return app.inject({ method: "POST", url: "/api/v1/shifts/open", payload: { cashierId: "cashier-1", openingFloat: 50_000 } });
}

describe("cashier operations", () => {
  it("prevents two active shifts for one cashier", async () => {
    expect((await openShift()).statusCode).toBe(201);
    const duplicate = await openShift();
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe("SHIFT_ALREADY_OPEN");
  });

  it("tracks cash movements and calculates close variance", async () => {
    const shift = (await openShift()).json().data;
    const movement = await app.inject({ method: "POST", url: `/api/v1/shifts/${shift.id}/movements`, payload: { type: "cash_out", amount: 5_000, reason: "شراء مستلزمات عاجلة", actorId: "cashier-1" } });
    expect(movement.statusCode).toBe(201);
    const close = await app.inject({ method: "POST", url: `/api/v1/shifts/${shift.id}/close`, payload: { countedCash: 44_500 } });
    expect(close.statusCode).toBe(200);
    expect(close.json().data.expectedCash).toBe(45_000);
    expect(close.json().data.variance).toBe(-500);
  });

  it("rejects cash withdrawals above the drawer balance", async () => {
    const shift = (await openShift()).json().data;
    const result = await app.inject({ method: "POST", url: `/api/v1/shifts/${shift.id}/movements`, payload: { type: "cash_out", amount: 50_001, reason: "سحب يتجاوز الرصيد", actorId: "cashier-1" } });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toEqual({ error: "INSUFFICIENT_CASH_IN_DRAWER", available: 50_000 });
  });

  it("suspends and resumes an order only once", async () => {
    const shift = (await openShift()).json().data;
    const suspended = await app.inject({ method: "POST", url: "/api/v1/suspended-orders", payload: { shiftId: shift.id, type: "takeaway", lines: [{ productId: "latte", quantity: 2 }], suspendedBy: "cashier-1" } });
    expect(suspended.statusCode).toBe(201);
    const id = suspended.json().data.id;
    expect((await app.inject({ method: "POST", url: `/api/v1/suspended-orders/${id}/resume` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/suspended-orders/${id}/resume` })).statusCode).toBe(409);
  });

  it("does not resume a suspended order after its shift closes", async () => {
    const shift = (await openShift()).json().data;
    const suspended = await app.inject({ method: "POST", url: "/api/v1/suspended-orders", payload: { shiftId: shift.id, type: "takeaway", lines: [{ productId: "latte", quantity: 1 }], suspendedBy: "cashier-1" } });
    await app.inject({ method: "POST", url: `/api/v1/shifts/${shift.id}/close`, payload: { countedCash: 50_000 } });
    const result = await app.inject({ method: "POST", url: `/api/v1/suspended-orders/${suspended.json().data.id}/resume` });
    expect(result.statusCode).toBe(409);
    expect(result.json().error).toBe("SHIFT_CLOSED");
  });

  it("requires manager approval and prevents refunding an item twice", async () => {
    const shift = (await openShift()).json().data;
    const sale = await app.inject({ method: "POST", url: "/api/v1/orders", headers: { "idempotency-key": "refund-sale-001" }, payload: { shiftId: shift.id, type: "takeaway", lines: [{ productId: "espresso", quantity: 1 }], payments: [{ method: "mada", amount: 1_380 }] } });
    const orderId = sale.json().data.id;
    const denied = await app.inject({ method: "POST", url: `/api/v1/orders/${orderId}/refunds`, payload: { shiftId: shift.id, method: "mada", lines: [{ productId: "espresso", quantity: 1 }], reason: "طلب العميل" } });
    expect(denied.statusCode).toBe(403);
    const headers = { "x-manager-approval-token": "test-manager-token", "x-actor-id": "manager-1", "x-actor-role": "manager" };
    expect((await app.inject({ method: "POST", url: `/api/v1/orders/${orderId}/refunds`, headers, payload: { shiftId: shift.id, method: "mada", lines: [{ productId: "espresso", quantity: 1 }], reason: "طلب العميل" } })).statusCode).toBe(201);
    const tooMuch = await app.inject({ method: "POST", url: `/api/v1/orders/${orderId}/refunds`, headers, payload: { shiftId: shift.id, method: "mada", lines: [{ productId: "espresso", quantity: 1 }], reason: "طلب العميل" } });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().error).toBe("REFUND_QUANTITY_EXCEEDS_REMAINING");
  });

  it("subtracts cash refunds from expected cash at shift close", async () => {
    const shift = (await openShift()).json().data;
    const sale = await app.inject({ method: "POST", url: "/api/v1/orders", headers: { "idempotency-key": "cash-refund-sale-001" }, payload: { shiftId: shift.id, type: "takeaway", lines: [{ productId: "espresso", quantity: 2 }], payments: [{ method: "cash", amount: 2_760 }] } });
    const headers = { "x-manager-approval-token": "test-manager-token", "x-actor-id": "manager-1", "x-actor-role": "manager" };
    const refund = await app.inject({ method: "POST", url: `/api/v1/orders/${sale.json().data.id}/refunds`, headers, payload: { shiftId: shift.id, method: "cash", lines: [{ productId: "espresso", quantity: 1 }], reason: "طلب العميل" } });
    expect(refund.statusCode).toBe(201);
    const close = await app.inject({ method: "POST", url: `/api/v1/shifts/${shift.id}/close`, payload: { countedCash: 51_380 } });
    expect(close.json().data.expectedCash).toBe(51_380);
    expect(close.json().data.variance).toBe(0);
  });

  it("subtracts customer change from cash sales", async () => {
    const shift = (await openShift()).json().data;
    const sale = await app.inject({ method: "POST", url: "/api/v1/orders", headers: { "idempotency-key": "cash-change-sale-001" }, payload: { shiftId: shift.id, type: "takeaway", lines: [{ productId: "latte", quantity: 1 }], payments: [{ method: "cash", amount: 5_000 }] } });
    expect(sale.json().data.change).toBe(2_930);
    const close = await app.inject({ method: "POST", url: `/api/v1/shifts/${shift.id}/close`, payload: { countedCash: 52_070 } });
    expect(close.json().data.expectedCash).toBe(52_070);
    expect(close.json().data.variance).toBe(0);
  });

  it("does not refund a card payment from the cash drawer", async () => {
    const shift = (await openShift()).json().data;
    const sale = await app.inject({ method: "POST", url: "/api/v1/orders", headers: { "idempotency-key": "method-match-sale-001" }, payload: { shiftId: shift.id, type: "takeaway", lines: [{ productId: "espresso", quantity: 1 }], payments: [{ method: "mada", amount: 1_380 }] } });
    const headers = { "x-manager-approval-token": "test-manager-token", "x-actor-id": "manager-1", "x-actor-role": "manager" };
    const refund = await app.inject({ method: "POST", url: `/api/v1/orders/${sale.json().data.id}/refunds`, headers, payload: { shiftId: shift.id, method: "cash", lines: [{ productId: "espresso", quantity: 1 }], reason: "طلب العميل" } });
    expect(refund.statusCode).toBe(409);
    expect(refund.json()).toEqual({ error: "REFUND_METHOD_MISMATCH", available: 0 });
  });

  it("restores stock and reverses earned loyalty points", async () => {
    const shift = (await openShift()).json().data;
    const stockBefore = products.get("latte")!.stock;
    const sale = await app.inject({ method: "POST", url: "/api/v1/orders", headers: { "idempotency-key": "loyalty-refund-sale-001" }, payload: { shiftId: shift.id, type: "takeaway", customerMobile: "0551234567", lines: [{ productId: "latte", quantity: 1 }], payments: [{ method: "mada", amount: 2_070 }] } });
    const account = loyaltyAccounts.get("+966551234567")!;
    expect(account.points).toBe(18);
    expect(products.get("latte")!.stock).toBe(stockBefore - 1);
    const headers = { "x-manager-approval-token": "test-manager-token", "x-actor-id": "manager-1", "x-actor-role": "manager" };
    const refund = await app.inject({ method: "POST", url: `/api/v1/orders/${sale.json().data.id}/refunds`, headers, payload: { shiftId: shift.id, method: "mada", lines: [{ productId: "latte", quantity: 1 }], reason: "طلب العميل" } });
    expect(refund.statusCode).toBe(201);
    expect(products.get("latte")!.stock).toBe(stockBefore);
    expect(account.points).toBe(0);
    expect(account.visits).toBe(0);
  });
});
