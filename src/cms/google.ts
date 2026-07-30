/* Google ID token verification.
   ---------------------------------------------------------------------------
   The owner signs in with Google Identity Services, which hands our own
   JavaScript a signed ID token. This verifies it the way Google documents:
   fetch the JWKS, check the RS256 signature, then check the claims.

   PLAN §3.9 named `jose` for this. It isn't needed — the kit already signs
   RS256 with Web Crypto in feedback/app-auth.ts, and verification is the
   mirror image of that, so this is a few dozen lines against machinery that
   already exists. The kit's dependency surface stays at one.

   Every failure here throws. Callers turn that into a flat 401 and log the
   detail: telling an attacker *which* check failed is free intelligence. */

import { base64UrlDecode, decodeJwtJson } from "../internal/base64url.js";
import { deadline, JWKS_TIMEOUT_MS } from "../internal/upstream.js";

const DEFAULT_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/* Google mints tokens under both spellings and documents both as valid. */
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface GoogleIdentity {
  /** Google's stable identifier. Survives an email change; see Decision 4. */
  sub: string;
  email: string;
  name: string;
  picture: string;
}

export interface VerifyOptions {
  /** The OAuth client ID the token must be addressed to. */
  clientId: string;
  /** Milliseconds, injectable so expiry is testable without waiting. */
  now?: number;
  /** Seconds of clock skew tolerated at both ends. */
  leewaySeconds?: number;
  jwksUrl?: string;
  fetchImpl?: typeof fetch;
}

interface KeyCache {
  url: string;
  keys: Map<string, JsonWebKey>;
  expiresAt: number;
}

/* Warm-instance cache, exactly like app-auth's token cache: survives requests
   on the same instance, vanishes with it. Google rotates these keys slowly and
   publishes a Cache-Control we honour, so a cold fetch costs one round-trip
   every few hours. */
let cache: KeyCache | null = null;

export async function verifyIdToken(
  credential: string,
  options: VerifyOptions
): Promise<GoogleIdentity> {
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("credential is not a three-part JWT");
  const headerPart = parts[0] as string;
  const payloadPart = parts[1] as string;
  const signaturePart = parts[2] as string;

  const header = decodeJwtJson(headerPart);
  /* Pin the algorithm. Accepting whatever the token names is how "alg: none"
     and HMAC-with-the-public-key forgeries get in. */
  if (header.alg !== "RS256") throw new Error(`unexpected alg: ${String(header.alg)}`);
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) throw new Error("credential header has no kid");

  const key = await importKey(kid, options);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  );
  if (!verified) throw new Error("signature does not verify");

  /* Claims are only read after the signature is good — an unverified payload
     is attacker-controlled text and must not reach any decision. */
  const claims = decodeJwtJson(payloadPart);
  const seconds = Math.floor((options.now ?? Date.now()) / 1000);
  const leeway = options.leewaySeconds ?? 60;

  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) {
    throw new Error(`unexpected iss: ${String(claims.iss)}`);
  }
  if (claims.aud !== options.clientId) {
    throw new Error("token is addressed to a different client");
  }
  if (typeof claims.exp !== "number" || claims.exp + leeway <= seconds) {
    throw new Error("token has expired");
  }
  /* A token issued in the future is a clock problem or a forgery; either way
     it is not something to sign a session against. */
  if (typeof claims.iat === "number" && claims.iat - leeway > seconds) {
    throw new Error("token was issued in the future");
  }
  if (claims.email_verified !== true) {
    throw new Error("email is not verified");
  }
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("token has no sub");
  if (typeof claims.email !== "string" || !claims.email) throw new Error("token has no email");

  return {
    sub: claims.sub,
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : claims.email,
    picture: typeof claims.picture === "string" ? claims.picture : ""
  };
}

/** Test seam, and the escape hatch if a rotation is ever caught mid-flight. */
export function clearJwksCache(): void {
  cache = null;
}

async function importKey(kid: string, options: VerifyOptions): Promise<CryptoKey> {
  const url = options.jwksUrl ?? DEFAULT_JWKS_URL;
  const now = options.now ?? Date.now();

  let keys = await jwks(url, now, options.fetchImpl, false);
  /* An unknown kid means Google rotated since we cached. One forced refetch
     distinguishes a real rotation from a forged kid; a second would let a
     bad token hammer Google on every request. */
  if (!keys.has(kid)) keys = await jwks(url, now, options.fetchImpl, true);

  const jwk = keys.get(kid);
  if (!jwk) throw new Error(`no Google key matches kid ${kid}`);

  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

async function jwks(
  url: string,
  now: number,
  fetchImpl: typeof fetch | undefined,
  force: boolean
): Promise<Map<string, JsonWebKey>> {
  if (!force && cache && cache.url === url && now < cache.expiresAt) return cache.keys;

  const doFetch = fetchImpl ?? fetch;
  /* Google's certificate endpoint, on the sign-in path: a hang here is an owner
     tapping Google's button and getting nothing back. Passed to whatever
     `fetchImpl` is, because a caller that supplied one still wants the
     deadline — see internal/upstream.ts. */
  const signal = deadline(JWKS_TIMEOUT_MS);
  const response = await doFetch(url, signal ? { signal } : {});
  if (!response.ok) throw new Error(`JWKS fetch: ${response.status}`);
  const body = (await response.json()) as { keys?: JsonWebKey[] };
  if (!body.keys?.length) throw new Error("JWKS response has no keys");

  const keys = new Map<string, JsonWebKey>();
  for (const jwk of body.keys) {
    const kid = (jwk as { kid?: string }).kid;
    if (kid) keys.set(kid, jwk);
  }

  cache = { url, keys, expiresAt: now + maxAgeMs(response.headers.get("cache-control")) };
  return keys;
}

/** Google's Cache-Control is generous (hours). Fall back to an hour, and cap
    nothing — the forced refetch above covers an early rotation. */
function maxAgeMs(header: string | null): number {
  const match = header?.match(/max-age=(\d+)/);
  const seconds = match?.[1] ? Number(match[1]) : 0;
  return (seconds > 0 ? seconds : 3600) * 1000;
}
