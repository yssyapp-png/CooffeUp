import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Field-level encryption for sensitive customer data and integration secrets (AES-256-GCM),
 * blind indexes for exact-match lookups on encrypted fields, PIN hashing and signed session tokens.
 */
export class Crypto {
  private readonly encKey: Buffer;
  private readonly indexKey: Buffer;

  constructor(masterKey: Buffer, private readonly authSecret: Buffer) {
    this.encKey = Buffer.from(hkdfSync("sha256", masterKey, Buffer.alloc(0), "cooffeup:field-encryption", 32));
    this.indexKey = Buffer.from(hkdfSync("sha256", masterKey, Buffer.alloc(0), "cooffeup:blind-index", 32));
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encKey, iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(".");
    if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unsupported ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", this.encKey, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }

  blindIndex(value: string): string {
    return createHmac("sha256", this.indexKey).update(value.trim().toLowerCase()).digest("base64url");
  }

  signToken(claims: Record<string, unknown>, ttlSeconds: number): string {
    const now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds })).toString("base64url");
    return `${body}.${createHmac("sha256", this.authSecret).update(body).digest("base64url")}`;
  }

  verifyToken<T extends Record<string, unknown>>(token: string): T | null {
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;
    const expected = createHmac("sha256", this.authSecret).update(body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
      return claims.exp > Math.floor(Date.now() / 1000) ? claims : null;
    } catch {
      return null;
    }
  }
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32, { N: 16_384, r: 8, p: 1 });
  return `scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(".");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(pin, Buffer.from(salt, "base64url"), expected.length, { N: 16_384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

export const hmacHex = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

/** Verifies an HMAC-SHA256 webhook signature sent as hex, optionally prefixed with "sha256=". */
export function verifyWebhookSignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header) return false;
  const received = Buffer.from(header.replace(/^sha256=/, ""), "hex");
  const expected = Buffer.from(hmacHex(secret, rawBody), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*|\[?fe80:.*)$/i;

/**
 * Outbound URLs configured by staff (webhooks, store endpoints) are fetched by the server, so in
 * production they must be HTTPS and must not point at loopback or private networks (SSRF guard).
 */
export function isAllowedOutboundUrl(value: string, production: boolean): boolean {
  let url: URL;
  try {
    url = new URL(value.replace("{sku}", "sku"));
  } catch {
    return false;
  }
  if (!production) return url.protocol === "https:" || url.protocol === "http:";
  return url.protocol === "https:" && !PRIVATE_HOST.test(url.hostname);
}
