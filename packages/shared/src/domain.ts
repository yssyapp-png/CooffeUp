import type { Money, Totals } from "./money.js";

export type OrderType = "dine_in" | "takeaway" | "delivery";
export type PaymentMethod = "cash" | "card" | "mada" | "apple_pay" | "stc_pay" | "online" | "delivery_platform";
export type DeliveryPlatform = "hungerstation" | "jahez" | "keeta" | "mrsool" | "the_chefz" | "toyou";
export type EcommercePlatform = "zid" | "salla";
export type SalesChannel = "pos" | EcommercePlatform | DeliveryPlatform;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "نقدًا", card: "بطاقة ائتمانية", mada: "مدى", apple_pay: "Apple Pay", stc_pay: "STC Pay",
  online: "دفع إلكتروني (متجر)", delivery_platform: "مدفوع عبر منصة التوصيل"
};

export const ORDER_TYPE_LABELS: Record<OrderType, string> = { dine_in: "محلي", takeaway: "سفري", delivery: "توصيل" };

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  nameAr: string;
  nameEn: string;
  category: string;
  price: Money;
  /** Weighted average unit cost, used for COGS and margin reports. */
  cost?: Money;
  taxRateBps: number;
  stock: number;
  reorderLevel?: number;
  active: boolean;
  /** Drinks that can be redeemed with loyalty points. */
  rewardEligible?: boolean;
}

export interface OrderLineRecord {
  productId: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unitPrice: Money;
  unitCost: Money;
  discount: Money;
  taxRateBps: number;
  tax: Money;
  refundedQuantity: number;
  notes?: string;
  /** Set when a cashier sold the line at a price different from the catalogue. */
  priceOverride?: { originalPrice: Money; approvedBy: string };
}

export interface PaymentRecord {
  method: PaymentMethod;
  amount: Money;
  reference?: string;
}

export interface OrderRecord {
  id: string;
  receiptNumber: string;
  type: OrderType;
  channel: SalesChannel;
  status: "paid" | "partially_refunded" | "refunded";
  lines: OrderLineRecord[];
  payments: PaymentRecord[];
  change: Money;
  totals: Totals;
  cashierId: string;
  customerId?: string;
  tableId?: string;
  shiftId?: string;
  externalOrderId?: string;
  offline?: { deviceId: string; localReceipt: string; capturedAt: string; stockConflict: boolean };
  /** Loyalty points earned on this order and the reward redeemed on it, if any. */
  loyalty?: { earned: number; redeemed?: "free_drink"; redeemedPoints?: number };
  /** Unguessable token for the public e-invoice link sent by SMS. */
  invoiceToken: string;
  createdAt: string;
}

export interface RefundRecord {
  id: string;
  orderId: string;
  receiptNumber: string;
  lines: Array<{ productId: string; quantity: number; taxable: Money; tax: Money; cost: Money }>;
  total: Money;
  method: PaymentMethod;
  reason: string;
  staffId: string;
  shiftId?: string;
  createdAt: string;
}

export type PaidFrom = "cash" | "bank" | "payable";

export interface PurchaseRecord {
  id: string;
  supplierName: string;
  supplierVat?: string;
  invoiceNumber?: string;
  date: string;
  lines: Array<{ productId?: string; description: string; quantity: number; unitCost: Money; total: Money }>;
  net: Money;
  vat: Money;
  total: Money;
  paidFrom: PaidFrom;
  source: "manual" | "ocr";
  createdBy: string;
  createdAt: string;
}

export type ExpenseCategory = "rent" | "salaries" | "utilities" | "marketing" | "maintenance" | "delivery_commission" | "other";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: "إيجار", salaries: "رواتب", utilities: "كهرباء ومياه واتصالات", marketing: "تسويق",
  maintenance: "صيانة", delivery_commission: "عمولات التوصيل", other: "مصروفات أخرى"
};

export interface ExpenseRecord {
  id: string;
  category: ExpenseCategory;
  description: string;
  net: Money;
  vat: Money;
  total: Money;
  paidFrom: PaidFrom;
  date: string;
  shiftId?: string;
  createdBy: string;
  createdAt: string;
}

export type StockMovementReason = "sale" | "refund" | "purchase" | "adjustment" | "online_sale" | "delivery_sale";

export interface StockMovement {
  id: string;
  productId: string;
  quantity: number;
  reason: StockMovementReason;
  refId: string;
  createdAt: string;
}

export interface ShiftRecord {
  id: string;
  staffId: string;
  status: "open" | "closed";
  openedAt: string;
  openingFloat: Money;
  closedAt?: string;
  closedBy?: string;
  countedCash?: Money;
  expectedCash?: Money;
  variance?: Money;
  notes?: string;
}

export type KitchenStatus = "new" | "preparing" | "ready" | "served" | "cancelled";

export interface KitchenTicket {
  id: string;
  orderId: string;
  receiptNumber: string;
  channel: SalesChannel;
  orderType: OrderType;
  tableLabel?: string;
  items: Array<{ name: string; quantity: number; notes?: string }>;
  status: KitchenStatus;
  createdAt: string;
  startedAt?: string;
  readyAt?: string;
  servedAt?: string;
}

export interface StaffSummary {
  id: string;
  name: string;
}
