/* The hand-off ticket — signed at the auth origin, verified at a site.
   ---------------------------------------------------------------------------
   Google matches Authorised JavaScript Origins exactly and offers no wildcard,
   so every new site used to cost a visit to somebody else's console before its
   owner could sign in at all. Session 22 removes the need rather than
   automating the click: sign-in happens once, on the one origin that is
   registered, and that origin hands each site a short-lived assertion of who
   just signed in. `sessions/22-fleet-auth.md` in sk-platform is the decision
   record; this file is Decisions 1 and 3.

   **RS256, asymmetric, Web Crypto** (Decision 1). The auth origin holds one
   private key; a site holds a URL and no secret at all. The honest reason it
   beats an HMAC shared secret is not blast radius — that key mints tickets for
   everyone either way — it is that the half travelling *to* the sites cannot
   mint anything, so a compromised site cannot forge a ticket for its siblings,
   and site #8 costs zero new secrets rather than one generated and stored in
   two places.

   **The ticket carries identity and not permission** (Decision 4). It is the
   same four fields `verifyIdToken` returns and nothing about what the holder
   may do, because each site's own `CMS_ALLOWLIST` still answers *may you edit
   me*. The issuer therefore mints a ticket for any Google account that signs
   in, including a stranger's — an assertion about who someone is, not a grant.
   The site refuses at the allowlist exactly as it refuses an unknown Google
   account today.

   Every failure throws. Callers turn that into one flat refusal and log the
   detail: telling an attacker which check failed is free intelligence. */

import { base64UrlDecode, base64UrlEncode, base64UrlJson, decodeJwtJson } from "../internal/base64url.js";
import { importVerifyKey } from "../internal/jwks.js";
import { pkcs8ToDer } from "../internal/pem.js";
import type { GoogleIdentity } from "./google.js";

/** Sixty seconds, and the reason is Decision 3 property 2. The ticket's whole
    life is one redirect, and it travels in a URL — which lands in browser
    history, in the `Referer` of anything the callback loads, and in the host's
    request logs. Ample for a redirect, useless to anyone reading a log after. */
const DEFAULT_TTL_SECONDS = 60;

/** Five seconds, deliberately not the sixty `google.ts` allows Google. Leeway
    is added to a lifetime, so a minute of it on a minute-long ticket doubles
    the window property 2 exists to make small. Both ends of this hand-off are
    our own hosts on cloud clocks, so the drift being tolerated is real but
    tiny. */
const DEFAULT_LEEWAY_SECONDS = 5;

export interface TicketClaims {
  identity: GoogleIdentity;
  /** The nonce that makes every ticket unique. Decision 3 property 3. */
  jti: string;
}

export interface SignTicketOptions {
  /** PKCS#8 PEM. `CMS_TICKET_PRIVATE_KEY` on the auth origin, and the only
      secret this design adds anywhere in the fleet. */
  privateKey: string;
  /** The auth origin, e.g. `https://sk.works`. Becomes `iss`. */
  issuer: string;
  /** The requesting site's origin, and nothing else. Becomes `aud`. */
  audience: string;
  identity: GoogleIdentity;
  now?: number;
  ttlSeconds?: number;
  /** Test seam. Left alone, sixteen random bytes. */
  jti?: string;
}

export interface VerifyTicketOptions {
  /** `CMS_AUTH_ORIGIN` — the only issuer this site accepts a ticket from. */
  issuer: string;
  /** This site's own origin. A ticket minted for `shade` must not verify at
      `mosleh`, which is Decision 3 property 1. */
  audience: string;
  now?: number;
  leewaySeconds?: number;
  /** Defaults to the issuer's published JWKS. */
  jwksUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Where a site fetches the auth origin's public keys, and where the issuer
    publishes them. Derived from one variable rather than configured as a
    second, because configuration that can be computed from the thing it
    describes is configuration that can go stale. */
export function jwksUrl(authOrigin: string): string {
  return `${trimOrigin(authOrigin)}/api/handoff?jwks=1`;
}

/** Where a site sends an owner to sign in. Same reasoning as `jwksUrl`. */
export function handoffUrl(
  authOrigin: string,
  params: { return: string; state: string; lang?: string | undefined }
): string {
  const url = new URL(`${trimOrigin(authOrigin)}/api/handoff`);
  url.searchParams.set("return", params.return);
  url.searchParams.set("state", params.state);
  if (params.lang) url.searchParams.set("lang", params.lang);
  return url.toString();
}

/** An origin with any trailing slash removed, so `https://sk.works/` and
    `https://sk.works` are the same configured value. Everything downstream
    compares origins as strings, and a trailing slash set by whoever typed the
    environment variable is not a difference anybody meant. */
export function trimOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

export async function signTicket(options: SignTicketOptions): Promise<string> {
  const key = await privateKeyFor(options.privateKey);
  const seconds = Math.floor((options.now ?? Date.now()) / 1000);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  const header = base64UrlJson({ alg: "RS256", typ: "JWT", kid: key.kid });
  const payload = base64UrlJson({
    iss: trimOrigin(options.issuer),
    aud: trimOrigin(options.audience),
    iat: seconds,
    exp: seconds + ttl,
    jti: options.jti ?? randomToken(),
    sub: options.identity.sub,
    email: options.identity.email,
    name: options.identity.name,
    picture: options.identity.picture
  });
  const signingInput = `${header}.${payload}`;

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key.signing,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** The identity a ticket asserts, or a throw.

    Deliberately **not** `verifyIdToken` with different arguments: that function
    pins `iss` to Google's two spellings, requires `email_verified`, and reads
    `aud` as an OAuth client ID. All three are wrong here — the issuer is our
    own origin, the email was already verified once at the auth origin, and
    `aud` is a site origin. Sharing the function would mean loosening each of
    those checks for both callers. */
export async function verifyTicket(
  ticket: string,
  options: VerifyTicketOptions
): Promise<TicketClaims> {
  const parts = ticket.split(".");
  if (parts.length !== 3) throw new Error("ticket is not a three-part JWT");
  const headerPart = parts[0] as string;
  const payloadPart = parts[1] as string;
  const signaturePart = parts[2] as string;

  const header = decodeJwtJson(headerPart);
  /* Pin the algorithm. Accepting whatever the token names is how "alg: none"
     and HMAC-with-the-public-key forgeries get in. */
  if (header.alg !== "RS256") throw new Error(`unexpected alg: ${String(header.alg)}`);
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) throw new Error("ticket header has no kid");

  const issuer = trimOrigin(options.issuer);
  const key = await importVerifyKey(kid, {
    url: options.jwksUrl ?? jwksUrl(issuer),
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
  const leeway = options.leewaySeconds ?? DEFAULT_LEEWAY_SECONDS;

  if (claims.iss !== issuer) {
    throw new Error(`unexpected iss: ${String(claims.iss)}`);
  }
  /* Property 1. Without this, any one of six sites can replay its own owner's
     ticket at any other. */
  if (claims.aud !== trimOrigin(options.audience)) {
    throw new Error("ticket is addressed to a different site");
  }
  if (typeof claims.exp !== "number" || claims.exp + leeway <= seconds) {
    throw new Error("ticket has expired");
  }
  /* A ticket issued in the future is a clock problem or a forgery; either way
     it is not something to sign a session against. */
  if (typeof claims.iat === "number" && claims.iat - leeway > seconds) {
    throw new Error("ticket was issued in the future");
  }
  if (typeof claims.jti !== "string" || !claims.jti) throw new Error("ticket has no jti");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("ticket has no sub");
  if (typeof claims.email !== "string" || !claims.email) throw new Error("ticket has no email");

  return {
    jti: claims.jti,
    identity: {
      sub: claims.sub,
      email: claims.email,
      name: typeof claims.name === "string" ? claims.name : claims.email,
      picture: typeof claims.picture === "string" ? claims.picture : ""
    }
  };
}

/** The JWKS the auth origin publishes: the public half and nothing else.

    `exportKey("jwk")` on a private key hands back `d`, `p`, `q`, `dp`, `dq` and
    `qi` alongside `n` and `e` — the whole secret. Three fields are copied out
    by name rather than the rest deleted, because a deny-list here is one Web
    Crypto revision away from publishing a private key. */
export async function ticketJwks(privateKey: string): Promise<{ keys: JsonWebKey[] }> {
  const key = await privateKeyFor(privateKey);
  return {
    keys: [
      {
        kty: "RSA",
        n: key.n,
        e: key.e,
        /* Ours to add: Web Crypto's export carries none of these, and the
           verifier indexes by `kid` and refetches once on an unknown one. */
        kid: key.kid,
        alg: "RS256",
        use: "sig"
      } as JsonWebKey
    ]
  };
}

/** The key id the issuer signs with. RFC 7638's JWK thumbprint, so it is a
    function of the key rather than a configured string: rotating the key
    rotates the `kid` with it, both halves compute the same one, and nothing
    has to be told about the change. */
export async function ticketKid(privateKey: string): Promise<string> {
  return (await privateKeyFor(privateKey)).kid;
}

interface LoadedKey {
  signing: CryptoKey;
  kid: string;
  n: string;
  e: string;
}

/* Warm-instance cache, like app-auth's token cache. Importing a PEM, exporting
   its JWK and digesting the thumbprint is three Web Crypto calls, and this sits
   on the sign-in path. Keyed by the PEM itself so a rotated key is a different
   entry rather than a stale one. Module scope holds no environment — a Worker
   has none there — only what a request already handed us. */
const keys = new Map<string, LoadedKey>();

async function privateKeyFor(pem: string): Promise<LoadedKey> {
  const hit = keys.get(pem);
  if (hit) return hit;

  const der = pkcs8ToDer(pem, "Ticket signing key");
  /* Extractable, because the public half has to be published and the `kid` is
     derived from it. The private material never leaves this function. */
  const signing = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"]
  );
  const jwk = (await crypto.subtle.exportKey("jwk", signing)) as { n?: string; e?: string };
  if (!jwk.n || !jwk.e) throw new Error("Ticket signing key is not RSA");

  const loaded: LoadedKey = {
    signing,
    n: jwk.n,
    e: jwk.e,
    kid: await thumbprint(jwk.n, jwk.e)
  };
  keys.set(pem, loaded);
  return loaded;
}

/** Test seam, and the escape hatch if a key is ever rotated in place. */
export function clearTicketKeyCache(): void {
  keys.clear();
}

/** RFC 7638 §3: SHA-256 over the required members, lexicographic, no
    whitespace. Written literally rather than through `JSON.stringify` of an
    object, because the ordering is the specification and an object literal's
    key order is a language detail that happens to agree today. */
async function thumbprint(n: string, e: string): Promise<string> {
  const canonical = `{"e":"${e}","kty":"RSA","n":"${n}"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Sixteen random bytes, base64url. Used for the ticket's `jti` and for the
    `state` a site binds to its cookie. */
export function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
