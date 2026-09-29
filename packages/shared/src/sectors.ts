import type { KitchenStatus, OrderType } from "./domain.js";

export type BusinessType = "cafe" | "restaurant" | "retail" | "salon" | "clinic" | "laundry";
export type Feature = "tables" | "kitchen" | "appointments" | "barcode" | "delivery" | "pickup_tickets";

export interface SectorProfile {
  nameAr: string;
  group: "food" | "retail" | "services";
  features: Feature[];
  orderTypes: OrderType[];
}

export const SECTOR_PROFILES: Record<BusinessType, SectorProfile> = {
  cafe: { nameAr: "مقهى", group: "food", features: ["tables", "kitchen", "delivery"], orderTypes: ["dine_in", "takeaway", "delivery"] },
  restaurant: { nameAr: "مطعم", group: "food", features: ["tables", "kitchen", "delivery"], orderTypes: ["dine_in", "takeaway", "delivery"] },
  retail: { nameAr: "متجر تجزئة", group: "retail", features: ["barcode", "delivery"], orderTypes: ["takeaway", "delivery"] },
  salon: { nameAr: "صالون", group: "services", features: ["appointments"], orderTypes: ["dine_in"] },
  clinic: { nameAr: "عيادة", group: "services", features: ["appointments"], orderTypes: ["dine_in"] },
  laundry: { nameAr: "مغسلة", group: "services", features: ["appointments", "pickup_tickets", "delivery"], orderTypes: ["takeaway", "delivery"] }
};

export const hasFeature = (type: BusinessType, feature: Feature) => SECTOR_PROFILES[type].features.includes(feature);

export type TableStatus = "available" | "occupied" | "reserved" | "cleaning";
export const TABLE_STATUS_LABELS: Record<TableStatus, string> = { available: "متاحة", occupied: "مشغولة", reserved: "محجوزة", cleaning: "قيد التنظيف" };

export interface DiningTable {
  id: string;
  label: string;
  area: string;
  seats: number;
  status: TableStatus;
  /** Orders opened on the table since it was last cleared. */
  orderIds: string[];
  occupiedSince?: string;
}

export const KITCHEN_STATUS_LABELS: Record<KitchenStatus, string> = { new: "جديد", preparing: "قيد التحضير", ready: "جاهز", served: "تم التقديم", cancelled: "ملغى" };

const KITCHEN_FLOW: Record<KitchenStatus, KitchenStatus[]> = {
  new: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["served"], served: [], cancelled: []
};
export const canTransitionKitchen = (from: KitchenStatus, to: KitchenStatus) => KITCHEN_FLOW[from].includes(to);

export type AppointmentStatus = "booked" | "checked_in" | "completed" | "cancelled" | "no_show";
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: "محجوز", checked_in: "حضر", completed: "مكتمل", cancelled: "ملغى", no_show: "لم يحضر"
};
const APPOINTMENT_FLOW: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ["checked_in", "cancelled", "no_show"], checked_in: ["completed", "cancelled"], completed: [], cancelled: [], no_show: []
};
export const canTransitionAppointment = (from: AppointmentStatus, to: AppointmentStatus) => APPOINTMENT_FLOW[from].includes(to);

export interface Appointment {
  id: string;
  customerId?: string;
  customerName: string;
  serviceProductId: string;
  staffId: string;
  startsAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  notes?: string;
  orderId?: string;
}

const ACTIVE_APPOINTMENT: AppointmentStatus[] = ["booked", "checked_in"];

/** A staff member cannot serve two active appointments whose time ranges overlap. */
export function findAppointmentConflict(existing: Appointment[], candidate: Pick<Appointment, "id" | "staffId" | "startsAt" | "durationMinutes">) {
  const start = new Date(candidate.startsAt).getTime();
  const end = start + candidate.durationMinutes * 60_000;
  return existing.find((appointment) => {
    if (appointment.id === candidate.id || appointment.staffId !== candidate.staffId || !ACTIVE_APPOINTMENT.includes(appointment.status)) return false;
    const otherStart = new Date(appointment.startsAt).getTime();
    const otherEnd = otherStart + appointment.durationMinutes * 60_000;
    return start < otherEnd && otherStart < end;
  });
}
