import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

type Call = { url: string; body?: string };
const calls: Call[] = [];
const laundry = await buildApp({
  env: { NODE_ENV: "test", RATE_LIMIT_MAX: "100000", BUSINESS_TYPE: "laundry", SMS_PROVIDER: "http", SMS_HTTP_URL: "https://sms.example.sa/send" },
  fetch: async (url, init) => { calls.push({ url, body: init.body }); return { ok: true, status: 200, text: async () => "" }; }
});
afterAll(() => laundry.close());

const login = async (staffId: string, pin: string) => (await laundry.inject({ method: "POST", url: "/api/v1/auth/login", payload: { staffId, pin } })).json().token as string;
const owner = await login("owner", "1111");
const headers = { authorization: `Bearer ${owner}` };
await laundry.inject({ method: "POST", url: "/api/v1/shifts/open", headers, payload: { openingFloat: 0 } });

describe("laundry pickup tickets", () => {
  it("creates a ticket per order and texts the customer when it is ready", async () => {
    const customer = (await laundry.inject({ method: "POST", url: "/api/v1/customers", headers, payload: { name: "منيرة", phone: "0533334444" } })).json().data;
    const dueAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    const order = (await laundry.inject({
      method: "POST", url: "/api/v1/orders", headers: { ...headers, "idempotency-key": "laundry-order-1" },
      payload: { type: "takeaway", customerId: customer.id, pickupDueAt: dueAt, lines: [{ productId: "croissant", quantity: 3, notes: "كي فقط" }], payments: [{ method: "cash", amount: 5_000 }] }
    })).json().data;
    const tickets = (await laundry.inject({ method: "GET", url: "/api/v1/pickup-tickets", headers })).json().data;
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ orderId: order.id, dueAt, status: "received", customerName: "منيرة" });
    expect(tickets[0].items[0]).toMatchObject({ quantity: 3, notes: "كي فقط" });

    const id = tickets[0].id;
    expect((await laundry.inject({ method: "PATCH", url: `/api/v1/pickup-tickets/${id}`, headers, payload: { status: "collected" } })).json().error).toBe("INVALID_STATUS_TRANSITION");
    const ready = (await laundry.inject({ method: "PATCH", url: `/api/v1/pickup-tickets/${id}`, headers, payload: { status: "ready", notify: true } })).json();
    expect(ready.notified.status).toBe("sent");
    expect(JSON.parse(calls.at(-1)!.body!)).toMatchObject({ to: "+966533334444" });
    expect(JSON.parse(calls.at(-1)!.body!).message).toContain(order.receiptNumber);
    await laundry.inject({ method: "PATCH", url: `/api/v1/pickup-tickets/${id}`, headers, payload: { status: "collected" } });
    expect((await laundry.inject({ method: "GET", url: "/api/v1/pickup-tickets", headers })).json().data).toHaveLength(0);
  });
});

describe("dashboard", () => {
  it("summarises today across channels with what is waiting", async () => {
    const data = (await laundry.inject({ method: "GET", url: "/api/v1/dashboard", headers })).json().data;
    expect(data.orders).toBe(1);
    expect(data.sales).toBe(4_830);
    expect(data.byChannel).toEqual({ pos: 4_830, online: 0, delivery: 0 });
    expect(data.byPayment.cash).toBe(4_830);
    expect(data.week).toHaveLength(7);
    expect(data.week[6]).toMatchObject({ sales: 4_830, orders: 1 });
    expect(data.branches[0]).toMatchObject({ id: "main", shiftOpen: true, sales: 4_830 });
    expect(data.waiting.pickups).toBe(0);
    const cashier = await login("cashier", "3333");
    expect((await laundry.inject({ method: "GET", url: "/api/v1/dashboard", headers: { authorization: `Bearer ${cashier}` } })).statusCode).toBe(403);
  });
});
