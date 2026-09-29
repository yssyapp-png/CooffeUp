import type { DeliveryPlatform } from "./domain.js";
import type { Money } from "./money.js";

export const DELIVERY_PLATFORMS: Record<DeliveryPlatform, { nameAr: string; nameEn: string; defaultCommissionBps: number }> = {
  hungerstation: { nameAr: "هنقرستيشن", nameEn: "HungerStation", defaultCommissionBps: 2_000 },
  jahez: { nameAr: "جاهز", nameEn: "Jahez", defaultCommissionBps: 1_800 },
  keeta: { nameAr: "كيتا", nameEn: "Keeta", defaultCommissionBps: 1_500 },
  mrsool: { nameAr: "مرسول", nameEn: "Mrsool", defaultCommissionBps: 1_500 },
  the_chefz: { nameAr: "ذا شفز", nameEn: "The Chefz", defaultCommissionBps: 2_000 },
  toyou: { nameAr: "تويو", nameEn: "ToYou", defaultCommissionBps: 1_500 }
};

export const DELIVERY_PLATFORM_IDS = Object.keys(DELIVERY_PLATFORMS) as DeliveryPlatform[];

export type ExternalOrderStatus = "new" | "accepted" | "preparing" | "ready" | "picked_up" | "delivered" | "rejected" | "cancelled";

export const EXTERNAL_STATUS_LABELS: Record<ExternalOrderStatus, string> = {
  new: "جديد", accepted: "مقبول", preparing: "قيد التحضير", ready: "جاهز للاستلام", picked_up: "استلمه المندوب",
  delivered: "تم التوصيل", rejected: "مرفوض", cancelled: "ملغى"
};

const TRANSITIONS: Record<ExternalOrderStatus, ExternalOrderStatus[]> = {
  new: ["accepted", "rejected", "cancelled"],
  accepted: ["preparing", "ready", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["picked_up", "cancelled"],
  picked_up: ["delivered"],
  delivered: [],
  rejected: [],
  cancelled: []
};

export const canTransitionExternal = (from: ExternalOrderStatus, to: ExternalOrderStatus) => TRANSITIONS[from].includes(to);
export const nextExternalStatuses = (from: ExternalOrderStatus) => TRANSITIONS[from];

/** The shape every platform adapter normalises its webhook payload into. */
export interface NormalizedExternalOrder {
  externalId: string;
  customerName?: string;
  customerPhone?: string;
  items: Array<{ sku: string; name: string; quantity: number; unitPrice: Money; notes?: string }>;
  deliveryFee: Money;
  discount: Money;
  total: Money;
  paidByPlatform: boolean;
  placedAt: string;
  notes?: string;
}

export const platformCommission = (total: Money, commissionBps: number) => Math.round((total * commissionBps) / 10_000);
