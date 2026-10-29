import { timingSafeEqual } from "node:crypto";
import type { PaymentMethod } from "@cooffeup/shared";

const MOYASAR_API = "https://api.moyasar.com/v1";

export interface MoyasarPayment {
  id: string;
  status: "initiated" | "paid" | "authorized" | "captured" | "failed" | "refunded" | "voided" | "verified";
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, string> | null;
  source?: { type?: string; company?: string; message?: string } | null;
}

export interface MoyasarConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret?: string;
  callbackUrl: string;
}

export function moyasarConfig(): MoyasarConfig | undefined {
  const secretKey = process.env.MOYASAR_SECRET_KEY;
  const publishableKey = process.env.MOYASAR_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) return undefined;
  const webUrl = process.env.PUBLIC_WEB_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:5173";
  return {secretKey, publishableKey, webhookSecret:process.env.MOYASAR_WEBHOOK_SECRET, callbackUrl:`${webUrl.replace(/\/$/, "")}/payment/callback`};
}

/** Always re-fetch the payment from Moyasar with the secret key; never trust redirect query params or webhook bodies alone. */
export async function fetchMoyasarPayment(config: MoyasarConfig, id: string, fetcher: typeof fetch = fetch): Promise<MoyasarPayment> {
  const response = await fetcher(`${MOYASAR_API}/payments/${encodeURIComponent(id)}`, {
    headers: {authorization:`Basic ${Buffer.from(`${config.secretKey}:`).toString("base64")}`, accept:"application/json"},
    signal: AbortSignal.timeout(10_000)
  });
  if (response.status === 404) throw new MoyasarError("PAYMENT_NOT_FOUND", 404);
  if (!response.ok) throw new MoyasarError("MOYASAR_UNAVAILABLE", 502);
  return await response.json() as MoyasarPayment;
}

export function paymentMethodFromSource(source: MoyasarPayment["source"]): PaymentMethod {
  if (source?.type === "applepay") return "apple_pay";
  if (source?.type === "stcpay") return "stc_pay";
  if (source?.company === "mada") return "mada";
  return "card";
}

export function validWebhookSecret(expected: string | undefined, received: unknown) {
  if (!expected || typeof received !== "string") return false;
  const a = Buffer.from(expected), b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class MoyasarError extends Error {
  constructor(public code: string, public statusCode: number) { super(code); }
}
