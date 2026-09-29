export type Money = number;

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

export interface LineTotals extends Totals {
  productId: string;
}

export const assertSafeInteger = (value: number, label: string) => {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
};

export function calculateLine(line: CartLine): LineTotals {
  assertSafeInteger(line.unitPrice, "unitPrice");
  assertSafeInteger(line.quantity, "quantity");
  if (line.unitPrice < 0 || line.quantity <= 0 || line.taxRateBps < 0) throw new Error("Invalid cart line");
  const gross = line.unitPrice * line.quantity;
  const discount = line.discount ?? 0;
  assertSafeInteger(discount, "discount");
  if (discount < 0 || discount > gross) throw new Error("Invalid discount");
  const taxable = gross - discount;
  const tax = Math.round((taxable * line.taxRateBps) / 10_000);
  return { productId: line.productId, subtotal: gross, discount, taxable, tax, total: taxable + tax };
}

export function calculateTotals(lines: CartLine[]): Totals {
  return lines.map(calculateLine).reduce<Totals>((sum, line) => ({
    subtotal: sum.subtotal + line.subtotal,
    discount: sum.discount + line.discount,
    taxable: sum.taxable + line.taxable,
    tax: sum.tax + line.tax,
    total: sum.total + line.total
  }), { subtotal: 0, discount: 0, taxable: 0, tax: 0, total: 0 });
}

/**
 * Spreads an order-level discount across lines proportionally to their gross value.
 * Uses the largest-remainder method so the parts always add up to the exact amount.
 */
export function distributeDiscount(lines: CartLine[], amount: Money): CartLine[] {
  assertSafeInteger(amount, "discount");
  if (amount === 0) return lines;
  const gross = lines.map((line) => line.unitPrice * line.quantity - (line.discount ?? 0));
  const base = gross.reduce((a, b) => a + b, 0);
  if (amount < 0 || amount > base) throw new Error("Invalid discount");
  const exact = gross.map((value) => (value * amount) / base);
  const parts = exact.map(Math.floor);
  let remainder = amount - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  for (const { index } of order) {
    if (remainder === 0) break;
    parts[index] += 1;
    remainder -= 1;
  }
  return lines.map((line, index) => ({ ...line, discount: (line.discount ?? 0) + parts[index] }));
}

export const sarToHalalas = (sar: number) => Math.round(sar * 100);

export const formatSar = (halalas: Money, locale = "ar-SA") =>
  new Intl.NumberFormat(locale, { style: "currency", currency: "SAR" }).format(halalas / 100);
