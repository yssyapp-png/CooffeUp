import type { Money } from "./money.js";

/**
 * Builds the TLV (tag-length-value) payload encoded in the QR code of a simplified tax invoice,
 * as specified by ZATCA: 1 seller name, 2 VAT number, 3 timestamp, 4 invoice total incl. VAT, 5 VAT total.
 * Phase 2 (integration) additionally requires signing and reporting each invoice to ZATCA; that is
 * listed in the roadmap and is not covered by this helper.
 */
export interface ZatcaQrInput {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  total: Money;
  vat: Money;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const [a, b = 0, c = 0] = [bytes[index], bytes[index + 1], bytes[index + 2]];
    const triple = (a << 16) | (b << 8) | c;
    output += BASE64[(triple >> 18) & 63] + BASE64[(triple >> 12) & 63];
    output += index + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? BASE64[triple & 63] : "=";
  }
  return output;
}

export function zatcaQrPayload(input: ZatcaQrInput): string {
  const encoder = new TextEncoder();
  const fields = [input.sellerName, input.vatNumber, input.timestamp, (input.total / 100).toFixed(2), (input.vat / 100).toFixed(2)];
  const chunks: number[] = [];
  fields.forEach((field, index) => {
    const value = encoder.encode(field);
    if (value.length > 255) throw new Error("ZATCA QR field exceeds 255 bytes");
    chunks.push(index + 1, value.length, ...value);
  });
  return bytesToBase64(Uint8Array.from(chunks));
}
