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

