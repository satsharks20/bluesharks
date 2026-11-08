import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";

const secret = "test-proxy-secret-that-is-at-least-32-characters";
process.env.NODE_ENV = "test";
process.env.PROXY_SECRET = secret;

const { CLIENT_COUNTRY_HEADER, PROXY_SECRET_HEADER, clientCountry } = await import("../src/utils/client-ip");

function request(headers: Record<string, string>): Request {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name: string) => normalized.get(name.toLowerCase()) } as Request;
}

test("a country forwarded with the shared proxy secret is trusted", () => {
  assert.equal(clientCountry(request({ [CLIENT_COUNTRY_HEADER]: "pk", [PROXY_SECRET_HEADER]: secret })), "PK");
  assert.equal(clientCountry(request({ [CLIENT_COUNTRY_HEADER]: "US", [PROXY_SECRET_HEADER]: secret })), "US");
});

test("a browser cannot choose its own pricing country", () => {
  assert.equal(clientCountry(request({ [CLIENT_COUNTRY_HEADER]: "PK" })), null);
  assert.equal(clientCountry(request({ [CLIENT_COUNTRY_HEADER]: "PK", [PROXY_SECRET_HEADER]: "wrong-secret" })), null);
  assert.equal(clientCountry(request({ [CLIENT_COUNTRY_HEADER]: "Pakistan", [PROXY_SECRET_HEADER]: secret })), null);
});
