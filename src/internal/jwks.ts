/* Somebody else's public keys, fetched and cached.
   ---------------------------------------------------------------------------
   Two issuers now sign things this kit verifies: Google, whose ID token proves
   who an owner is, and the fleet's own auth origin, whose hand-off ticket says
   the same thing about somebody who signed in on a different host (session 22).
   Both publish RS256 keys as a JWKS, both index by `kid`, and both rotate on
   their own schedule — so the fetch, the cache and the one forced refetch on an
   unknown `kid` are the same code twice and live here once.

   **The cache is keyed by URL and that is load-bearing, not tidiness.** It used
   to be a single slot with a `cache.url === url` guard, which is correct for
   one issuer and silently wrong for two: after a site is given `CMS_AUTH_ORIGIN`
   it verifies against Google's JWKS *and* the auth origin's, and the two evict
   each other on every alternation. Nothing about the answers changes — every
   verification still succeeds — so no refusal-path test can see it. What
   changes is that a live network round-trip appears on the sign-in path, which
   is exactly where this kit has already decided a hang is unacceptable
   (internal/upstream.ts). Filed as bug #37 before it shipped; fixed here.

   Warm-instance only: survives requests on the same instance, vanishes with it.
   A cold fetch costs one round-trip every few hours per issuer. */

import { deadline, JWKS_TIMEOUT_MS } from "./upstream.js";

interface KeyCache {
  keys: Map<string, JsonWebKey>;
  expiresAt: number;
}

const cache = new Map<string, KeyCache>();

export interface JwksOptions {
  url: string;
  /** Milliseconds, injectable so expiry is testable without waiting. */
  now?: number;
  fetchImpl?: typeof fetch;
}

/** The RS256 verification key for `kid`, from cache or from the issuer.
    Throws — like everything on this path — so a caller can turn the lot into
    one flat refusal and log the real reason. */
export async function importVerifyKey(kid: string, options: JwksOptions): Promise<CryptoKey> {
  const now = options.now ?? Date.now();

  let keys = await jwks(options.url, now, options.fetchImpl, false);
  /* An unknown kid means the issuer rotated since we cached. One forced
     refetch distinguishes a real rotation from a forged kid; a second would
     let a bad token hammer the issuer on every request. */
  if (!keys.has(kid)) keys = await jwks(options.url, now, options.fetchImpl, true);

  const jwk = keys.get(kid);
  if (!jwk) throw new Error(`no key at ${options.url} matches kid ${kid}`);

  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

/** Test seam, and the escape hatch if a rotation is ever caught mid-flight.
    Without a URL it clears every issuer, which is what a test wants. */
export function clearJwksCache(url?: string): void {
  if (url) cache.delete(url);
  else cache.clear();
}

async function jwks(
  url: string,
  now: number,
  fetchImpl: typeof fetch | undefined,
  force: boolean
): Promise<Map<string, JsonWebKey>> {
  const hit = cache.get(url);
  if (!force && hit && now < hit.expiresAt) return hit.keys;

  const doFetch = fetchImpl ?? fetch;
  /* On the sign-in path: a hang here is an owner tapping a button and getting
     nothing back. Passed to whatever `fetchImpl` is, because a caller that
     supplied one still wants the deadline — see internal/upstream.ts. */
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

  cache.set(url, { keys, expiresAt: now + maxAgeMs(response.headers.get("cache-control")) });
  return keys;
}

/** Google's Cache-Control is generous (hours). Fall back to an hour, and cap
    nothing — the forced refetch above covers an early rotation. */
function maxAgeMs(header: string | null): number {
  const match = header?.match(/max-age=(\d+)/);
  const seconds = match?.[1] ? Number(match[1]) : 0;
  return (seconds > 0 ? seconds : 3600) * 1000;
}
