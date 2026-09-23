import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { shifts } from "./operations.js";
import { getOrCreateLoyaltyAccount, idempotency, loyaltyAccounts, loyaltyLedger, orders, products } from "./store.js";

process.env.NODE_ENV = "test";
process.env.MANAGER_APPROVAL_TOKEN = "test-manager-token";
const app = await buildApp();
const initialStocks = new Map([...products].map(([id, product]) => [id, product.stock]));
beforeAll(() => app.ready());
afterAll(() => app.close());
beforeEach(() => {
  shifts.clear(); orders.clear(); idempotency.clear(); loyaltyAccounts.clear(); loyaltyLedger.length = 0;
  for (const [id, stock] of initialStocks) products.get(id)!.stock = stock;
});

async function openShift() {
  const result = await app.inject({ method: "POST", url: "/api/v1/shifts/open", payload: { cashierId: "cashier-1", openingFloat: 50_000 } });
  return result.json().data.id as string;
}

describe("orders API", () => {
  it("rejects requests without an idempotency key", async () => {
    const result = await app.inject({method:"POST",url:"/api/v1/orders",payload:{}});
    expect(result.statusCode).toBe(400);
  });
  it("creates an order once and replays retries", async () => {
    const payload = {shiftId:await openShift(),type:"takeaway",lines:[{productId:"espresso",quantity:1}],payments:[{method:"mada",amount:1380}]};
    const first = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"test-order-001"},payload});
    const retry = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"test-order-001"},payload});
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().replayed).toBe(true);
  });
  it("awards loyalty points once even when the order is retried", async () => {
    const customerMobile = "0551234567";
    const payload = {shiftId:await openShift(),type:"takeaway",customerMobile,lines:[{productId:"latte",quantity:1}],payments:[{method:"mada",amount:2070}]};
    const first = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"loyalty-order-001"},payload});
    const afterFirst = first.json().data.loyalty;
    await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"loyalty-order-001"},payload});
    const loyalty = await app.inject({method:"GET",url:`/api/v1/customers/${encodeURIComponent(customerMobile)}/loyalty`});
    expect(afterFirst.visits).toBe(1);
    expect(loyalty.json().data).toEqual(afterFirst);
  });

  it("redeems one eligible drink and deducts reward points", async () => {
    const customerMobile = "+966552345678";
    getOrCreateLoyaltyAccount(customerMobile).points = 100;
    const payload = {shiftId:await openShift(),type:"takeaway",customerMobile,redeemReward:"free_drink",lines:[{productId:"espresso",quantity:1},{productId:"croissant",quantity:1}],payments:[{method:"mada",amount:1610}]};
    const result = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"reward-order-001"},payload});
    expect(result.statusCode).toBe(201);
    expect(result.json().data.totals.total).toBe(1610);
    expect(result.json().data.loyalty.points).toBe(14);
  });

  it("rejects orders for missing and closed shifts", async () => {
    const missing = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"missing-shift-001"},payload:{shiftId:crypto.randomUUID(),type:"takeaway",lines:[{productId:"espresso",quantity:1}],payments:[{method:"mada",amount:1380}]}});
    expect(missing.statusCode).toBe(404);
    const shiftId = await openShift();
    await app.inject({method:"POST",url:`/api/v1/shifts/${shiftId}/close`,payload:{countedCash:50_000}});
    const closed = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"closed-shift-001"},payload:{shiftId,type:"takeaway",lines:[{productId:"espresso",quantity:1}],payments:[{method:"mada",amount:1380}]}});
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error).toBe("SHIFT_CLOSED");
  });

  it("requires manager approval for a manual discount", async () => {
    const payload = {shiftId:await openShift(),type:"takeaway",lines:[{productId:"espresso",quantity:1,discount:200}],payments:[{method:"mada",amount:1150}]};
    const denied = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"discount-denied-001"},payload});
    expect(denied.statusCode).toBe(403);
    const approved = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"discount-approved-001","x-manager-approval-token":"test-manager-token","x-actor-id":"manager-1","x-actor-role":"manager"},payload});
    expect(approved.statusCode).toBe(201);
    expect(approved.json().data.totals.total).toBe(1150);
  });
});
