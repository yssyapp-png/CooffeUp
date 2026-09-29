import type { Money } from "./money.js";

/**
 * Turns the raw text produced by OCR on a photographed supplier invoice into a structured
 * purchase draft. The OCR engine itself runs on the device (see the web app); this parser is
 * deterministic so it can be tested and reused by any client.
 */

export interface ParsedInvoiceLine {
  description: string;
  quantity: number;
  unitCost: Money;
  total: Money;
}

export interface ParsedInvoice {
  supplierName?: string;
  supplierVat?: string;
  invoiceNumber?: string;
  date?: string;
  lines: ParsedInvoiceLine[];
  net?: Money;
  vat?: Money;
  total?: Money;
  /** 0–100: how much of the invoice could be read and cross-checked. */
  confidence: number;
  warnings: string[];
}

const DIGIT_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9"
};

export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩۰-۹]/g, (digit) => DIGIT_MAP[digit])
    .replace(/٫/g, ".")
    .replace(/[٬،](?=\d{3}\b)/g, "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1");
}

/** Saudi VAT registration numbers are 15 digits that start and end with 3. */
export const isValidSaudiVat = (value: string) => /^3\d{13}3$/.test(value);

/** Standalone numbers only, so product names such as "Milk 1L" keep their digits. */
const NUMBER = /(?<![\p{L}\d.])\d+(?:\.\d{1,3})?(?![\p{L}\d])/gu;
const toHalalas = (text: string) => Math.round(Number.parseFloat(text) * 100);

const LABELS = {
  net: /(قبل\s*الضريبة|غير\s*شامل|المجموع\s*الفرعي|الإجمالي\s*الفرعي|sub\s*-?\s*total|total\s*(before|excl(uding)?)\s*vat|net\s*amount|taxable\s*amount)/i,
  vat: /(ضريبة\s*القيمة\s*المضافة|القيمة\s*المضافة|الضريبة|\bvat\b|\btax\b)/i,
  total: /(الإجمالي|المجموع|الصافي\s*المستحق|المبلغ\s*المستحق|شامل\s*الضريبة|grand\s*total|total\s*due|amount\s*due|\btotal\b)/i,
  invoiceNumber: /(رقم\s*الفاتورة|فاتورة\s*رقم|invoice\s*(no\.?|number|#))\s*[:#]?\s*([A-Za-z0-9\-/]+)/i,
  vatNumber: /\b3\d{13}3\b/,
  date: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/
};

const HEADER_WORDS = /(فاتورة|ضريبية|مبسطة|invoice|tax|vat|الرقم|رقم|تاريخ|date|tel|هاتف|جوال|سجل|c\.?r|www|@)/i;

function parseDate(text: string): string | undefined {
  const match = text.match(LABELS.date);
  if (!match) return undefined;
  const [year, month, day] = match[1] ? [match[1], match[2], match[3]] : [match[6], match[5], match[4]];
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? undefined : iso;
}

/** Tries every ordering of three numbers to find quantity × unit price = total (OCR on RTL text often reorders columns). */
function matchLine(numbers: string[]): { quantity: number; unitCost: Money; total: Money } | undefined {
  if (numbers.length < 3) return undefined;
  const lastThree = numbers.slice(-3);
  const orders = [[0, 1, 2], [1, 0, 2], [2, 1, 0], [1, 2, 0], [0, 2, 1], [2, 0, 1]];
  const candidates: Array<{ quantity: number; unitCost: Money; total: Money; plainQuantity: boolean }> = [];
  for (const [q, u, t] of orders) {
    const quantity = Number.parseFloat(lastThree[q]);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10_000) continue;
    const unitCost = toHalalas(lastThree[u]);
    const total = toHalalas(lastThree[t]);
    if (unitCost > 0 && Math.abs(quantity * unitCost - total) <= 1) candidates.push({ quantity, unitCost, total, plainQuantity: !lastThree[q].includes(".") });
  }
  // Quantities are normally printed without decimals ("3"), prices with them ("12.00").
  const best = candidates.find((candidate) => candidate.plainQuantity) ?? candidates[0];
  return best && { quantity: best.quantity, unitCost: best.unitCost, total: best.total };
}

function labelledAmount(line: string): Money | undefined {
  const numbers = line.match(NUMBER);
  return numbers ? toHalalas(numbers[numbers.length - 1]) : undefined;
}

export function parseInvoiceText(raw: string): ParsedInvoice {
  const text = normalizeDigits(raw);
  const rows = text.split(/\r?\n/).map((row) => row.replace(/\s+/g, " ").trim()).filter(Boolean);
  const warnings: string[] = [];
  const result: ParsedInvoice = { lines: [], confidence: 0, warnings };

  result.supplierVat = text.match(LABELS.vatNumber)?.[0];
  result.invoiceNumber = text.match(LABELS.invoiceNumber)?.[3];
  result.date = parseDate(text);
  result.supplierName = rows.find((row) => /\p{L}{2,}/u.test(row) && !HEADER_WORDS.test(row) && !/\d{3,}/.test(row));

  for (const row of rows) {
    if (LABELS.net.test(row)) {
      result.net ??= labelledAmount(row);
      continue;
    }
    if (LABELS.vat.test(row) && !LABELS.total.test(row.replace(LABELS.vat, ""))) {
      // Skip "VAT number" rows and "VAT 15%" headers that carry no amount beyond the rate.
      if (LABELS.vatNumber.test(row)) continue;
      const amount = labelledAmount(row.replace(/\d+(\.\d+)?\s*%/g, ""));
      if (amount !== undefined) result.vat ??= amount;
      continue;
    }
    if (LABELS.total.test(row)) {
      const amount = labelledAmount(row);
      if (amount !== undefined) result.total = amount;
      continue;
    }
    const numbers = row.match(NUMBER) ?? [];
    const line = matchLine(numbers);
    if (!line) continue;
    const description = row.replace(NUMBER, "").replace(/(ر\.?\s?س\.?|sar|ريال|x|×|@)/gi, "").replace(/\s+/g, " ").trim();
    if (!/\p{L}/u.test(description)) continue;
    result.lines.push({ description, ...line });
  }

  const linesTotal = result.lines.reduce((sum, line) => sum + line.total, 0);
  if (result.net === undefined && result.lines.length) result.net = linesTotal;
  if (result.net !== undefined && result.vat !== undefined && result.total === undefined) result.total = result.net + result.vat;
  if (result.net !== undefined && result.total !== undefined && result.vat === undefined) result.vat = result.total - result.net;
  if (result.total !== undefined && result.vat !== undefined && result.net === undefined) result.net = result.total - result.vat;

  let score = 0;
  if (result.supplierName) score += 10;
  if (result.supplierVat) score += 15;
  else warnings.push("لم يُعثر على الرقم الضريبي للمورد");
  if (result.invoiceNumber) score += 10;
  else warnings.push("لم يُعثر على رقم الفاتورة");
  if (result.date) score += 10;
  else warnings.push("لم يُعثر على تاريخ الفاتورة");
  if (result.lines.length) score += 20;
  else warnings.push("لم تُقرأ بنود الفاتورة، أدخلها يدويًا");

  if (result.net !== undefined && result.vat !== undefined && result.total !== undefined) {
    if (Math.abs(result.net + result.vat - result.total) <= 1) score += 15;
    else warnings.push("المجموع قبل الضريبة + الضريبة لا يساوي الإجمالي");
    const expectedVat = Math.round(result.net * 0.15);
    if (Math.abs(expectedVat - result.vat) <= Math.max(2, result.lines.length)) score += 10;
    else warnings.push("قيمة الضريبة لا تساوي 15% من المجموع قبل الضريبة، راجع الفاتورة");
  } else warnings.push("تعذر قراءة إجماليات الفاتورة");
  if (result.lines.length && result.net !== undefined) {
    if (Math.abs(linesTotal - result.net) <= 1) score += 10;
    else warnings.push("مجموع البنود لا يطابق المجموع قبل الضريبة، قد يكون هناك بند لم يُقرأ");
  }
  result.confidence = Math.min(score, 100);
  return result;
}
