import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

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
});
