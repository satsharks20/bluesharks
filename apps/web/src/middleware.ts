import { NextResponse, type NextRequest } from "next/server";

// /api/* is forwarded to the Express API (next.config.ts), which then sees every visitor as a Vercel
// server and would count them all against one rate limit. This adds the visitor's own address, with
// PROXY_SECRET so the API can trust it (apps/api/src/utils/client-ip.ts; header names must match).
// Without PROXY_SECRET (local development) requests pass through unchanged.

const CLIENT_IP_HEADER = "x-satsharks-client-ip";
const CLIENT_COUNTRY_HEADER = "x-satsharks-client-country";
const PROXY_SECRET_HEADER = "x-satsharks-proxy-secret";

export function middleware(request: NextRequest) {
  const secret = process.env.PROXY_SECRET;
  if (!secret) return NextResponse.next();

  const headers = new Headers(request.headers);
  // Vercel sets these itself and overwrites what the browser sent, so they cannot be faked.
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  else headers.delete(CLIENT_IP_HEADER);
  const country = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  if (country && /^[A-Z]{2}$/.test(country)) headers.set(CLIENT_COUNTRY_HEADER, country);
  else headers.delete(CLIENT_COUNTRY_HEADER);
  headers.set(PROXY_SECRET_HEADER, secret);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/api/:path*" };
