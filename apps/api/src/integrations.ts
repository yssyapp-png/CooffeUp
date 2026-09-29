import type { EcommercePlatform } from "@cooffeup/shared";
import { z } from "zod";

/**
 * Normalises online-store webhooks from Zid and Salla. Both platforms send an event name and an
 * order object; field names differ, so each adapter reads the documented fields and falls back to
 * common alternatives. Validate the mapping against each platform's sandbox before going live.
 */
export interface StoreOrderEvent {
  kind: "created" | "cancelled" | "ignored";
  externalId: string;
  items: Array<{ sku: string; quantity: number; unitPrice: number }>;
  total: number;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});
const num = (value: unknown): number | undefined => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  const nested = obj(value).amount;
  return nested === undefined ? undefined : num(nested);
};
const halalas = (value: unknown) => Math.round((num(value) ?? 0) * 100);

const EVENT_KIND: Record<EcommercePlatform, Record<string, StoreOrderEvent["kind"]>> = {
  salla: { "order.created": "created", "order.cancelled": "cancelled", "order.refunded": "cancelled" },
  zid: { "order.create": "created", "order.created": "created", "order.cancel": "cancelled", "order.cancelled": "cancelled" }
};

export function parseStoreWebhook(platform: EcommercePlatform, body: unknown): StoreOrderEvent {
  const root = obj(body);
  const event = String(root.event ?? root.event_type ?? "");
  const order = obj(root.data ?? root.payload ?? root.order ?? root);
  const kind = EVENT_KIND[platform][event] ?? "ignored";
  const rawItems = (order.items ?? order.products ?? []) as unknown[];
  const items = (Array.isArray(rawItems) ? rawItems : []).map((raw) => {
    const item = obj(raw);
    const amounts = obj(item.amounts);
    return {
      sku: String(item.sku ?? obj(item.product).sku ?? ""),
      quantity: Math.trunc(num(item.quantity) ?? 0),
      unitPrice: halalas(amounts.price_without_tax ?? item.price_without_tax ?? item.price)
    };
  }).filter((item) => item.sku && item.quantity > 0);
  const total = halalas(obj(order.amounts).total ?? order.order_total ?? order.total);
  return { kind, externalId: String(order.id ?? order.reference_id ?? order.code ?? ""), items, total };
}

export const normalizedDeliveryOrderSchema = z.object({
  externalId: z.string().min(1).max(100),
  customerName: z.string().max(120).optional(),
  customerPhone: z.string().max(30).optional(),
  items: z.array(z.object({
    sku: z.string().min(1).max(64), name: z.string().max(200), quantity: z.number().int().positive().max(99),
    unitPrice: z.number().int().nonnegative(), notes: z.string().max(250).optional()
  })).min(1).max(100),
  deliveryFee: z.number().int().nonnegative().default(0),
  discount: z.number().int().nonnegative().default(0),
  total: z.number().int().nonnegative(),
  paidByPlatform: z.boolean().default(true),
  placedAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional()
});
