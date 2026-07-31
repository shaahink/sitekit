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
import { importVerifyKey } from "../internal/jwks.js";

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

  const key = await importVerifyKey(kid, {
    url: options.jwksUrl ?? DEFAULT_JWKS_URL,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
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

/** Test seam, and the escape hatch if a rotation is ever caught mid-flight.
    Re-exported rather than reimplemented: the cache moved to internal/jwks.ts
    at 0.19.0 so Google's keys and the auth origin's stop evicting each other,
    and every existing caller of this name keeps working. */
export { clearJwksCache } from "../internal/jwks.js";
