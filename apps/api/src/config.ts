import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BusinessType } from "@cooffeup/shared";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4000"),
  AUTH_SECRET: z.string().min(32).optional(),
  DATA_ENCRYPTION_KEY: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  BUSINESS_TYPE: z.enum(["cafe", "restaurant", "retail", "salon", "clinic", "laundry"]).default("cafe"),
  SELLER_NAME: z.string().default("CooffeUp"),
  SELLER_VAT: z.string().default("300000000000003"),
  SMS_PROVIDER: z.enum(["log", "http"]).default("log"),
  SMS_HTTP_URL: z.string().url().optional(),
  SMS_HTTP_TOKEN: z.string().optional(),
  SMS_SENDER: z.string().default("CooffeUp"),
  SEED_DEMO_DATA: z.enum(["true", "false"]).default("true"),
  REQUIRE_OPEN_SHIFT: z.enum(["true", "false"]).default("true"),
  PERSISTENCE: z.enum(["file", "memory"]).optional(),
  DATA_DIR: z.string().default("data")
});

export interface AppConfig {
  env: "development" | "test" | "production";
  webOrigin: string;
  publicBaseUrl: string;
  authSecret: Buffer;
  encryptionKey: Buffer;
  rateLimitMax: number;
  businessType: BusinessType;
  sellerName: string;
  sellerVat: string;
  sms: { provider: "log" | "http"; url?: string; token?: string; sender: string };
  seedDemoData: boolean;
  requireOpenShift: boolean;
  /** Directory holding the data snapshot, or undefined when everything stays in memory. */
  dataDir?: string;
}

/**
 * Outside production the secrets may be omitted. When data is persisted they must still survive a
 * restart (encrypted customer data and sessions depend on them), so they are generated once and
 * kept next to the data with owner-only permissions.
 */
function developmentSecrets(dataDir: string | undefined) {
  if (!dataDir) return { authSecret: randomBytes(32).toString("base64"), encryptionKey: randomBytes(32).toString("base64") };
  const file = join(dataDir, "dev-secrets.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as { authSecret: string; encryptionKey: string };
  mkdirSync(dataDir, { recursive: true });
  const secrets = { authSecret: randomBytes(32).toString("base64"), encryptionKey: randomBytes(32).toString("base64") };
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  chmodSync(file, 0o600);
  return secrets;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse(env);
  const production = parsed.NODE_ENV === "production";
  if (production && (!parsed.AUTH_SECRET || !parsed.DATA_ENCRYPTION_KEY)) {
    throw new Error("AUTH_SECRET and DATA_ENCRYPTION_KEY must be set in production");
  }
  const persistence = parsed.PERSISTENCE ?? (parsed.NODE_ENV === "test" ? "memory" : "file");
  const dataDir = persistence === "file" ? resolve(parsed.DATA_DIR) : undefined;
  const generated = !parsed.AUTH_SECRET || !parsed.DATA_ENCRYPTION_KEY ? developmentSecrets(dataDir) : undefined;
  const encryptionKey = Buffer.from(parsed.DATA_ENCRYPTION_KEY ?? generated!.encryptionKey, "base64");
  if (encryptionKey.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64");
  if (parsed.SMS_PROVIDER === "http" && !parsed.SMS_HTTP_URL) throw new Error("SMS_HTTP_URL is required when SMS_PROVIDER=http");
  return {
    env: parsed.NODE_ENV,
    webOrigin: parsed.WEB_ORIGIN,
    publicBaseUrl: parsed.PUBLIC_BASE_URL.replace(/\/$/, ""),
    authSecret: parsed.AUTH_SECRET ? Buffer.from(parsed.AUTH_SECRET) : Buffer.from(generated!.authSecret, "base64"),
    encryptionKey,
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    businessType: parsed.BUSINESS_TYPE,
    sellerName: parsed.SELLER_NAME,
    sellerVat: parsed.SELLER_VAT,
    sms: { provider: parsed.SMS_PROVIDER, url: parsed.SMS_HTTP_URL, token: parsed.SMS_HTTP_TOKEN, sender: parsed.SMS_SENDER },
    seedDemoData: parsed.SEED_DEMO_DATA === "true" && !production,
    requireOpenShift: parsed.REQUIRE_OPEN_SHIFT === "true",
    dataDir
  };
}
