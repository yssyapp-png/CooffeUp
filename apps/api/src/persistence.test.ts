import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const dataDir = mkdtempSync(join(tmpdir(), "cooffeup-"));
const env = { NODE_ENV: "test", PERSISTENCE: "file", DATA_DIR: dataDir, RATE_LIMIT_MAX: "10000" };
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("file persistence", () => {
  it("keeps orders, encrypted customers and sessions across a restart", async () => {
    const first = await buildApp({ env });
    const { token } = (await first.inject({ method: "POST", url: "/api/v1/auth/login", payload: { staffId: "manager", pin: "2222" } })).json();
    const headers = { authorization: `Bearer ${token}` };
    await first.inject({ method: "POST", url: "/api/v1/shifts/open", headers, payload: { openingFloat: 10_000 } });
    const customer = (await first.inject({ method: "POST", url: "/api/v1/customers", headers, payload: { name: "ليان", phone: "0501112222" } })).json().data;
    const order = (await first.inject({
      method: "POST", url: "/api/v1/orders", headers: { ...headers, "idempotency-key": "persist-order-1" },
      payload: { type: "takeaway", customerId: customer.id, lines: [{ productId: "latte", quantity: 1 }], payments: [{ method: "mada", amount: 2_070 }] }
    })).json().data;
    await first.close();

    const file = join(dataDir, "cooffeup.json");
    expect(readFileSync(file, "utf8")).not.toContain("501112222");
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const second = await buildApp({ env });
    // The same session token still works because the generated secret was kept next to the data.
    const restored = await second.inject({ method: "GET", url: `/api/v1/orders/${order.id}`, headers });
    expect(restored.json().data.receiptNumber).toBe(order.receiptNumber);
    const revealed = await second.inject({ method: "GET", url: `/api/v1/customers/${customer.id}?reveal=true`, headers });
    expect(revealed.json().data.phone).toBe("+966501112222");
    expect(second.ctx.store.products.get("latte")!.stock).toBe(99);
    // Receipt numbers continue instead of restarting, and the retried order is still recognised.
    const next = await second.inject({
      method: "POST", url: "/api/v1/orders", headers: { ...headers, "idempotency-key": "persist-order-2" },
      payload: { type: "takeaway", lines: [{ productId: "espresso", quantity: 1 }], payments: [{ method: "mada", amount: 1_380 }] }
    });
    expect(next.json().data.receiptNumber).not.toBe(order.receiptNumber);
    const replay = await second.inject({
      method: "POST", url: "/api/v1/orders", headers: { ...headers, "idempotency-key": "persist-order-1" },
      payload: { type: "takeaway", customerId: customer.id, lines: [{ productId: "latte", quantity: 1 }], payments: [{ method: "mada", amount: 2_070 }] }
    });
    expect(replay.json().replayed).toBe(true);
    await second.close();
  });
});
