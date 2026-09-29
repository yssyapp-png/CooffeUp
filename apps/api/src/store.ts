import type {
  Appointment, BusinessType, DeliveryPlatform, DiningTable, EcommercePlatform, ExpenseRecord, ExternalOrderStatus, HeldCart,
  JournalEntry, KitchenTicket, NormalizedExternalOrder, OrderRecord, Permission, Product, PurchaseRecord, RefundRecord,
  Role, ShiftRecord, StockMovement
} from "@cooffeup/shared";
import { DELIVERY_PLATFORMS, DELIVERY_PLATFORM_IDS } from "@cooffeup/shared";
import { hashPin } from "./security.js";

/**
 * In-memory repository. Every collection is keyed by id so it can be swapped for PostgreSQL
 * tables (see docs/ROADMAP.md) without changing the route handlers' logic.
 */

export interface StaffMember {
  id: string;
  name: string;
  role: Role;
  pinHash: string;
  grants: Permission[];
  revokes: Permission[];
  maxDiscountBps?: number;
  active: boolean;
  failedAttempts: number;
  lockedUntil?: string;
  /** Bumped when access changes so previously issued tokens stop working. */
  tokenVersion: number;
}

export interface CustomerRecord {
  id: string;
  name: string;
  phoneEnc?: string;
  phoneIndex?: string;
  emailEnc?: string;
  notes?: string;
  marketingConsent: boolean;
  createdAt: string;
  createdBy: string;
}

export interface ExternalOrder {
  id: string;
  platform: DeliveryPlatform;
  status: ExternalOrderStatus;
  payload: NormalizedExternalOrder;
  orderId?: string;
  rejectionReason?: string;
  receivedAt: string;
  updatedAt: string;
  history: Array<{ status: ExternalOrderStatus; at: string; by: string }>;
}

export interface EcommerceConnection {
  platform: EcommercePlatform;
  enabled: boolean;
  storeId?: string;
  webhookSecretEnc?: string;
  accessTokenEnc?: string;
  /** Stock update endpoint with a {sku} placeholder, from the platform's developer portal. */
  stockEndpoint?: string;
  lastSyncAt?: string;
}

export interface DeliveryConnection {
  platform: DeliveryPlatform;
  enabled: boolean;
  webhookSecretEnc?: string;
  commissionBps: number;
  autoAccept: boolean;
}

export type SyncJobStatus = "pending" | "sent" | "failed" | "needs_configuration";

export interface SyncJob {
  id: string;
  platform: EcommercePlatform;
  sku: string;
  quantity: number;
  price: number;
  status: SyncJobStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export const WEBHOOK_EVENTS = ["order.created", "order.refunded", "purchase.created", "expense.created", "journal.posted", "shift.closed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface AccountingWebhook {
  id: string;
  name: string;
  url: string;
  secretEnc: string;
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: WebhookEvent;
  payload: unknown;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  responseStatus?: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SmsMessage {
  id: string;
  orderId: string;
  toMasked: string;
  body: string;
  provider: string;
  status: "sent" | "failed";
  error?: string;
  sentBy: string;
  createdAt: string;
}

export interface IntegrationLogEntry {
  id: string;
  source: EcommercePlatform | DeliveryPlatform;
  externalId: string;
  event: string;
  status: "processed" | "ignored" | "failed";
  message?: string;
  orderId?: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  staffId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

export interface Settings {
  businessType: BusinessType;
  sellerName: string;
  sellerVat: string;
  branchName: string;
}

export class Store {
  products = new Map<string, Product>();
  orders = new Map<string, OrderRecord>();
  idempotency = new Map<string, OrderRecord>();
  refunds = new Map<string, RefundRecord>();
  movements: StockMovement[] = [];
  customers = new Map<string, CustomerRecord>();
  purchases = new Map<string, PurchaseRecord>();
  expenses = new Map<string, ExpenseRecord>();
  journal: JournalEntry[] = [];
  shifts = new Map<string, ShiftRecord>();
  staff = new Map<string, StaffMember>();
  tables = new Map<string, DiningTable>();
  kitchenTickets = new Map<string, KitchenTicket>();
  appointments = new Map<string, Appointment>();
  heldCarts = new Map<string, HeldCart>();
  externalOrders = new Map<string, ExternalOrder>();
  ecommerce = new Map<EcommercePlatform, EcommerceConnection>();
  delivery = new Map<DeliveryPlatform, DeliveryConnection>();
  syncJobs = new Map<string, SyncJob>();
  webhooks = new Map<string, AccountingWebhook>();
  webhookDeliveries = new Map<string, WebhookDelivery>();
  sms = new Map<string, SmsMessage>();
  integrationLog: IntegrationLogEntry[] = [];
  audit: AuditEntry[] = [];
  private receiptSequence = 1000;
  private journalSequence = 0;

  constructor(public settings: Settings) {
    for (const platform of ["zid", "salla"] as const) this.ecommerce.set(platform, { platform, enabled: false });
    for (const platform of DELIVERY_PLATFORM_IDS) {
      this.delivery.set(platform, { platform, enabled: false, commissionBps: DELIVERY_PLATFORMS[platform].defaultCommissionBps, autoAccept: false });
    }
  }

  nextReceipt = () => `CU-${++this.receiptSequence}`;
  nextJournalNumber = () => ++this.journalSequence;

  openShift(): ShiftRecord | undefined {
    return [...this.shifts.values()].find((shift) => shift.status === "open");
  }

  productBySku(sku: string): Product | undefined {
    const normalized = sku.trim().toLowerCase();
    return [...this.products.values()].find((product) => product.sku.toLowerCase() === normalized || product.barcode === sku.trim());
  }
}

export interface SeedStaff {
  id: string;
  name: string;
  role: Role;
  pin: string;
}

/** Demo accounts for local development only (disabled in production by config). */
export const DEMO_STAFF: SeedStaff[] = [
  { id: "owner", name: "المالك", role: "owner", pin: "1111" },
  { id: "manager", name: "سارة · مديرة الفرع", role: "manager", pin: "2222" },
  { id: "cashier", name: "عبدالله · كاشير", role: "cashier", pin: "3333" },
  { id: "kitchen", name: "المطبخ", role: "kitchen", pin: "4444" },
  { id: "accountant", name: "المحاسب", role: "accountant", pin: "5555" }
];

export function addStaff(store: Store, seed: SeedStaff) {
  store.staff.set(seed.id, { id: seed.id, name: seed.name, role: seed.role, pinHash: hashPin(seed.pin), grants: [], revokes: [], active: true, failedAttempts: 0, tokenVersion: 1 });
}

export function seedDemoData(store: Store) {
  for (const seed of DEMO_STAFF) addStaff(store, seed);
  const products: Product[] = [
    { id: "espresso", sku: "CF-001", barcode: "6281000000011", nameAr: "إسبريسو", nameEn: "Espresso", category: "القهوة", price: 1200, cost: 350, taxRateBps: 1500, stock: 100, reorderLevel: 20, active: true },
    { id: "latte", sku: "CF-002", barcode: "6281000000028", nameAr: "لاتيه", nameEn: "Latte", category: "القهوة", price: 1800, cost: 550, taxRateBps: 1500, stock: 100, reorderLevel: 20, active: true },
    { id: "cold-brew", sku: "CF-003", barcode: "6281000000035", nameAr: "كولد برو", nameEn: "Cold Brew", category: "المشروبات الباردة", price: 2000, cost: 600, taxRateBps: 1500, stock: 80, reorderLevel: 15, active: true },
    { id: "croissant", sku: "FD-001", barcode: "6281000000042", nameAr: "كرواسون", nameEn: "Croissant", category: "المخبوزات", price: 1400, cost: 500, taxRateBps: 1500, stock: 40, reorderLevel: 10, active: true },
    { id: "coffee-beans", sku: "RT-001", barcode: "6281000000059", nameAr: "حبوب قهوة 250 جم", nameEn: "Coffee beans 250g", category: "منتجات للبيع", price: 6500, cost: 3500, taxRateBps: 1500, stock: 25, reorderLevel: 5, active: true }
  ];
  for (const product of products) store.products.set(product.id, product);
  const tables = [["t1", "طاولة 1", "الصالة"], ["t2", "طاولة 2", "الصالة"], ["t3", "طاولة 3", "الصالة"], ["t4", "طاولة 4", "الجلسات الخارجية"], ["t5", "طاولة 5", "الجلسات الخارجية"]];
  for (const [id, label, area] of tables) store.tables.set(id, { id, label, area, seats: 4, status: "available", orderIds: [] });
}
