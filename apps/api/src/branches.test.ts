import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { MAIN_BRANCH_ID, Store, type StoreSnapshot } from "./store.js";

const app = await buildApp({ env: { NODE_ENV: "test", RATE_LIMIT_MAX: "100000" }, fetch: async () => ({ ok: true, status: 200, text: async () => "" }) });
const store = app.ctx.store;
let owner = "";
let boothId = "";
beforeAll(async () => {
  await app.ready();
  owner = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { staffId: "owner", pin: "1111" } })).json().token;
});
afterAll(() => app.close());

const call = (method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: unknown, branch?: string, token = owner) =>
  app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${token}`, ...(branch ? { "x-branch-id": branch } : {}) } });
let key = 0;
const sell = (branch: string, payload: unknown) =>
  app.inject({ method: "POST", url: "/api/v1/orders", payload: payload as object, headers: { authorization: `Bearer ${owner}`, "x-branch-id": branch, "idempotency-key": `branch-order-${++key}` } });
const hour = 3_600_000;

describe("branches and booths", () => {
  it("requires an end date for a temporary booth", async () => {
    expect((await call("POST", "/api/v1/branches", { name: "بوث المعرض", kind: "temporary" })).json().error).toBe("TEMPORARY_BRANCH_NEEDS_END_DATE");
    const created = await call("POST", "/api/v1/branches", {
      name: "بوث المعرض", kind: "temporary", syncToStore: false,
      startsAt: new Date(Date.now() - hour).toISOString(), endsAt: new Date(Date.now() + 48 * hour).toISOString()
    });
    expect(created.statusCode).toBe(201);
    boothId = created.json().data.id;
    expect(created.json().data.isOpen).toBe(true);
  });

  it("transfers stock without changing the company total", async () => {
    const total = store.products.get("latte")!.stock;
    const moved = await call("POST", "/api/v1/stock-transfers", { fromBranchId: MAIN_BRANCH_ID, toBranchId: boothId, lines: [{ productId: "latte", quantity: 10 }] });
    expect(moved.statusCode).toBe(201);
    expect(store.stockAt(boothId, "latte")).toBe(10);
    expect(store.stockAt(MAIN_BRANCH_ID, "latte")).toBe(total - 10);
    expect(store.products.get("latte")!.stock).toBe(total);
    expect((await call("POST", "/api/v1/stock-transfers", { fromBranchId: boothId, toBranchId: MAIN_BRANCH_ID, lines: [{ productId: "latte", quantity: 11 }] })).json().error).toBe("INSUFFICIENT_STOCK");
    const products = (await call("GET", "/api/v1/products", undefined, boothId)).json().data;
    expect(products.find((product: { id: string }) => product.id === "latte")).toMatchObject({ stock: 10, totalStock: total });
  });

  it("sells from the booth's own stock and shift", async () => {
    expect((await sell(boothId, { type: "takeaway", lines: [{ productId: "latte", quantity: 1 }], payments: [{ method: "mada", amount: 2_070 }] })).json().error).toBe("SHIFT_REQUIRED");
    await call("POST", "/api/v1/shifts/open", { openingFloat: 20_000 }, boothId);
    // The main branch has no shift yet, so each branch keeps its own drawer.
    expect((await call("GET", "/api/v1/shifts/current")).json().data).toBeNull();
    const mainBefore = store.stockAt(MAIN_BRANCH_ID, "latte");
    const order = (await sell(boothId, { type: "takeaway", lines: [{ productId: "latte", quantity: 2 }], payments: [{ method: "mada", amount: 4_140 }] })).json().data;
    expect(order.branchId).toBe(boothId);
    expect(store.stockAt(boothId, "latte")).toBe(8);
    expect(store.stockAt(MAIN_BRANCH_ID, "latte")).toBe(mainBefore);
    expect((await sell(boothId, { type: "takeaway", lines: [{ productId: "croissant", quantity: 1 }], payments: [{ method: "mada", amount: 1_610 }] })).json().error).toBe("INSUFFICIENT_STOCK");
  });

  it("only offers stock from branches that feed the online store", async () => {
    await call("PUT", "/api/v1/integrations/ecommerce/zid", { enabled: true });
    await call("POST", "/api/v1/products/latte/adjust", { quantity: 1, reason: "جرد" });
    await app.ctx.flush();
    const job = [...store.syncJobs.values()].filter((candidate) => candidate.sku === "CF-002").at(-1)!;
    expect(job.quantity).toBe(store.stockAt(MAIN_BRANCH_ID, "latte"));
    await call("PATCH", `/api/v1/branches/${boothId}`, { syncToStore: true });
    await app.ctx.flush();
    const after = [...store.syncJobs.values()].filter((candidate) => candidate.sku === "CF-002").at(-1)!;
    expect(after.quantity).toBe(store.stockAt(MAIN_BRANCH_ID, "latte") + 8);
  });

  it("keeps staff tied to a branch out of other branches", async () => {
    const created = (await call("POST", "/api/v1/staff", { name: "كاشير البوث", role: "cashier", pin: "7777", branchId: boothId })).json().data;
    const token = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { staffId: created.id, pin: "7777" } })).json().token;
    expect((await call("GET", "/api/v1/shifts/current", undefined, MAIN_BRANCH_ID, token)).json().error).toBe("BRANCH_NOT_ALLOWED");
    expect((await call("GET", "/api/v1/shifts/current", undefined, undefined, token)).json().data.branchId).toBe(boothId);
  });

  it("filters reports by branch", async () => {
    const booth = (await call("GET", `/api/v1/reports/sales_summary?branchId=${boothId}`)).json().data.rows;
    expect(booth.find((row: { metric: string }) => row.metric === "عدد الطلبات").value).toBe(1);
    const levels = (await call("GET", `/api/v1/reports/stock_levels?branchId=${boothId}`)).json().data.rows;
    expect(levels.find((row: { sku: string }) => row.sku === "CF-002").stock).toBe(8);
  });

  it("stops sales outside the booth's dates and returns its stock when it closes", async () => {
    await call("PATCH", `/api/v1/branches/${boothId}`, { endsAt: new Date(Date.now() - 60_000).toISOString(), startsAt: new Date(Date.now() - 2 * hour).toISOString() });
    expect((await sell(boothId, { type: "takeaway", lines: [{ productId: "latte", quantity: 1 }], payments: [{ method: "mada", amount: 2_070 }] })).json().error).toBe("BRANCH_CLOSED");
    expect((await call("POST", `/api/v1/branches/${boothId}/close`, {})).json().error).toBe("SHIFT_STILL_OPEN");
    const shift = store.openShift(boothId)!;
    await call("POST", `/api/v1/shifts/${shift.id}/close`, { countedCash: 20_000 }, boothId);
    const mainBefore = store.stockAt(MAIN_BRANCH_ID, "latte");
    const closed = (await call("POST", `/api/v1/branches/${boothId}/close`, { returnToBranchId: MAIN_BRANCH_ID })).json();
    expect(closed.data.active).toBe(false);
    expect(store.stockAt(boothId, "latte")).toBe(0);
    expect(store.stockAt(MAIN_BRANCH_ID, "latte")).toBe(mainBefore + 8);
    expect((await call("PATCH", `/api/v1/branches/${MAIN_BRANCH_ID}`, { active: false })).json().error).toBe("MAIN_BRANCH_REQUIRED");
  });
});

describe("data written before branches existed", () => {
  it("moves all stock into the main branch", () => {
    const legacy = new Store({ businessType: "cafe", sellerName: "x", sellerVat: "300000000000003", branchName: "الرئيسي", requireOpenShift: true, fulfilmentBranchId: MAIN_BRANCH_ID });
    const snapshot: StoreSnapshot = {
      version: 1, savedAt: "2026-09-01T00:00:00Z", settings: legacy.settings, sequences: { receipt: 1005, journal: 3 },
      maps: { products: [["latte", { id: "latte", sku: "CF-002", nameAr: "لاتيه", nameEn: "Latte", category: "قهوة", price: 1800, taxRateBps: 1500, stock: 42, active: true }]] },
      arrays: {}
    };
    legacy.restore(snapshot);
    expect(legacy.stockAt(MAIN_BRANCH_ID, "latte")).toBe(42);
    expect(legacy.products.get("latte")!.stock).toBe(42);
    expect(legacy.nextReceipt()).toBe("CU-1006");
  });
});
