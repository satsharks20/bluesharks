import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import { env } from "../config/env";

// Set by the web app's middleware (apps/web/src/middleware.ts); the names must match there.
export const CLIENT_IP_HEADER = "x-satsharks-client-ip";
export const CLIENT_COUNTRY_HEADER = "x-satsharks-client-country";
export const PROXY_SECRET_HEADER = "x-satsharks-proxy-secret";

// Hashing first makes both sides the same length, as timingSafeEqual requires.
function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(expected).digest());
}

// Browsers reach the API through the web app's /api proxy on Vercel, so req.ip is a Vercel server's
// address, shared by every visitor. The web app passes the visitor's own address with PROXY_SECRET.
// Without a matching secret (a direct call, local development, PROXY_SECRET unset) req.ip is used,
// so a caller cannot pick their own address by sending the header.
export function clientIp(req: Request): string {
  const forwarded = req.get(CLIENT_IP_HEADER);
  const secret = env.PROXY_SECRET;
  if (secret && forwarded && isIP(forwarded) && sameSecret(req.get(PROXY_SECRET_HEADER) ?? "", secret)) return forwarded;
  return req.ip ?? "unknown";
}

// Vercel derives this ISO country code from the same public IP and the web middleware signs the
// forwarded value with PROXY_SECRET. A browser or direct Railway caller cannot choose a country.
export function clientCountry(req: Request): string | null {
  const secret = env.PROXY_SECRET;
  const country = req.get(CLIENT_COUNTRY_HEADER)?.trim().toUpperCase();
  if (!secret || !country || !/^[A-Z]{2}$/.test(country)) return null;
  return sameSecret(req.get(PROXY_SECRET_HEADER) ?? "", secret) ? country : null;
}
