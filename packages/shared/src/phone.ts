import { normalizeDigits } from "./invoice-reader.js";

/** Normalises Saudi mobile numbers written in any common form to E.164 (+9665XXXXXXXX), or null. */
export function normalizeSaudiMobile(input: string): string | null {
  const digits = normalizeDigits(input).replace(/[\s\-()]/g, "");
  const match = digits.match(/^(?:\+?966|00966|0)?(5\d{8})$/);
  return match ? `+966${match[1]}` : null;
}
