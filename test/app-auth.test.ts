import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { appJwt, clearAppTokenCache, installationToken } from "../src/feedback/app-auth.js";
import { createFeedbackHandler } from "../src/feedback/handler.js";

/* A real RSA keypair per run — the JWT must verify against the public half,
   not just look like three base64 blobs. */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PKCS8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const PKCS1 = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
const SPKI = publicKey.export({ type: "spki", format: "der" }) as Buffer;

function decodeSegment(segment: string): any {
  return JSON.parse(Buffer.from(segment, "base64url").toString());
}

describe("appJwt", () => {
  it("signs a verifiable RS256 JWT with GitHub's claim shape", async () => {
    const now = 1_753_650_000_000;
    const jwt = await appJwt("12345", PKCS8, now);
    const [header, payload, signature] = jwt.split(".");

    expect(decodeSegment(header!)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodeSegment(payload!)).toEqual({
      iat: now / 1000 - 60,
      exp: now / 1000 + 540,
      iss: "12345"
    });

    const key = await crypto.subtle.importKey(
      "spki",
      SPKI,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      Buffer.from(signature!, "base64url"),
      new TextEncoder().encode(`${header}.${payload}`)
    );
    expect(valid).toBe(true);
  });

  it("rejects a PKCS#1 key with the conversion hint", async () => {
    await expect(appJwt("12345", PKCS1)).rejects.toThrow(/PKCS#8/);
  });
});

describe("installationToken", () => {
  const OPTIONS = {
    appId: "12345",
    privateKey: PKCS8,
    installationId: "678",
    userAgent: "test"
  };

  beforeEach(() => clearAppTokenCache());
  afterEach(() => vi.unstubAllGlobals());

  function stubMint(token: string, expiresInMs: number) {
    const impl = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe("https://api.github.com/app/installations/678/access_tokens");
      expect(init.headers.Authorization).toMatch(/^Bearer ey/);
      return new Response(
        JSON.stringify({ token, expires_at: new Date(Date.now() + expiresInMs).toISOString() }),
        { status: 201 }
      );
    });
    vi.stubGlobal("fetch", impl);
    return impl;
  }

  it("mints once and serves the cache until expiry", async () => {
    const impl = stubMint("ghs_abc", 60 * 60 * 1000);
    expect(await installationToken(OPTIONS)).toBe("ghs_abc");
    expect(await installationToken(OPTIONS)).toBe("ghs_abc");
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("re-mints when the cached token is inside the expiry margin", async () => {
    stubMint("ghs_old", 30_000);
    await installationToken(OPTIONS);
    const impl = stubMint("ghs_new", 60 * 60 * 1000);
    expect(await installationToken(OPTIONS)).toBe("ghs_new");
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("surfaces GitHub's rejection instead of caching it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad credentials", { status: 401 })));
    await expect(installationToken(OPTIONS)).rejects.toThrow(/401/);
  });
});

describe("handler credential resolution", () => {
  it("reports configured with App credentials and no PAT", async () => {
    const handler = createFeedbackHandler({
      env: {
        appId: "12345",
        appPrivateKey: PKCS8,
        appInstallationId: "678",
        repo: "shaahink/example",
        reviewKey: "k"
      }
    });
    const response = await handler.GET();
    expect(await response.json()).toEqual({ ok: true, configured: true });
  });
});
