import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { clearJwksCache, verifyIdToken } from "../src/cms/google.js";

/* Real keypairs, like app-auth's tests: a forged-token test that never signs
   anything proves nothing. The second pair is the attacker's — a token signed
   with it must not pass, however well-formed it looks. */
const good = generateKeyPairSync("rsa", { modulusLength: 2048 });
const evil = generateKeyPairSync("rsa", { modulusLength: 2048 });

const KID = "sk-test-key";
const CLIENT_ID = "1234.apps.googleusercontent.com";
const NOW = 1_753_650_000_000;

function jwk(key: typeof good.publicKey, kid: string): Record<string, unknown> {
  return { ...(key.export({ format: "jwk" }) as object), kid, alg: "RS256", use: "sig" };
}

function b64url(value: object | Uint8Array): string {
  const bytes =
    value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
  return bytes.toString("base64url");
}

async function sign(
  claims: Record<string, unknown>,
  options: { kid?: string; key?: typeof good.privateKey; alg?: string } = {}
): Promise<string> {
  const header = b64url({ alg: options.alg ?? "RS256", typ: "JWT", kid: options.kid ?? KID });
  const payload = b64url(claims);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    (options.key ?? good.privateKey).export({ type: "pkcs8", format: "der" }),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

/** The claim set Google actually sends, so each test can spoil exactly one. */
function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "108134",
    email: "shaahin69@gmail.com",
    email_verified: true,
    name: "Shahin Kiassat",
    picture: "https://lh3.googleusercontent.com/a/x",
    iat: NOW / 1000 - 10,
    exp: NOW / 1000 + 3600,
    ...overrides
  };
}

let fetches = 0;
let served: Record<string, unknown>[] = [];

function fakeFetch(): typeof fetch {
  return (async () => {
    fetches++;
    return new Response(JSON.stringify({ keys: served }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=7200" }
    });
  }) as unknown as typeof fetch;
}

const options = () => ({
  clientId: CLIENT_ID,
  now: NOW,
  jwksUrl: "https://jwks.test/certs",
  fetchImpl: fakeFetch()
});

beforeEach(() => {
  clearJwksCache();
  fetches = 0;
  served = [jwk(good.publicKey, KID)];
});

describe("verifyIdToken", () => {
  it("accepts a well-formed Google token and returns the identity", async () => {
    const identity = await verifyIdToken(await sign(claims()), options());
    expect(identity).toEqual({
      sub: "108134",
      email: "shaahin69@gmail.com",
      name: "Shahin Kiassat",
      picture: "https://lh3.googleusercontent.com/a/x"
    });
  });

  it("accepts the bare issuer spelling Google also uses", async () => {
    const identity = await verifyIdToken(
      await sign(claims({ iss: "accounts.google.com" })),
      options()
    );
    expect(identity.sub).toBe("108134");
  });

  it("rejects a token addressed to a different client", async () => {
    const token = await sign(claims({ aud: "someone-else.apps.googleusercontent.com" }));
    await expect(verifyIdToken(token, options())).rejects.toThrow(/different client/);
  });

  it("rejects an expired token", async () => {
    const token = await sign(claims({ exp: NOW / 1000 - 120 }));
    await expect(verifyIdToken(token, options())).rejects.toThrow(/expired/);
  });

  it("rejects a token signed with the wrong key", async () => {
    const token = await sign(claims(), { key: evil.privateKey });
    await expect(verifyIdToken(token, options())).rejects.toThrow(/signature/);
  });

  it("rejects a token whose payload was edited after signing", async () => {
    const token = await sign(claims());
    const parts = token.split(".");
    parts[1] = b64url(claims({ email: "attacker@example.com" }));
    await expect(verifyIdToken(parts.join("."), options())).rejects.toThrow(/signature/);
  });

  it("rejects an unverified email", async () => {
    const token = await sign(claims({ email_verified: false }));
    await expect(verifyIdToken(token, options())).rejects.toThrow(/not verified/);
  });

  it("rejects `alg: none`, however valid the rest looks", async () => {
    const header = b64url({ alg: "none", typ: "JWT", kid: KID });
    const token = `${header}.${b64url(claims())}.`;
    await expect(verifyIdToken(token, options())).rejects.toThrow(/unexpected alg/);
  });

  it("rejects an issuer that isn't Google", async () => {
    const token = await sign(claims({ iss: "https://accounts.evil.test" }));
    await expect(verifyIdToken(token, options())).rejects.toThrow(/unexpected iss/);
  });

  it("rejects a token issued in the future", async () => {
    const token = await sign(claims({ iat: NOW / 1000 + 600 }));
    await expect(verifyIdToken(token, options())).rejects.toThrow(/future/);
  });

  it("rejects anything that isn't a three-part JWT", async () => {
    await expect(verifyIdToken("not-a-jwt", options())).rejects.toThrow(/three-part/);
  });

  it("rejects a token with no kid to look up", async () => {
    const header = b64url({ alg: "RS256", typ: "JWT" });
    await expect(verifyIdToken(`${header}.${b64url(claims())}.x`, options())).rejects.toThrow(
      /no kid/
    );
  });
});

describe("the JWKS cache", () => {
  it("fetches Google's keys once across many sign-ins", async () => {
    const token = await sign(claims());
    await verifyIdToken(token, options());
    await verifyIdToken(token, options());
    await verifyIdToken(token, options());
    expect(fetches).toBe(1);
  });

  it("refetches once when a kid it has never seen turns up, so rotation heals", async () => {
    await verifyIdToken(await sign(claims()), options());
    expect(fetches).toBe(1);

    /* Google rotates: a new kid signs the next token. */
    served = [jwk(good.publicKey, "rotated-key")];
    const rotated = await sign(claims(), { kid: "rotated-key" });
    const identity = await verifyIdToken(rotated, options());
    expect(identity.sub).toBe("108134");
    expect(fetches).toBe(2);
  });

  it("does not hammer Google when a forged kid never resolves", async () => {
    const token = await sign(claims(), { kid: "invented" });
    /* The message names the issuer's URL since 0.19.0, because there are two
       of them now — Google's and the fleet auth origin's — and "no key matches
       kid" in a log without saying whose keys were consulted is half a fact. */
    await expect(verifyIdToken(token, options())).rejects.toThrow(
      /no key at https:\/\/jwks\.test\/certs matches kid invented/
    );
    /* One cached read, one forced refetch, and then it gives up. */
    expect(fetches).toBe(2);
  });

  it("expires the cache when Google's max-age runs out", async () => {
    const token = await sign(claims());
    await verifyIdToken(token, options());
    await verifyIdToken(token, { ...options(), now: NOW + 7201 * 1000, leewaySeconds: 99999 });
    expect(fetches).toBe(2);
  });

  /* Session 16's F4. This call is on the sign-in path, so a hang here is an
     owner tapping Google's button and getting nothing back at all. The deadline
     is handed to whatever `fetchImpl` was supplied, because a Worker that
     brings its own fetch still wants one. */
  it("gives the JWKS fetch a deadline, through a supplied fetchImpl", async () => {
    let seen: RequestInit | undefined;
    const recording = (async (_url: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ keys: served }), {
        headers: { "content-type": "application/json" }
      });
    }) as unknown as typeof fetch;

    await verifyIdToken(await sign(claims()), { ...options(), fetchImpl: recording });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(seen?.signal?.aborted).toBe(false);
  });
});
