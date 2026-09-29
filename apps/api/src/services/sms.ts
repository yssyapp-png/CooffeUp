import type { AppContext } from "../context.js";

export interface SmsResult {
  ok: boolean;
  provider: string;
  error?: string;
}

/**
 * Sends an SMS through the configured provider. `log` keeps messages in the outbox only (development);
 * `http` posts JSON to an SMS gateway (e.g. Unifonic, Taqnyat, Msegat) behind SMS_HTTP_URL.
 * Note: Saudi CST rules require the sender name to be registered with the provider first.
 */
export async function sendSms(ctx: AppContext, to: string, body: string): Promise<SmsResult> {
  const { sms } = ctx.config;
  if (sms.provider === "log") return { ok: true, provider: "log" };
  try {
    const response = await ctx.fetch(sms.url!, {
      method: "POST",
      headers: { "content-type": "application/json", ...(sms.token ? { authorization: `Bearer ${sms.token}` } : {}) },
      body: JSON.stringify({ to, sender: sms.sender, message: body }),
      signal: AbortSignal.timeout(10_000)
    });
    return response.ok ? { ok: true, provider: "http" } : { ok: false, provider: "http", error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, provider: "http", error: error instanceof Error ? error.message : String(error) };
  }
}
