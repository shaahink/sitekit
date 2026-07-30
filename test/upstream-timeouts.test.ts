/* Deadlines on the calls that leave the building.
   ---------------------------------------------------------------------------
   Session 16's F4: not one of the kit's server-side upstream calls had a
   timeout, and that defeated a design the kit had already paid for. `ownerHome`
   settles its blocks independently *so that* a slow GitHub cannot cost the
   traffic block — and a hung analytics instance took every block plus the
   deploy state plus the share link, because the invocation had one deadline and
   none of the calls inside it had any.

   What is tested here is the property, not the plumbing: a request that never
   answers has to end by itself, and it has to end saying it timed out rather
   than that something was aborted — the two mean opposite things about whose
   fault it is, and one of them reads as a bug in the caller.

   Overrides are used to keep these fast. The defaults are asserted separately
   through `githubTimeout`, because a signal carries no readable delay: you can
   ask a signal whether it has aborted and never how long it was given. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { gh } from "../src/feedback/github.js";
import { clearAppTokenCache, installationToken } from "../src/feedback/app-auth.js";
import { clearStatsTokenCache, statsToken } from "../src/analytics/stats.js";
import { clearJwksCache } from "../src/cms/google.js";
import {
  deadline,
  githubTimeout,
  GITHUB_TIMEOUT_MS,
  GITHUB_WRITE_TIMEOUT_MS,
  isTimeout,
  JWKS_TIMEOUT_MS,
  STATS_TIMEOUT_MS
} from "../src/internal/upstream.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PKCS8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

/** A server that accepts the connection and never answers — the failure that
    was measured, rather than a refused connection, which already worked. */
function hanging() {
  return vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; /* hangs forever, which is the point of the test */
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  });
}

let fetchMock: ReturnType<typeof hanging>;

beforeEach(() => {
  clearAppTokenCache();
  clearStatsTokenCache();
  clearJwksCache();
  fetchMock = hanging();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the deadline itself", () => {
  it("aborts with a TimeoutError, which says whose fault it was", async () => {
    const signal = deadline(10);
    expect(signal).toBeInstanceOf(AbortSignal);
    await new Promise((resolve) => signal!.addEventListener("abort", resolve));
    expect(isTimeout(signal!.reason)).toBe(true);
    /* A client that hung up aborts too, and means the opposite. */
    expect(isTimeout(new DOMException("aborted", "AbortError"))).toBe(false);
  });

  it("means no deadline at all when a caller asks for none", () => {
    expect(deadline(0)).toBeUndefined();
  });

  it("gives a write longer than a read, and lets either be overridden", () => {
    /* A read cut off is unambiguous; a write cut off may already have been
       taken by GitHub. Both are inside the platform's ten-second ceiling —
       without them the ambiguity happens anyway, as a 504 with nothing said. */
    expect(githubTimeout("GET")).toBe(GITHUB_TIMEOUT_MS);
    expect(githubTimeout("PUT")).toBe(GITHUB_WRITE_TIMEOUT_MS);
    expect(GITHUB_WRITE_TIMEOUT_MS).toBeGreaterThan(GITHUB_TIMEOUT_MS);
    expect(githubTimeout("PUT", 250)).toBe(250);
    expect(githubTimeout("GET", 0)).toBe(0);
    /* Inside a Vercel function's default ceiling, with room for the two
       sequential GitHub calls `ownerHome` can make. */
    expect(GITHUB_TIMEOUT_MS * 2).toBeLessThan(10_000);
    /* Analytics is the block an owner is least entitled to be shown a failure
       of, so it waits the least. */
    expect(STATS_TIMEOUT_MS).toBeLessThanOrEqual(GITHUB_TIMEOUT_MS);
    expect(JWKS_TIMEOUT_MS).toBeLessThanOrEqual(GITHUB_TIMEOUT_MS);
  });
});

describe("every server-side upstream funnel", () => {
  it("gives up on a GitHub call that never answers", async () => {
    await expect(gh("/repos/o/r", { token: "t", userAgent: "test", timeoutMs: 20 })).rejects.toSatisfy(
      isTimeout
    );
  });

  it("passes a deadline by default, on a read and on a write", async () => {
    void gh("/repos/o/r", { token: "t", userAgent: "test" }).catch(() => {});
    void gh("/repos/o/r/contents/x", { token: "t", userAgent: "test", method: "PUT" }).catch(() => {});
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives up on the App installation token, which precedes every other call", async () => {
    await expect(
      installationToken({
        appId: "1",
        privateKey: PKCS8,
        installationId: "2",
        userAgent: "test",
        timeoutMs: 20
      })
    ).rejects.toSatisfy(isTimeout);
  });

  it("gives up on an analytics login", async () => {
    await expect(
      statsToken({
        baseUrl: "https://stats.example",
        username: "u",
        password: "p",
        timeoutMs: 20
      })
    ).rejects.toSatisfy(isTimeout);
  });

  /* Google's certificates, on the sign-in path, are covered where the signing
     fixtures already live — cms-google.test.ts, "gives the JWKS fetch a
     deadline". Reaching that call needs a real RS256 token, and a second copy
     of the keypair machinery here would be the more expensive half of a test
     that proves the same thing. */
});
