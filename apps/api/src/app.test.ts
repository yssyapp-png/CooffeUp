import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { getOrCreateLoyaltyAccount } from "./store.js";

process.env.NODE_ENV = "test";
const app = await buildApp();
beforeAll(() => app.ready());
afterAll(() => app.close());

describe("orders API", () => {
  it("rejects requests without an idempotency key", async () => {
    const result = await app.inject({method:"POST",url:"/api/v1/orders",payload:{}});
    expect(result.statusCode).toBe(400);
  });
  it("creates an order once and replays retries", async () => {
    const payload = {type:"takeaway",lines:[{productId:"espresso",quantity:1}],payments:[{method:"mada",amount:1380}]};
    const first = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"test-order-001"},payload});
    const retry = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"test-order-001"},payload});
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().replayed).toBe(true);
  });
  it("awards loyalty points once even when the order is retried", async () => {
    const customerMobile = "0551234567";
    const payload = {type:"takeaway",customerMobile,lines:[{productId:"latte",quantity:1}],payments:[{method:"mada",amount:2070}]};
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
    const payload = {type:"takeaway",customerMobile,redeemReward:"free_drink",lines:[{productId:"espresso",quantity:1},{productId:"croissant",quantity:1}],payments:[{method:"mada",amount:1610}]};
    const result = await app.inject({method:"POST",url:"/api/v1/orders",headers:{"idempotency-key":"reward-order-001"},payload});
    expect(result.statusCode).toBe(201);
    expect(result.json().data.totals.total).toBe(1610);
    expect(result.json().data.loyalty.points).toBe(14);
  });
});
