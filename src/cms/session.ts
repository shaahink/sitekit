/* The editor session cookie.
   ---------------------------------------------------------------------------
   Google's ID token proves who someone is exactly once, at sign-in. Rather
   than send it back on every save — it is large, and it expires on Google's
   schedule, not ours — we mint our own short-lived cookie: the identity plus
   an expiry, signed with HMAC-SHA256 under a per-site secret.

   Rotating CMS_SESSION_SECRET invalidates every live session at once. That is
   the intended blunt instrument, and CMS.md says so, so a mystery logout after
   a secret change is explicable rather than alarming. */

import { safeEqual } from "../feedback/guards.js";
import { base64UrlEncode, base64UrlJson, decodeJwtJson } from "../internal/base64url.js";

export const COOKIE_NAME = "sk_cms";

const DEFAULT_MAX_AGE = 3600;

export interface Session {
  sub: string;
  email: string;
  name: string;
  /** Seconds since the epoch, matching JWT convention. */
  exp: number;
}

export interface SessionOptions {
  secret: string;
  maxAgeSeconds?: number;
  now?: number;
}

/** The full `Set-Cookie` value for a freshly signed session. */
export async function issueSession(
  identity: { sub: string; email: string; name: string },
  options: SessionOptions
): Promise<string> {
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE;
  const seconds = Math.floor((options.now ?? Date.now()) / 1000);
  const payload = base64UrlJson({
    sub: identity.sub,
    email: identity.email,
    name: identity.name,
    exp: seconds + maxAge
  } satisfies Session);
  const value = `${payload}.${await sign(payload, options.secret)}`;

  /* SameSite=Lax, not Strict: the owner arriving at /edit from a link in an
     email should still be signed in. The cookie is never read cross-site
     because nothing cross-site can reach our API past the origin check. */
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Path=/`;
}

/** The session a request carries, or null for absent, malformed, mis-signed
    and expired alike — a caller has nothing useful to do with the difference. */
export async function readSession(
  cookieHeader: string | null,
  options: { secret: string; now?: number }
): Promise<Session | null> {
  const raw = cookieValue(cookieHeader, COOKIE_NAME);
  if (!raw) return null;

  const split = raw.lastIndexOf(".");
  if (split < 1) return null;
  const payload = raw.slice(0, split);
  const signature = raw.slice(split + 1);

  const expected = await sign(payload, options.secret);
  if (!safeEqual(signature, expected)) return null;

  let claims: Record<string, unknown>;
  try {
    claims = decodeJwtJson(payload);
  } catch {
    return null;
  }

  const seconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= seconds) return null;
  if (typeof claims.sub !== "string" || typeof claims.email !== "string") return null;

  return {
    sub: claims.sub,
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : claims.email,
    exp: claims.exp
  };
}

/** Signing out: same attributes, no value, immediate expiry. The attributes
    have to match or the browser keeps the original cookie. */
export function clearSession(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
