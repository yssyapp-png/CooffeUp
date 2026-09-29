import type { EcommercePlatform } from "@cooffeup/shared";
import { newId, now, type AppContext } from "../context.js";
import type { SyncJob } from "../store.js";

/**
 * Pushes stock and price changes to connected Zid and Salla stores. A change enqueues one job per
 * connected platform and SKU; newer jobs for the same SKU replace older pending ones so the store
 * always ends up with the latest value.
 */
export function enqueueStoreSync(ctx: AppContext, productIds: Iterable<string>) {
  for (const connection of ctx.store.ecommerce.values()) {
    if (!connection.enabled) continue;
    for (const productId of new Set(productIds)) {
      const product = ctx.store.products.get(productId);
      if (!product) continue;
      for (const job of ctx.store.syncJobs.values()) {
        if (job.platform === connection.platform && job.sku === product.sku && job.status === "pending") ctx.store.syncJobs.delete(job.id);
      }
      const job: SyncJob = {
        id: newId(), platform: connection.platform, sku: product.sku, quantity: ctx.store.syncedStock(product.id), price: product.price,
        status: "pending", attempts: 0, createdAt: now(), updatedAt: now()
      };
      ctx.store.syncJobs.set(job.id, job);
      ctx.schedule(() => runSyncJob(ctx, job.id));
    }
  }
}

export async function runSyncJob(ctx: AppContext, jobId: string) {
  const job = ctx.store.syncJobs.get(jobId);
  if (!job || (job.status !== "pending" && job.status !== "failed")) return;
  const connection = ctx.store.ecommerce.get(job.platform)!;
  job.updatedAt = now();
  if (!connection.stockEndpoint || !connection.accessTokenEnc) {
    job.status = "needs_configuration";
    job.lastError = "أدخل رابط تحديث المخزون ورمز الوصول من لوحة مطوري المنصة";
    return;
  }
  job.attempts += 1;
  try {
    const response = await ctx.fetch(connection.stockEndpoint.replace("{sku}", encodeURIComponent(job.sku)), {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${ctx.crypto.decrypt(connection.accessTokenEnc)}` },
      body: JSON.stringify({ sku: job.sku, quantity: job.quantity, price: job.price / 100 }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    job.status = "sent";
    job.lastError = undefined;
    connection.lastSyncAt = now();
  } catch (error) {
    job.status = "failed";
    job.lastError = error instanceof Error ? error.message : String(error);
    if (job.attempts < 5) ctx.schedule(() => runSyncJob(ctx, job.id), 30_000 * 2 ** job.attempts);
  }
}

export function syncAllProducts(ctx: AppContext, platform: EcommercePlatform) {
  const connection = ctx.store.ecommerce.get(platform)!;
  if (!connection.enabled) return 0;
  const ids = [...ctx.store.products.values()].filter((product) => product.active).map((product) => product.id);
  enqueueStoreSync(ctx, ids);
  return ids.length;
}
