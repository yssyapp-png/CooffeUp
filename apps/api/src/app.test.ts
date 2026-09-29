import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REPORTS } from "@cooffeup/shared";
import { buildApp } from "./app.js";
import type { FetchLike } from "./context.js";
import { isAllowedOutboundUrl } from "./security.js";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
const calls: Call[] = [];
const fakeFetch: FetchLike = async (url, init) => {
  calls.push({ url, method: init.method, headers: init.headers, body: init.body });
  return { ok: true, status: 200, text: async () => "" };
};

const app = await buildApp({ env: { NODE_ENV: "test", RATE_LIMIT_MAX: "100000", PUBLIC_BASE_URL: "https://pos.example.sa" }, fetch: fakeFetch });
const store = app.ctx.store;
beforeAll(() => app.ready());
afterAll(() => app.close());
beforeEach(() => { calls.length = 0; });

const tokens: Record<string, string> = {};
async function login(staffId: string, pin: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { staffId, pin } });
  expect(response.statusCode).toBe(200);
  return response.json().token as string;
}
beforeAll(async () => {
  tokens.owner = await login("owner", "1111");
  tokens.manager = await login("manager", "2222");
  tokens.cashier = await login("cashier", "3333");
  tokens.accountant = await login("accountant", "5555");
});

let keySeq = 0;
function api(as: keyof typeof tokens | undefined, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method, url, payload: payload as object, headers: { ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}), ...headers } });
}
const sell = (as: keyof typeof tokens, payload: unknown) => api(as, "POST", "/api/v1/orders", payload, { "idempotency-key": `test-key-${++keySeq}-${Date.now()}` });
const balanced = () => store.journal.every((entry) => entry.lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0);
const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

describe("authentication & permissions", () => {
  it("rejects unauthenticated calls and wrong PINs, then locks the account", async () => {
    expect((await api(undefined, "GET", "/api/v1/products")).statusCode).toBe(401);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { staffId: "kitchen", pin: "0000" } })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { staffId: "kitchen", pin: "4444" } })).statusCode).toBe(423);
    expect(store.audit.some((entry) => entry.action === "auth.failed")).toBe(true);
  });

  it("returns the staff member's effective permissions", async () => {
    const me = (await api("cashier", "GET", "/api/v1/auth/me")).json().staff;
    expect(me.permissions).toContain("pos.sell");
    expect(me.permissions).not.toContain("pos.refund");
    expect(me.maxDiscountBps).toBe(1000);
  });

  it("invalidates sessions when a member's access changes", async () => {
    const created = await api("owner", "POST", "/api/v1/staff", { name: "موظف مؤقت", role: "cashier", pin: "8888" });
    const id = created.json().data.id;
    const token = await login(id, "8888");
    await api("owner", "PATCH", `/api/v1/staff/${id}`, { grants: ["pos.refund"] });
    const response = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(401);
  });

  it("stops managers from editing the owner", async () => {
    expect((await api("manager", "GET", "/api/v1/staff")).statusCode).toBe(403);
  });
});

describe("orders", () => {
  it("rejects requests without an idempotency key", async () => {
    expect((await api("cashier", "POST", "/api/v1/orders", {})).statusCode).toBe(400);
  });

  it("creates an order once, replays retries and posts a balanced journal", async () => {
    const payload = { type: "takeaway", lines: [{ productId: "espresso", quantity: 1 }], payments: [{ method: "mada", amount: 1380 }] };
    const headers = { "idempotency-key": "test-order-001" };
    const first = await api("cashier", "POST", "/api/v1/orders", payload, headers);
    const retry = await api("cashier", "POST", "/api/v1/orders", payload, headers);
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().replayed).toBe(true);
    expect(balanced()).toBe(true);
    expect([...store.kitchenTickets.values()].some((ticket) => ticket.orderId === first.json().data.id)).toBe(true);
  });

  it("enforces per-role discount limits and price override permission", async () => {
    const big = await sell("cashier", { type: "takeaway", lines: [{ productId: "latte", quantity: 2 }], orderDiscount: 500, payments: [{ method: "cash", amount: 5000 }] });
    expect(big.statusCode).toBe(403);
    expect(big.json()).toMatchObject({ error: "DISCOUNT_NOT_ALLOWED", maxDiscount: 360 });
    const ok = await sell("cashier", { type: "takeaway", lines: [{ productId: "latte", quantity: 2 }], orderDiscount: 360, payments: [{ method: "cash", amount: 5000 }] });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().change).toBe(5000 - ok.json().data.totals.total);

    const override = { type: "takeaway", lines: [{ productId: "latte", quantity: 1, unitPrice: 1000 }], payments: [{ method: "mada", amount: 1150 }] };
    expect((await sell("cashier", override)).statusCode).toBe(403);
    const managed = await sell("manager", override);
    expect(managed.statusCode).toBe(201);
    expect(managed.json().data.lines[0].priceOverride).toEqual({ originalPrice: 1800, approvedBy: "manager" });
    expect(store.audit.some((entry) => entry.action === "order.price_override")).toBe(true);
  });

  it("rejects overpayment on cards and short payments", async () => {
    expect((await sell("cashier", { type: "takeaway", lines: [{ productId: "espresso", quantity: 1 }], payments: [{ method: "mada", amount: 2000 }] })).json().error).toBe("OVERPAYMENT_WITHOUT_CASH");
    expect((await sell("cashier", { type: "takeaway", lines: [{ productId: "espresso", quantity: 1 }], payments: [{ method: "mada", amount: 100 }] })).json().error).toBe("PAYMENT_SHORT");
  });

  it("occupies a table for dine-in orders", async () => {
    const response = await sell("cashier", { type: "dine_in", tableId: "t2", lines: [{ productId: "croissant", quantity: 1 }], payments: [{ method: "cash", amount: 1610 }] });
    expect(response.statusCode).toBe(201);
    expect(store.tables.get("t2")).toMatchObject({ status: "occupied", orderIds: [response.json().data.id] });
  });

  it("refunds partially with the right permission and restocks", async () => {
    const order = (await sell("cashier", { type: "takeaway", lines: [{ productId: "cold-brew", quantity: 2 }], payments: [{ method: "mada", amount: 4600 }] })).json().data;
    const stockBefore = store.products.get("cold-brew")!.stock;
    const body = { lines: [{ productId: "cold-brew", quantity: 1 }], reason: "المشروب غير مطابق" };
    expect((await api("cashier", "POST", `/api/v1/orders/${order.id}/refund`, body)).statusCode).toBe(403);
    const refund = await api("manager", "POST", `/api/v1/orders/${order.id}/refund`, body);
    expect(refund.statusCode).toBe(201);
    expect(refund.json().data.total).toBe(2300);
    expect(store.products.get("cold-brew")!.stock).toBe(stockBefore + 1);
    expect(store.orders.get(order.id)!.status).toBe("partially_refunded");
    expect((await api("manager", "POST", `/api/v1/orders/${order.id}/refund`, { ...body, lines: [{ productId: "cold-brew", quantity: 2 }] })).json().error).toBe("REFUND_EXCEEDS_SOLD");
    expect(balanced()).toBe(true);
  });
});

describe("offline mode", () => {
  it("syncs queued sales, deduplicates and flags stock conflicts", async () => {
    store.products.get("coffee-beans")!.stock = 1;
    const entry = (id: string, productId: string, quantity: number, amount: number) => ({
      id, localReceipt: `OFF-DEV1-${id.slice(-3)}`, capturedAt: "2026-09-28T09:00:00Z",
      payload: { type: "takeaway", lines: [{ productId, quantity }], payments: [{ method: "cash", amount }] }
    });
    const body = { deviceId: "device-1", entries: [entry("offline-0001", "espresso", 1, 1380), entry("offline-0002", "coffee-beans", 2, 20000), entry("offline-0003", "missing", 1, 100)] };
    const first = (await api("cashier", "POST", "/api/v1/sync/orders", body)).json().data;
    expect(first.map((result: { status: string }) => result.status)).toEqual(["created", "created", "rejected"]);
    expect(first[2].error).toBe("PRODUCT_NOT_FOUND");
    const conflicted = [...store.orders.values()].find((order) => order.offline?.localReceipt === "OFF-DEV1-002");
    expect(conflicted?.offline?.stockConflict).toBe(true);
    const again = (await api("cashier", "POST", "/api/v1/sync/orders", { ...body, entries: body.entries.slice(0, 1) })).json().data;
    expect(again[0].status).toBe("duplicate");
  });

  it("keeps held carts on the server", async () => {
    const held = await api("cashier", "POST", "/api/v1/held-carts", { label: "طاولة 4", payload: { type: "dine_in", lines: [{ productId: "latte", quantity: 2 }] } });
    expect(held.statusCode).toBe(201);
    expect((await api("cashier", "GET", "/api/v1/held-carts")).json().data[0].label).toBe("طاولة 4");
  });
});

describe("customers", () => {
  let customerId = "";
  it("encrypts phone numbers at rest and masks them by default", async () => {
    const created = await api("cashier", "POST", "/api/v1/customers", { name: "نورة", phone: "0501234567", marketingConsent: true });
    expect(created.statusCode).toBe(201);
    customerId = created.json().data.id;
    expect(created.json().data.phone).toBe("+966******567");
    const record = store.customers.get(customerId)!;
    expect(record.phoneEnc).not.toContain("501234567");
    expect((await api("cashier", "POST", "/api/v1/customers", { name: "مكرر", phone: "+966501234567" })).statusCode).toBe(409);
  });

  it("finds customers by phone through the blind index", async () => {
    const found = (await api("cashier", "GET", "/api/v1/customers?q=٠٥٠١٢٣٤٥٦٧")).json().data;
    expect(found.map((customer: { id: string }) => customer.id)).toEqual([customerId]);
  });

  it("reveals PII only to permitted staff and audits it", async () => {
    expect((await api("cashier", "GET", `/api/v1/customers/${customerId}?reveal=true`)).statusCode).toBe(403);
    const revealed = await api("manager", "GET", `/api/v1/customers/${customerId}?reveal=true`);
    expect(revealed.json().data.phone).toBe("+966501234567");
    expect(store.audit.some((entry) => entry.action === "customer.pii_viewed" && entry.targetId === customerId)).toBe(true);
  });

  it("tracks purchase behaviour and suggests promotions", async () => {
    for (let visit = 0; visit < 3; visit++) {
      await sell("cashier", { type: "takeaway", customerId, lines: [{ productId: "latte", quantity: 1 }], payments: [{ method: "mada", amount: 2070 }] });
    }
    const data = (await api("cashier", "GET", `/api/v1/customers/${customerId}`)).json().data;
    expect(data.insights).toMatchObject({ visits: 3, totalSpent: 6210, averageTicket: 2070 });
    expect(data.suggestions.map((suggestion: { code: string }) => suggestion.code)).toContain("FAVORITE_BUNDLE");
  });
});

describe("purchases, expenses & accounting", () => {
  const invoiceText = "مؤسسة البن الذهبي\nالرقم الضريبي 310123456700003\nرقم الفاتورة: A-100\n2026-09-20\nلاتيه جاهز 10 5.00 50.00\nالمجموع قبل الضريبة 50.00\nضريبة القيمة المضافة 7.50\nالإجمالي 57.50";

  it("reads a photographed invoice and suggests matching products", async () => {
    const parsed = (await api("accountant", "POST", "/api/v1/purchases/parse", { text: invoiceText })).json().data;
    expect(parsed).toMatchObject({ supplierVat: "310123456700003", invoiceNumber: "A-100", net: 5000, vat: 750, total: 5750 });
    expect(parsed.lines[0].suggestedProductId).toBe("latte");
  });

  it("records purchases into stock, average cost and the ledger", async () => {
    const latte = store.products.get("latte")!;
    const [stock, cost] = [latte.stock, latte.cost!];
    const payload = {
      supplierName: "مؤسسة البن الذهبي", supplierVat: "310123456700003", invoiceNumber: "A-100", date: "2026-09-20", net: 5000, vat: 750, total: 5750,
      paidFrom: "payable", source: "ocr", lines: [{ productId: "latte", description: "لاتيه جاهز", quantity: 10, unitCost: 500, total: 5000 }]
    };
    expect((await api("cashier", "POST", "/api/v1/purchases", payload)).statusCode).toBe(403);
    expect((await api("accountant", "POST", "/api/v1/purchases", payload)).statusCode).toBe(201);
    expect(latte.stock).toBe(stock + 10);
    expect(latte.cost).toBe(Math.round((stock * cost + 5000) / (stock + 10)));
    expect((await api("accountant", "POST", "/api/v1/purchases", payload)).json().error).toBe("DUPLICATE_SUPPLIER_INVOICE");
    expect((await api("accountant", "POST", "/api/v1/purchases", { ...payload, invoiceNumber: "A-101", total: 6000 })).json().error).toBe("TOTALS_MISMATCH");
  });

  it("produces statements and a VAT position that net to zero", async () => {
    expect((await api("accountant", "POST", "/api/v1/expenses", { category: "rent", description: "إيجار سبتمبر", net: 300000, vat: 45000, paidFrom: "bank" })).statusCode).toBe(201);
    const { trialBalance, vat } = (await api("accountant", "GET", "/api/v1/accounting/statements")).json().data;
    expect(trialBalance.reduce((sum: number, row: { balance: number }) => sum + row.balance, 0)).toBe(0);
    expect(vat.inputVat).toBe(750 + 45000);
    const csv = await api("accountant", "GET", "/api/v1/accounting/export?format=csv");
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("entry_number");
  });

  it("rejects unbalanced manual entries", async () => {
    const response = await api("owner", "POST", "/api/v1/accounting/journal", { date: "2026-09-28", description: "قيد تجريبي", lines: [{ account: "1101", debit: 100, credit: 0 }, { account: "3101", debit: 0, credit: 90 }] });
    expect(response.json().error).toBe("UNBALANCED_ENTRY");
  });

  it("serves more than 25 reports", async () => {
    const list = (await api("accountant", "GET", "/api/v1/reports")).json().data;
    expect(list.length).toBe(REPORTS.length);
    expect(list.length).toBeGreaterThanOrEqual(25);
    const summary = (await api("accountant", "GET", "/api/v1/reports/sales_summary")).json().data;
    expect(summary.rows[0].value).toBeGreaterThan(0);
    expect((await api("cashier", "GET", "/api/v1/reports/sales_summary")).statusCode).toBe(403);
  });

  it("signs webhook deliveries to accounting systems", async () => {
    const created = (await api("owner", "POST", "/api/v1/accounting/webhooks", { name: "قيود", url: "https://erp.example.sa/hooks", events: ["order.created"] })).json();
    await sell("cashier", { type: "takeaway", lines: [{ productId: "espresso", quantity: 1 }], payments: [{ method: "mada", amount: 1380 }] });
    await app.ctx.flush();
    const call = calls.find((candidate) => candidate.url === "https://erp.example.sa/hooks")!;
    expect(call.headers["x-cooffeup-event"]).toBe("order.created");
    expect(call.headers["x-cooffeup-signature"]).toBe(`sha256=${sign(created.secret, call.body!)}`);
    await api("owner", "PATCH", `/api/v1/accounting/webhooks/${created.data.id}`, { enabled: false });
  });
});

describe("shifts", () => {
  it("computes expected cash and posts the variance on close", async () => {
    const opened = await api("cashier", "POST", "/api/v1/shifts/open", { openingFloat: 50000 });
    expect(opened.statusCode).toBe(201);
    await sell("cashier", { type: "takeaway", lines: [{ productId: "espresso", quantity: 1 }], payments: [{ method: "cash", amount: 2000 }] });
    const closed = (await api("cashier", "POST", `/api/v1/shifts/${opened.json().data.id}/close`, { countedCash: 51300 })).json().data;
    expect(closed.expectedCash).toBe(51380);
    expect(closed.variance).toBe(-80);
    expect(store.journal.at(-1)!.source.type).toBe("shift");
  });
});

describe("e-invoice by SMS", () => {
  it("sends a link to a public invoice page with the ZATCA QR", async () => {
    const order = (await sell("cashier", { type: "takeaway", lines: [{ productId: "latte", quantity: 1 }], payments: [{ method: "mada", amount: 2070 }] })).json().data;
    expect((await api("cashier", "POST", `/api/v1/orders/${order.id}/send-invoice`, { phone: "12345" })).json().error).toBe("INVALID_SAUDI_MOBILE");
    const sent = await api("cashier", "POST", `/api/v1/orders/${order.id}/send-invoice`, { phone: "0551112233" });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().data.toMasked).toBe("+966******233");
    const page = await app.inject({ method: "GET", url: new URL(sent.json().link).pathname });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(order.receiptNumber);
    expect(page.body).toContain("<svg");
    expect((await app.inject({ method: "GET", url: "/i/not-a-real-token" })).statusCode).toBe(404);
  });
});

describe("delivery apps", () => {
  const secret = "jahez-secret-123";
  const order = { externalId: "JZ-9001", customerName: "خالد", items: [{ sku: "CF-002", name: "Latte", quantity: 2, unitPrice: 1800 }], total: 4140, paidByPlatform: true };
  const post = (payload: object, signature?: string) => {
    const body = JSON.stringify(payload);
    return app.inject({ method: "POST", url: "/api/v1/webhooks/delivery/jahez", payload: body, headers: { "content-type": "application/json", "x-signature": signature ?? sign(secret, body) } });
  };

  it("rejects webhooks until enabled and when unsigned", async () => {
    expect((await post(order)).statusCode).toBe(404);
    await api("owner", "PUT", "/api/v1/integrations/delivery/jahez", { enabled: true, webhookSecret: secret });
    expect((await post(order, "deadbeef")).statusCode).toBe(401);
  });

  it("queues, accepts and cancels platform orders in the unified screen", async () => {
    const received = await post(order);
    expect(received.statusCode).toBe(201);
    expect((await post(order)).json().duplicate).toBe(true);
    const id = received.json().data.id;
    const accepted = (await api("cashier", "POST", `/api/v1/delivery/orders/${id}/status`, { status: "accepted" })).json().data;
    const booked = store.orders.get(accepted.orderId)!;
    expect(booked).toMatchObject({ channel: "jahez", type: "delivery", change: 0 });
    expect(booked.payments[0]).toMatchObject({ method: "delivery_platform", amount: booked.totals.total });
    expect((await api("cashier", "POST", `/api/v1/delivery/orders/${id}/status`, { status: "delivered" })).statusCode).toBe(409);
    await api("cashier", "POST", `/api/v1/delivery/orders/${id}/status`, { status: "cancelled", reason: "العميل ألغى" });
    expect(store.orders.get(accepted.orderId)!.status).toBe("refunded");
    expect(balanced()).toBe(true);
  });
});

describe("online stores (Zid & Salla)", () => {
  const secret = "salla-webhook-secret";
  const webhook = (payload: object) => {
    const body = JSON.stringify(payload);
    return app.inject({ method: "POST", url: "/api/v1/webhooks/ecommerce/salla", payload: body, headers: { "content-type": "application/json", "x-salla-signature": sign(secret, body) } });
  };
  const created = { event: "order.created", data: { id: 555, items: [{ sku: "RT-001", quantity: 1, amounts: { price_without_tax: { amount: 65 } } }], amounts: { total: { amount: 74.75 } } } };

  it("books store orders, deducts stock and queues stock sync", async () => {
    await api("owner", "PUT", "/api/v1/integrations/ecommerce/salla", { enabled: true, webhookSecret: secret });
    const stock = store.products.get("coffee-beans")!.stock;
    const response = await webhook(created);
    expect(response.statusCode).toBe(201);
    expect(store.products.get("coffee-beans")!.stock).toBe(stock - 1);
    expect((await webhook(created)).json().duplicate).toBe(true);
    await app.ctx.flush();
    const job = [...store.syncJobs.values()].find((candidate) => candidate.sku === "RT-001")!;
    expect(job.status).toBe("needs_configuration");
  });

  it("pushes stock to the store once credentials are configured", async () => {
    await api("owner", "PUT", "/api/v1/integrations/ecommerce/salla", { enabled: true, accessToken: "salla-token-abc", stockEndpoint: "https://api.store.example/products/{sku}/stock" });
    await api("owner", "POST", "/api/v1/products/espresso/adjust", { quantity: 5, reason: "جرد" });
    await app.ctx.flush();
    const call = calls.find((candidate) => candidate.url === "https://api.store.example/products/CF-001/stock")!;
    expect(call.method).toBe("PUT");
    expect(call.headers.authorization).toBe("Bearer salla-token-abc");
    expect(JSON.parse(call.body!).quantity).toBe(store.products.get("espresso")!.stock);
  });

  it("reverses cancelled store orders and logs unknown SKUs", async () => {
    await webhook({ event: "order.cancelled", data: { id: 555 } });
    expect([...store.orders.values()].find((order) => order.externalOrderId === "555")!.status).toBe("refunded");
    const unknown = await webhook({ event: "order.created", data: { id: 556, items: [{ sku: "NOPE", quantity: 1 }] } });
    expect(unknown.json().unknownSkus).toEqual(["NOPE"]);
    expect(store.integrationLog.at(-1)!.status).toBe("failed");
  });
});

describe("outbound URL guard", () => {
  it("allows only public HTTPS targets in production", () => {
    expect(isAllowedOutboundUrl("https://erp.example.sa/hooks", true)).toBe(true);
    expect(isAllowedOutboundUrl("https://api.store.example/products/{sku}", true)).toBe(true);
    for (const url of ["http://erp.example.sa", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.2/x", "https://169.254.169.254/latest", "https://[::1]/x", "not a url"]) {
      expect(isAllowedOutboundUrl(url, true)).toBe(false);
    }
    expect(isAllowedOutboundUrl("http://localhost:9000/hook", false)).toBe(true);
  });
});

describe("operations", () => {
  it("moves kitchen tickets through the allowed flow only", async () => {
    const ticket = [...store.kitchenTickets.values()].find((candidate) => candidate.status === "new")!;
    expect((await api("cashier", "PATCH", `/api/v1/kitchen/tickets/${ticket.id}`, { status: "served" })).statusCode).toBe(409);
    await api("cashier", "PATCH", `/api/v1/kitchen/tickets/${ticket.id}`, { status: "preparing" });
    const ready = (await api("cashier", "PATCH", `/api/v1/kitchen/tickets/${ticket.id}`, { status: "ready" })).json().data;
    expect(ready.readyAt).toBeDefined();
  });

  it("prevents double-booking the same staff member", async () => {
    const booking = { customerName: "ريم", serviceProductId: "latte", staffId: "cashier", startsAt: "2026-10-01T10:00:00.000Z", durationMinutes: 60 };
    expect((await api("cashier", "POST", "/api/v1/appointments", booking)).statusCode).toBe(201);
    expect((await api("cashier", "POST", "/api/v1/appointments", { ...booking, startsAt: "2026-10-01T10:30:00.000Z" })).json().error).toBe("APPOINTMENT_CONFLICT");
  });
});
