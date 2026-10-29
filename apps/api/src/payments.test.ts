import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { MoyasarPayment } from "./moyasar.js";

process.env.NODE_ENV = "test";
const payments = new Map<string, MoyasarPayment>();
const skylineCalls: Array<{url:string;body:any;headers:any}> = [];
const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://api.moyasar.com/v1/payments/")) {
    expect(new Headers(init?.headers).get("authorization")).toBe(`Basic ${Buffer.from("sk_test_x:").toString("base64")}`);
    const payment = payments.get(decodeURIComponent(url.split("/").pop()!));
    return payment ? Response.json(payment) : new Response("{}", {status:404});
  }
  if (url === "https://skyline.test/api/orders") {
    skylineCalls.push({url, body:JSON.parse(String(init?.body)), headers:new Headers(init?.headers)});
    return Response.json({ok:true}, {status:201});
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

const app = await buildApp({
  fetch: fakeFetch,
  moyasar: {secretKey:"sk_test_x", publishableKey:"pk_test_x", webhookSecret:"whsec_test", callbackUrl:"http://localhost:5173/payment/callback"},
  skyline: {baseUrl:"https://skyline.test/api", apiKey:"sky_key", ordersPath:"/orders", branchId:"B1"}
});
beforeAll(() => app.ready());
afterAll(() => app.close());

const checkout = async (key: string) => (await app.inject({method:"POST",url:"/api/v1/payments/moyasar/checkout",headers:{"idempotency-key":key},payload:{type:"takeaway",lines:[{productId:"latte",quantity:2}]}})).json().data;

describe("Moyasar payments", () => {
  it("creates a pending order with server-computed amount", async () => {
    const data = await checkout("moyasar-checkout-1");
    expect(data.amount).toBe(4140);
    expect(data.publishableKey).toBe("pk_test_x");
    expect(data.metadata.order_id).toBe(data.orderId);
  });

  it("marks the order paid after verifying with Moyasar and syncs to Skyline", async () => {
    const data = await checkout("moyasar-checkout-2");
    payments.set("pay_ok", {id:"pay_ok",status:"paid",amount:4140,currency:"SAR",metadata:{order_id:data.orderId},source:{type:"creditcard",company:"mada"}});
    const verify = await app.inject({method:"POST",url:"/api/v1/payments/moyasar/verify",payload:{paymentId:"pay_ok"}});
    expect(verify.statusCode).toBe(200);
    expect(verify.json().data.status).toBe("paid");
    expect(verify.json().data.payments[0]).toMatchObject({method:"mada",provider:"moyasar",reference:"pay_ok"});
    await new Promise((r) => setTimeout(r, 0));
    const call = skylineCalls.find((c) => c.body.externalId === data.orderId)!;
    expect(call.body.total).toBe("41.40");
    expect(call.headers.get("idempotency-key")).toBe(data.orderId);
    const status = await app.inject({method:"GET",url:"/api/v1/integrations/skyline"});
    expect(status.json().data.find((e: any) => e.orderId === data.orderId).status).toBe("synced");
  });

  it("rejects a paid payment whose amount does not match", async () => {
    const data = await checkout("moyasar-checkout-3");
    payments.set("pay_low", {id:"pay_low",status:"paid",amount:100,currency:"SAR",metadata:{order_id:data.orderId}});
    const verify = await app.inject({method:"POST",url:"/api/v1/payments/moyasar/verify",payload:{paymentId:"pay_low"}});
    expect(verify.statusCode).toBe(422);
  });

  it("releases reserved stock when the payment fails", async () => {
    const stock = () => app.inject({method:"GET",url:"/api/v1/products"}).then((r) => r.json().data.find((p: any) => p.id === "latte").stock);
    const before = await stock();
    const data = await checkout("moyasar-checkout-4");
    expect(await stock()).toBe(before - 2);
    payments.set("pay_fail", {id:"pay_fail",status:"failed",amount:4140,currency:"SAR",metadata:{order_id:data.orderId},source:{message:"INSUFFICIENT_FUNDS"}});
    const verify = await app.inject({method:"POST",url:"/api/v1/payments/moyasar/verify",payload:{paymentId:"pay_fail"}});
    expect(verify.statusCode).toBe(402);
    expect(await stock()).toBe(before);
  });

  it("accepts webhooks only with the right secret and refetches the payment", async () => {
    const data = await checkout("moyasar-checkout-5");
    payments.set("pay_hook", {id:"pay_hook",status:"paid",amount:4140,currency:"SAR",metadata:{order_id:data.orderId},source:{type:"applepay"}});
    const bad = await app.inject({method:"POST",url:"/api/v1/webhooks/moyasar",payload:{type:"payment_paid",secret_token:"nope",data:{id:"pay_hook"}}});
    expect(bad.statusCode).toBe(401);
    const good = await app.inject({method:"POST",url:"/api/v1/webhooks/moyasar",payload:{type:"payment_paid",secret_token:"whsec_test",data:{id:"pay_hook"}}});
    expect(good.statusCode).toBe(200);
    const order = (await app.inject({method:"GET",url:"/api/v1/orders"})).json().data.find((o: any) => o.id === data.orderId);
    expect(order).toMatchObject({status:"paid",payments:[{method:"apple_pay",reference:"pay_hook"}]});
  });
});
