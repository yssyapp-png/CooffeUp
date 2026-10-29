import type { StoredOrder } from "./store.js";

/**
 * Pushes paid orders to Skyline (ERP/accounting). The endpoint path and payload shape
 * follow a generic REST contract; adjust `toSkylinePayload` to match your Skyline account's API docs.
 */
export interface SkylineConfig {
  baseUrl: string;
  apiKey: string;
  ordersPath: string;
  branchId?: string;
}

export interface OutboxEntry {
  orderId: string;
  receiptNumber: string;
  status: "pending" | "synced" | "failed";
  attempts: number;
  lastError?: string;
  syncedAt?: string;
}

const MAX_ATTEMPTS = 5;

export function skylineConfig(): SkylineConfig | undefined {
  const baseUrl = process.env.SKYLINE_API_URL, apiKey = process.env.SKYLINE_API_KEY;
  if (!baseUrl || !apiKey) return undefined;
  return {baseUrl:baseUrl.replace(/\/$/, ""), apiKey, ordersPath:process.env.SKYLINE_ORDERS_PATH ?? "/orders", branchId:process.env.SKYLINE_BRANCH_ID};
}

export function toSkylinePayload(order: StoredOrder, branchId?: string) {
  const sar = (halalas: number) => (halalas / 100).toFixed(2);
  return {
    externalId: order.id,
    invoiceNumber: order.receiptNumber,
    branchId,
    orderType: order.type,
    date: order.createdAt,
    currency: "SAR",
    items: order.lines.map((line) => ({sku:line.productId, name:line.name, quantity:line.quantity, unitPrice:sar(line.unitPrice)})),
    subtotal: sar(order.totals.subtotal),
    discount: sar(order.totals.discount),
    vat: sar(order.totals.tax),
    total: sar(order.totals.total),
    payments: order.payments.map((payment) => ({method:payment.method, amount:sar(payment.amount), provider:payment.provider, reference:payment.reference}))
  };
}

export function createSkylineSync(config: SkylineConfig | undefined, fetcher: typeof fetch = fetch) {
  const outbox = new Map<string, OutboxEntry>();

  async function attempt(order: StoredOrder, entry: OutboxEntry) {
    if (!config || entry.status === "synced") return entry;
    entry.attempts++;
    try {
      const response = await fetcher(`${config.baseUrl}${config.ordersPath}`, {
        method: "POST",
        headers: {"content-type":"application/json", authorization:`Bearer ${config.apiKey}`, "idempotency-key":order.id},
        body: JSON.stringify(toSkylinePayload(order, config.branchId)),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      entry.status = "synced"; entry.syncedAt = new Date().toISOString(); delete entry.lastError;
    } catch (error) {
      entry.lastError = error instanceof Error ? error.message : String(error);
      entry.status = entry.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
      if (entry.status === "pending") setTimeout(() => void attempt(order, entry), 2 ** entry.attempts * 1000).unref();
    }
    return entry;
  }

  return {
    enabled: Boolean(config),
    outbox,
    push(order: StoredOrder) {
      if (!config) return Promise.resolve(undefined);
      const entry = outbox.get(order.id) ?? {orderId:order.id, receiptNumber:order.receiptNumber, status:"pending", attempts:0};
      outbox.set(order.id, entry);
      return attempt(order, entry);
    },
    retry(order: StoredOrder) {
      const entry = outbox.get(order.id);
      if (entry?.status === "failed") { entry.status = "pending"; entry.attempts = 0; }
      return this.push(order);
    }
  };
}
export type SkylineSync = ReturnType<typeof createSkylineSync>;
