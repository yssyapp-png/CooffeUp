export type Money = number;
export type OrderType = "dine_in" | "takeaway" | "delivery";
export type PaymentMethod = "cash" | "card" | "mada" | "apple_pay" | "stc_pay";

export interface Product {
  id: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  category: string;
  price: Money;
  taxRateBps: number;
  stock: number;
  active: boolean;
  rewardEligible?: boolean;
}

export type LoyaltyTier = "member" | "silver" | "gold" | "platinum";

export interface LoyaltySnapshot {
  customerMobile: string;
  points: number;
  visits: number;
  tier: LoyaltyTier;
  freeDrinksAvailable: number;
}

export function normalizeSaudiMobile(input: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const easternDigits = "۰۱۲۳۴۵۶۷۸۹";
  const ascii = input
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(easternDigits.indexOf(digit)));
  const digits = ascii.replace(/\D/g, "");
  if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
  throw new Error("Invalid Saudi mobile number");
}

export const FREE_DRINK_POINTS = 100;

const loyaltyTiers: Array<{ tier: LoyaltyTier; minimumVisits: number; multiplierBps: number }> = [
  { tier: "platinum", minimumVisits: 30, multiplierBps: 15_000 },
  { tier: "gold", minimumVisits: 15, multiplierBps: 12_500 },
  { tier: "silver", minimumVisits: 5, multiplierBps: 11_000 },
  { tier: "member", minimumVisits: 0, multiplierBps: 10_000 }
];

export function loyaltyTierForVisits(visits: number): LoyaltyTier {
  integer(visits, "visits");
  if (visits < 0) throw new Error("visits must be non-negative");
  return loyaltyTiers.find((entry) => visits >= entry.minimumVisits)!.tier;
}

export function calculateLoyaltyPoints(taxableHalalas: Money, tier: LoyaltyTier): number {
  integer(taxableHalalas, "taxableHalalas");
  if (taxableHalalas < 0) throw new Error("taxableHalalas must be non-negative");
  const multiplier = loyaltyTiers.find((entry) => entry.tier === tier)?.multiplierBps;
  if (!multiplier) throw new Error("Unknown loyalty tier");
  const basePoints = Math.floor(taxableHalalas / 100);
  return Math.floor((basePoints * multiplier) / 10_000);
}

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: Money;
  quantity: number;
  taxRateBps: number;
  discount?: Money;
  notes?: string;
}

export interface Totals {
  subtotal: Money;
  discount: Money;
  taxable: Money;
  tax: Money;
  total: Money;
}

const integer = (value: number, label: string) => {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
};

export function calculateTotals(lines: CartLine[]): Totals {
  return lines.reduce<Totals>((sum, line) => {
    integer(line.unitPrice, "unitPrice");
    integer(line.quantity, "quantity");
    if (line.unitPrice < 0 || line.quantity <= 0 || line.taxRateBps < 0) throw new Error("Invalid cart line");
    const gross = line.unitPrice * line.quantity;
    const discount = line.discount ?? 0;
    integer(discount, "discount");
    if (discount < 0 || discount > gross) throw new Error("Invalid discount");
    const taxable = gross - discount;
    const tax = Math.round((taxable * line.taxRateBps) / 10_000);
    return {
      subtotal: sum.subtotal + gross,
      discount: sum.discount + discount,
      taxable: sum.taxable + taxable,
      tax: sum.tax + tax,
      total: sum.total + taxable + tax
    };
  }, { subtotal: 0, discount: 0, taxable: 0, tax: 0, total: 0 });
}

export const formatSar = (halalas: Money, locale = "ar-SA") =>
  new Intl.NumberFormat(locale, { style: "currency", currency: "SAR" }).format(halalas / 100);
