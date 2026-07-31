/* Bug #37, and the reason it needed a test of its own.
   ---------------------------------------------------------------------------
   Until 0.19.0 the JWKS cache was one slot with a `cache.url === url` guard.
   That is correct for one issuer and silently wrong for two, and after A1.4
   every site in the fleet verifies against two: Google's keys for the direct
   sign-in that must keep working, and the auth origin's for the hand-off.
   Alternating them through one slot missed every time.

   **No refusal-path test can see this.** Every verification still returns the
   right answer; what changes is that a live network round-trip appears on the
   sign-in path — the one place internal/upstream.ts has already decided a hang
   is unacceptable. So the assertion is on the number of fetches, which is the
   only place the defect is observable at all. */

import { describe, it, expect, beforeEach } from "vitest";
import { clearJwksCache, importVerifyKey } from "../src/internal/jwks.js";
import { generateKeyPairSync } from "node:crypto";

const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const auth = generateKeyPairSync("rsa", { modulusLength: 2048 });

const GOOGLE_URL = "https://www.googleapis.com/oauth2/v3/certs";
const AUTH_URL = "https://sk.works/api/handoff?jwks=1";
const NOW = 1_753_650_000_000;

const perUrl = new Map<string, number>();

function jwk(key: typeof google.publicKey, kid: string): Record<string, unknown> {
  return { ...(key.export({ format: "jwk" }) as object), kid, alg: "RS256", use: "sig" };
}

function countingFetch(): typeof fetch {
  return (async (url: string) => {
    perUrl.set(url, (perUrl.get(url) ?? 0) + 1);
    const keys =
      url === GOOGLE_URL ? [jwk(google.publicKey, "g1")] : [jwk(auth.publicKey, "a1")];
    return new Response(JSON.stringify({ keys }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=7200" }
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  clearJwksCache();
  perUrl.clear();
});

describe("two issuers, one cache", () => {
  it("fetches each issuer once however often they alternate", async () => {
    const fetchImpl = countingFetch();
    for (let i = 0; i < 4; i++) {
      await importVerifyKey("g1", { url: GOOGLE_URL, now: NOW, fetchImpl });
      await importVerifyKey("a1", { url: AUTH_URL, now: NOW, fetchImpl });
    }
    /* Eight lookups, two fetches. Before 0.19.0 this was eight — every one of
       them on an owner's sign-in path. */
    expect(perUrl.get(GOOGLE_URL)).toBe(1);
    expect(perUrl.get(AUTH_URL)).toBe(1);
  });

  it("keeps one issuer's keys out of the other's answers", async () => {
    const fetchImpl = countingFetch();
    await importVerifyKey("g1", { url: GOOGLE_URL, now: NOW, fetchImpl });
    /* `a1` is not among Google's keys. One forced refetch, then a refusal —
       and crucially not a key belonging to the other issuer. */
    await expect(
      importVerifyKey("a1", { url: GOOGLE_URL, now: NOW, fetchImpl })
    ).rejects.toThrow(/no key at https:\/\/www\.googleapis\.com/);
  });

  it("expires each issuer on its own clock", async () => {
    const fetchImpl = countingFetch();
    await importVerifyKey("g1", { url: GOOGLE_URL, now: NOW, fetchImpl });
    await importVerifyKey("a1", { url: AUTH_URL, now: NOW, fetchImpl });
    await importVerifyKey("g1", { url: GOOGLE_URL, now: NOW + 7201_000, fetchImpl });
    expect(perUrl.get(GOOGLE_URL)).toBe(2);
    expect(perUrl.get(AUTH_URL)).toBe(1);
  });

  it("clears one issuer without evicting the other", async () => {
    const fetchImpl = countingFetch();
    await importVerifyKey("g1", { url: GOOGLE_URL, now: NOW, fetchImpl });
    await importVerifyKey("a1", { url: AUTH_URL, now: NOW, fetchImpl });
    clearJwksCache(AUTH_URL);
    await importVerifyKey("g1", { url: GOOGLE_URL, now: NOW, fetchImpl });
    await importVerifyKey("a1", { url: AUTH_URL, now: NOW, fetchImpl });
    expect(perUrl.get(GOOGLE_URL)).toBe(1);
    expect(perUrl.get(AUTH_URL)).toBe(2);
  });
});
