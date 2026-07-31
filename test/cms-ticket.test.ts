/* The hand-off ticket, both halves.
   ---------------------------------------------------------------------------
   Real keypairs throughout, like cms-google's: a forgery test that never signs
   anything proves nothing. The second pair is the attacker's — a ticket signed
   with it must not pass however well-formed it looks.

   Every one of Decision 3's five properties that lives *in the ticket* has a
   test here that proves the REFUSAL rather than the acceptance. Property 5,
   `state`, is not in the ticket by design and is proven in cms-auth-handoff. */

import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { clearJwksCache } from "../src/internal/jwks.js";
import {
  clearTicketKeyCache,
  handoffUrl,
  jwksUrl,
  signTicket,
  ticketJwks,
  ticketKid,
  trimOrigin,
  verifyTicket
} from "../src/cms/ticket.js";

const good = generateKeyPairSync("rsa", { modulusLength: 2048 });
const evil = generateKeyPairSync("rsa", { modulusLength: 2048 });

const PEM = good.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const EVIL_PEM = evil.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

const AUTH = "https://sk.works";
const SITE = "https://mosleh-clinic.vercel.app";
const NOW = 1_753_650_000_000;

const IDENTITY = {
  sub: "108134",
  email: "dr@example.com",
  name: "Dr Mosleh",
  picture: "https://lh3.googleusercontent.com/a/x"
};

let fetches = 0;
let servedPem = PEM;

function fakeFetch(): typeof fetch {
  return (async () => {
    fetches++;
    return new Response(JSON.stringify(await ticketJwks(servedPem)), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" }
    });
  }) as unknown as typeof fetch;
}

const verifyOptions = () => ({
  issuer: AUTH,
  audience: SITE,
  now: NOW,
  fetchImpl: fakeFetch()
});

const mint = (overrides: Record<string, unknown> = {}) =>
  signTicket({
    privateKey: PEM,
    issuer: AUTH,
    audience: SITE,
    identity: IDENTITY,
    now: NOW,
    ...overrides
  });

beforeEach(() => {
  clearJwksCache();
  clearTicketKeyCache();
  fetches = 0;
  servedPem = PEM;
});

describe("the ticket, end to end", () => {
  it("carries the same identity a verified Google ID token produces", async () => {
    const claims = await verifyTicket(await mint(), verifyOptions());
    /* Decision 2's test of whether the design is right: the ticket's only job
       is to arrive at the allowlist with this exact object. */
    expect(claims.identity).toEqual(IDENTITY);
    expect(claims.jti).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("gives every ticket a different jti, so one can never become a credential", async () => {
    const [a, b] = [await mint(), await mint()];
    const [one, two] = [
      await verifyTicket(a, verifyOptions()),
      await verifyTicket(b, verifyOptions())
    ];
    expect(one.jti).not.toBe(two.jti);
  });

  it("lives sixty seconds and not a minute more", async () => {
    const ticket = await mint();
    /* Decision 3 property 2. Leeway is five seconds here rather than the sixty
       google.ts allows Google, so the window this asserts is genuinely small. */
    await expect(
      verifyTicket(ticket, { ...verifyOptions(), now: NOW + 64_000 })
    ).resolves.toBeTruthy();
    await expect(
      verifyTicket(ticket, { ...verifyOptions(), now: NOW + 66_000 })
    ).rejects.toThrow(/expired/);
  });
});

describe("the ticket refuses", () => {
  it("one minted for a different site — property 1", async () => {
    const forShade = await mint({ audience: "https://shade-site.vercel.app" });
    await expect(verifyTicket(forShade, verifyOptions())).rejects.toThrow(
      /addressed to a different site/
    );
  });

  it("one from an issuer this site was not told about", async () => {
    const elsewhere = await mint({ issuer: "https://not-sk.example" });
    await expect(verifyTicket(elsewhere, verifyOptions())).rejects.toThrow(/unexpected iss/);
  });

  it("one signed with somebody else's key", async () => {
    const forged = await signTicket({
      privateKey: EVIL_PEM,
      issuer: AUTH,
      audience: SITE,
      identity: IDENTITY,
      now: NOW
    });
    /* The forged key has a different thumbprint, so this is refused at the
       lookup rather than at the signature — which is the same answer by a
       cheaper route, and worth asserting so a future kid scheme cannot make
       this test silently stop testing forgery. */
    await expect(verifyTicket(forged, verifyOptions())).rejects.toThrow(/no key at/);
  });

  it("one whose payload was edited after signing", async () => {
    const ticket = await mint();
    const [header, payload, signature] = ticket.split(".");
    const claims = JSON.parse(Buffer.from(payload as string, "base64url").toString());
    claims.email = "attacker@example.com";
    const tampered = [
      header,
      Buffer.from(JSON.stringify(claims)).toString("base64url"),
      signature
    ].join(".");
    await expect(verifyTicket(tampered, verifyOptions())).rejects.toThrow(
      /signature does not verify/
    );
  });

  it("an unsigned token that names alg none", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: "x" })).toString(
      "base64url"
    );
    const payload = Buffer.from(
      JSON.stringify({ iss: AUTH, aud: SITE, sub: "1", email: "a@b.c", jti: "j", exp: 9e9 })
    ).toString("base64url");
    await expect(verifyTicket(`${header}.${payload}.`, verifyOptions())).rejects.toThrow(
      /unexpected alg/
    );
  });

  it("one whose header names HS256, so the public key cannot be used as a secret", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "x" })).toString(
      "base64url"
    );
    await expect(verifyTicket(`${header}.e30.x`, verifyOptions())).rejects.toThrow(
      /unexpected alg/
    );
  });

  it("one with no kid at all", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    await expect(verifyTicket(`${header}.e30.x`, verifyOptions())).rejects.toThrow(/no kid/);
  });

  it("anything that is not a three-part JWT", async () => {
    await expect(verifyTicket("nonsense", verifyOptions())).rejects.toThrow(/three-part/);
  });

  it("one issued in the future, which is a clock fault or a forgery", async () => {
    const ticket = await mint({ now: NOW + 600_000 });
    await expect(verifyTicket(ticket, verifyOptions())).rejects.toThrow(/issued in the future/);
  });

  it("a well-signed ticket that carries no identity to assert", async () => {
    /* Signed by the real key, so this is the claims check and nothing else. */
    const ticket = await mint();
    const [header, , signature] = ticket.split(".");
    void header;
    void signature;
    const empty = await signEmpty();
    await expect(verifyTicket(empty, verifyOptions())).rejects.toThrow(/no sub|no email|no jti/);
  });
});

describe("the JWKS the auth origin publishes", () => {
  it("carries the public half, a kid, and none of the private material", async () => {
    const published = await ticketJwks(PEM);
    expect(published.keys).toHaveLength(1);
    const key = published.keys[0] as Record<string, unknown>;
    expect(key).toEqual({
      kty: "RSA",
      n: expect.any(String),
      e: expect.any(String),
      kid: expect.any(String),
      alg: "RS256",
      use: "sig"
    });
    /* Read the written object back rather than trusting the copy-by-name: the
       whole reason those three fields are copied out instead of the rest being
       deleted is that a deny-list here is one Web Crypto revision away from
       publishing a private key. */
    for (const secret of ["d", "p", "q", "dp", "dq", "qi"]) {
      expect(Object.keys(key)).not.toContain(secret);
    }
    expect(JSON.stringify(published)).not.toContain(
      (good.privateKey.export({ format: "jwk" }) as { d: string }).d
    );
  });

  it("derives the kid from the key, so both halves agree without being told", async () => {
    const published = await ticketJwks(PEM);
    expect((published.keys[0] as { kid: string }).kid).toBe(await ticketKid(PEM));
    /* RFC 7638 is a function of the key: a different key is a different kid,
       which is what makes a rotation self-describing. */
    expect(await ticketKid(EVIL_PEM)).not.toBe(await ticketKid(PEM));
  });

  it("refuses a PKCS#1 key by name rather than with a Web Crypto DataError", async () => {
    const pkcs1 = good.privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    await expect(ticketJwks(pkcs1)).rejects.toThrow(/PKCS#1.*openssl pkcs8/s);
  });

  it("follows a rotated key: the new kid is unknown, so one refetch resolves it", async () => {
    /* Cache the old issuer's keys first, then rotate underneath. */
    await verifyTicket(await mint(), verifyOptions());
    expect(fetches).toBe(1);

    servedPem = EVIL_PEM;
    const rotated = await signTicket({
      privateKey: EVIL_PEM,
      issuer: AUTH,
      audience: SITE,
      identity: IDENTITY,
      now: NOW
    });
    const claims = await verifyTicket(rotated, verifyOptions());
    expect(claims.identity.sub).toBe(IDENTITY.sub);
    expect(fetches).toBe(2);
  });
});

describe("the URLs a site derives from one variable", () => {
  it("puts the JWKS and the sign-in page on the auth origin", () => {
    expect(jwksUrl(AUTH)).toBe("https://sk.works/api/handoff?jwks=1");
    expect(handoffUrl(AUTH, { return: `${SITE}/api/auth`, state: "n1" })).toBe(
      "https://sk.works/api/handoff?return=https%3A%2F%2Fmosleh-clinic.vercel.app%2Fapi%2Fauth&state=n1"
    );
  });

  it("does not care whether whoever typed the variable left a trailing slash", async () => {
    expect(trimOrigin("https://sk.works/")).toBe(AUTH);
    expect(jwksUrl("https://sk.works/")).toBe(jwksUrl(AUTH));
    /* And a ticket minted against one spelling verifies against the other. */
    const ticket = await signTicket({
      privateKey: PEM,
      issuer: "https://sk.works/",
      audience: `${SITE}/`,
      identity: IDENTITY,
      now: NOW
    });
    await expect(verifyTicket(ticket, verifyOptions())).resolves.toBeTruthy();
  });

  it("carries the owner's language when the site knows it", () => {
    expect(handoffUrl(AUTH, { return: "https://x.test/api/auth", state: "n", lang: "fa" })).toContain(
      "lang=fa"
    );
  });
});

/** A ticket signed by the real key whose claims are empty — the one way to
    reach the claim checks without the signature check answering first. */
async function signEmpty(): Promise<string> {
  const kid = await ticketKid(PEM);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString(
    "base64url"
  );
  const payload = Buffer.from(JSON.stringify({ iss: AUTH, aud: SITE, exp: NOW / 1000 + 60 })).toString(
    "base64url"
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    good.privateKey.export({ type: "pkcs8", format: "der" }),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${Buffer.from(new Uint8Array(signature)).toString("base64url")}`;
}
