import { hmacHex } from "../security.js";
import { newId, now, type AppContext } from "../context.js";
import type { WebhookDelivery, WebhookEvent } from "../store.js";

/**
 * Outbound webhooks for accounting systems and the Zid app market. Each delivery is signed with
 * the subscriber's secret (header `x-cooffeup-signature: sha256=<hex>`) and retried with backoff.
 */
const RETRY_DELAYS = [0, 60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];

export function emit(ctx: AppContext, event: WebhookEvent, data: unknown) {
  for (const webhook of ctx.store.webhooks.values()) {
    if (!webhook.enabled || !webhook.events.includes(event)) continue;
    const delivery: WebhookDelivery = {
      id: newId(), webhookId: webhook.id, event, payload: { id: newId(), event, createdAt: now(), data },
      status: "pending", attempts: 0, createdAt: now(), updatedAt: now()
    };
    ctx.store.webhookDeliveries.set(delivery.id, delivery);
    ctx.schedule(() => attemptDelivery(ctx, delivery.id));
  }
}

export async function attemptDelivery(ctx: AppContext, deliveryId: string) {
  const delivery = ctx.store.webhookDeliveries.get(deliveryId);
  const webhook = delivery && ctx.store.webhooks.get(delivery.webhookId);
  if (!delivery || !webhook || delivery.status === "delivered") return;
  const body = JSON.stringify(delivery.payload);
  delivery.attempts += 1;
  delivery.updatedAt = now();
  try {
    const response = await ctx.fetch(webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cooffeup-event": delivery.event,
        "x-cooffeup-delivery": delivery.id,
        "x-cooffeup-signature": `sha256=${hmacHex(ctx.crypto.decrypt(webhook.secretEnc), body)}`
      },
      body,
      signal: AbortSignal.timeout(10_000)
    });
    delivery.responseStatus = response.status;
    if (response.ok) {
      delivery.status = "delivered";
      delivery.lastError = undefined;
      return;
    }
    delivery.lastError = `HTTP ${response.status}`;
  } catch (error) {
    delivery.lastError = error instanceof Error ? error.message : String(error);
  }
  const delay = RETRY_DELAYS[delivery.attempts];
  if (delay === undefined) delivery.status = "failed";
  else ctx.schedule(() => attemptDelivery(ctx, delivery.id), delay);
}
