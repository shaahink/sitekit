/* The issuer — the half the auth origin mounts.
   ---------------------------------------------------------------------------
   `verifyIdToken` is mocked, and only it: Google's own verification has its own
   file of tests and re-proving it here would mean serving a fake JWKS to prove
   something about a fleet allowlist. Everything downstream of "Google said this
   is who they are" is the real code.

   The check this file exists for is Decision 3 property 4. Without a fleet
   allowlist on `return`, this route is an open redirector *that signs what it
   hands over*, which is worse than an ordinary one by exactly the value of the
   signature. */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

vi.mock("../src/cms/google.js", () => ({
  verifyIdToken: vi.fn()
}));

import { verifyIdToken } from "../src/cms/google.js";
import { allowedReturn, createHandoffHandler, requestOrigin } from "../src/cms/handoff.js";
import { clearTicketKeyCache, ticketJwks, verifyTicket } from "../src/cms/ticket.js";
import { clearJwksCache } from "../src/internal/jwks.js";

const keypair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = keypair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

const AUTH_HOST = "sk.works";
const AUTH = `https://${AUTH_HOST}`;
const SITE = "https://mosleh-clinic.vercel.app";
const FLEET = `${SITE},https://shade-site.vercel.app,https://*-sheevajans-projects.vercel.app`;

const IDENTITY = {
  sub: "108134",
  email: "dr@example.com",
  name: "Dr Mosleh",
  picture: "https://lh3.googleusercontent.com/a/x"
};

const env = () => ({
  googleClientId: "1234.apps.googleusercontent.com",
  ticketPrivateKey: PEM,
  fleetOrigins: FLEET
});

const handler = () => createHandoffHandler({ env: env() });

function get(query: string, headers: Record<string, string> = {}): Request {
  return new Request(`${AUTH}/api/handoff${query}`, { headers: { host: AUTH_HOST, ...headers } });
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${AUTH}/api/handoff`, {
    method: "POST",
    headers: {
      host: AUTH_HOST,
      origin: AUTH,
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  clearJwksCache();
  clearTicketKeyCache();
  vi.mocked(verifyIdToken).mockReset();
  vi.mocked(verifyIdToken).mockResolvedValue(IDENTITY);
});

describe("the public routes a site and a browser both use", () => {
  it("publishes the JWKS, cacheable and readable from anywhere", async () => {
    const response = await handler().GET(get("?jwks=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(await response.json()).toEqual(await ticketJwks(PEM));
  });

  it("says it cannot issue rather than publishing an empty key set", async () => {
    const bare = createHandoffHandler({ env: { googleClientId: "x" } });
    const response = await bare.GET(get("?jwks=1"));
    expect(response.status).toBe(503);
    /* Still open: a site fetching this needs to read the refusal, not a CORS
       error that looks like the origin being down. */
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers a liveness ping, which is how the editor knows to say it is down", async () => {
    const response = await handler().GET(get("?ping=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({ ok: true, issuing: true });
  });

  it("pings honestly when it is up but cannot issue", async () => {
    const bare = createHandoffHandler({ env: { googleClientId: "x" } });
    expect(await (await bare.GET(get("?ping=1"))).json()).toEqual({ ok: true, issuing: false });
  });
});

describe("the sign-in page", () => {
  it("renders Google's button for a site in the fleet", async () => {
    const response = await handler().GET(
      get(`?return=${encodeURIComponent(`${SITE}/api/auth`)}&state=n1`)
    );
    const html = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("accounts.google.com/gsi/client");
    expect(html).toContain("1234.apps.googleusercontent.com");
  });

  it("tells somebody who arrived here directly what this page is", async () => {
    const html = await (await handler().GET(get(""))).text();
    expect(html).toContain("Open your own site's editor");
    /* And offers no button: there is nowhere to hand a ticket to. */
    expect(html).not.toContain("gsi/client");
  });

  it("refuses a return outside the fleet without rendering a button for it", async () => {
    const html = await (
      await handler().GET(get(`?return=${encodeURIComponent("https://evil.example/steal")}&state=n1`))
    ).text();
    expect(html).toContain("isn't one this sign-in looks after");
    expect(html).not.toContain("gsi/client");
    expect(html).not.toContain("evil.example");
  });

  it("says so in words when the origin is not set up to issue", async () => {
    const bare = createHandoffHandler({ env: {} });
    const html = await (await bare.GET(get("?return=x&state=y"))).text();
    expect(html).toContain("Nothing is wrong with your site");
  });

  it("carries a CSP that lets Google's button work and nothing else in", async () => {
    const response = await handler().GET(
      get(`?return=${encodeURIComponent(`${SITE}/api/auth`)}&state=n1`)
    );
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9]+' https:\/\/accounts\.google\.com\/gsi\/client/);
    /* Never in script-src: a nonce beside it would make it spec-ignored, and
       without the nonce it would admit any injected script. */
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    /* And `style-src` carries it with NO hash or nonce beside it, deliberately
       — Google injects its own <style> and would be blocked otherwise. */
    expect(csp).toMatch(/style-src 'unsafe-inline' https:\/\/accounts\.google\.com\/gsi\/style/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the nonce it declared, and a different one each time", async () => {
    const first = await handler().GET(get(`?return=${encodeURIComponent(`${SITE}/api/auth`)}&state=n1`));
    const html = await first.text();
    const nonce = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(
      first.headers.get("content-security-policy") ?? ""
    )?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`nonce="${nonce}"`);

    const second = await handler().GET(get(`?return=${encodeURIComponent(`${SITE}/api/auth`)}&state=n1`));
    expect(second.headers.get("content-security-policy")).not.toContain(nonce as string);
  });

  it("cannot be closed out of its own script tag by a crafted state", async () => {
    /* `state` is opaque to this origin by design — it belongs to the site, and
       this route only echoes it. Opaque and unescaped would be a script tag. */
    const nasty = "</script><script>alert(1)</script>";
    const html = await (
      await handler().GET(
        get(`?return=${encodeURIComponent(`${SITE}/api/auth`)}&state=${encodeURIComponent(nasty)}`)
      )
    ).text();
    expect(html).not.toContain("</script><script>alert");
    expect(html).toContain("\\u003c/script");
  });

  it("speaks the language the site said its owner reads", async () => {
    const fa = await handler().GET(
      get(`?return=${encodeURIComponent(`${SITE}/api/auth`)}&state=n1&lang=fa`)
    );
    const html = await fa.text();
    expect(html).toContain('lang="fa"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("وارد شو");
  });

  it("falls back to Accept-Language for somebody who arrived without one", async () => {
    const html = await (
      await handler().GET(get("", { "accept-language": "fr-CA,fr;q=0.9" }))
    ).text();
    expect(html).toContain('lang="fr"');
  });
});

describe("minting a ticket", () => {
  it("hands back a redirect carrying a ticket this site can verify", async () => {
    const response = await handler().POST(
      post({ credential: "google.id.token", return: `${SITE}/api/auth`, state: "n1" })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { redirect: string };

    const back = new URL(body.redirect);
    expect(back.origin).toBe(SITE);
    expect(back.pathname).toBe("/api/auth");
    expect(back.searchParams.get("state")).toBe("n1");

    const claims = await verifyTicket(back.searchParams.get("ticket") as string, {
      issuer: AUTH,
      audience: SITE,
      fetchImpl: servingJwks()
    });
    expect(claims.identity).toEqual(IDENTITY);
  });

  it("addresses the ticket to the site that asked and to no other", async () => {
    const response = await handler().POST(
      post({ credential: "t", return: `${SITE}/api/auth`, state: "n1" })
    );
    const { redirect } = (await response.json()) as { redirect: string };
    const ticket = new URL(redirect).searchParams.get("ticket") as string;
    await expect(
      verifyTicket(ticket, {
        issuer: AUTH,
        audience: "https://shade-site.vercel.app",
        fetchImpl: servingJwks()
      })
    ).rejects.toThrow(/addressed to a different site/);
  });

  it("names itself as the request reached it, not as a configured string", async () => {
    /* Behind a proxy `request.url` is an internal http URL, and an `iss` of
       `http://…` matches no site's CMS_AUTH_ORIGIN. */
    const request = new Request("http://internal.local/api/handoff", {
      method: "POST",
      headers: {
        /* The platform hands the function an internal http URL while `host`
           and the forwarded headers still name what the browser asked for. */
        host: "preview.example",
        origin: "https://preview.example",
        "x-forwarded-host": "preview.example",
        "x-forwarded-proto": "https",
        "content-type": "application/json"
      },
      body: JSON.stringify({ credential: "t", return: `${SITE}/api/auth`, state: "n1" })
    });
    const { redirect } = (await (await handler().POST(request)).json()) as { redirect: string };
    const ticket = new URL(redirect).searchParams.get("ticket") as string;
    await expect(
      verifyTicket(ticket, {
        issuer: "https://preview.example",
        audience: SITE,
        fetchImpl: servingJwks()
      })
    ).resolves.toBeTruthy();
  });

  it("mints for a stranger, because a ticket is who you are and not what you may do", async () => {
    vi.mocked(verifyIdToken).mockResolvedValue({
      sub: "999",
      email: "stranger@example.com",
      name: "A Stranger",
      picture: ""
    });
    const response = await handler().POST(
      post({ credential: "t", return: `${SITE}/api/auth`, state: "n1" })
    );
    /* Decision 4: the site's own allowlist refuses this one step later, and
       cms-auth-handoff proves that it does. */
    expect(response.status).toBe(200);
  });
});

describe("minting refuses", () => {
  it("a POST from another origin", async () => {
    const response = await handler().POST(
      post({ credential: "t", return: `${SITE}/api/auth`, state: "n1" }, { origin: "https://evil.example" })
    );
    expect(response.status).toBe(403);
  });

  it("a POST with no Origin header at all", async () => {
    const request = new Request(`${AUTH}/api/handoff`, {
      method: "POST",
      headers: { host: AUTH_HOST, "content-type": "application/json" },
      body: JSON.stringify({ credential: "t", return: `${SITE}/api/auth`, state: "n1" })
    });
    expect((await handler().POST(request)).status).toBe(403);
  });

  it("a body that is not JSON", async () => {
    const request = new Request(`${AUTH}/api/handoff`, {
      method: "POST",
      headers: { host: AUTH_HOST, origin: AUTH, "content-type": "application/json" },
      body: "{"
    });
    expect((await handler().POST(request)).status).toBe(400);
  });

  it("a request with no credential", async () => {
    expect((await handler().POST(post({ return: `${SITE}/api/auth`, state: "n" }))).status).toBe(400);
  });

  it("a request with nothing to hand back to", async () => {
    expect((await handler().POST(post({ credential: "t" }))).status).toBe(400);
  });

  it("a return outside the fleet — property 4", async () => {
    const response = await handler().POST(
      post({ credential: "t", return: "https://evil.example/api/auth", state: "n1" })
    );
    expect(response.status).toBe(403);
    /* And it never asked Google who this was: a refused return costs nothing
       upstream. */
    expect(vi.mocked(verifyIdToken)).not.toHaveBeenCalled();
  });

  it("a credential Google will not stand behind", async () => {
    vi.mocked(verifyIdToken).mockRejectedValue(new Error("signature does not verify"));
    const response = await handler().POST(
      post({ credential: "forged", return: `${SITE}/api/auth`, state: "n1" })
    );
    expect(response.status).toBe(401);
  });

  it("everything, when the origin has no key to sign with", async () => {
    const bare = createHandoffHandler({ env: { googleClientId: "x", fleetOrigins: FLEET } });
    const response = await bare.POST(
      post({ credential: "t", return: `${SITE}/api/auth`, state: "n1" })
    );
    expect(response.status).toBe(503);
  });
});

describe("the fleet allowlist", () => {
  it("matches an origin exactly, like Google's own", () => {
    expect(allowedReturn(`${SITE}/api/auth`, FLEET)?.origin).toBe(SITE);
    expect(allowedReturn("https://mosleh-clinic.vercel.app.evil.test/x", FLEET)).toBeNull();
    expect(allowedReturn("https://sub.mosleh-clinic.vercel.app/x", FLEET)).toBeNull();
  });

  it("refuses http, because the ticket becomes a Secure cookie", () => {
    expect(allowedReturn("http://mosleh-clinic.vercel.app/api/auth", FLEET)).toBeNull();
  });

  it("refuses everything when no fleet is configured", () => {
    expect(allowedReturn(`${SITE}/api/auth`, undefined)).toBeNull();
    expect(allowedReturn(`${SITE}/api/auth`, "")).toBeNull();
  });

  it("refuses anything that is not a URL", () => {
    expect(allowedReturn("not a url", FLEET)).toBeNull();
    expect(allowedReturn("javascript:alert(1)", FLEET)).toBeNull();
  });

  it("admits a preview deployment through the one wildcard, and nothing wider", () => {
    /* The write proof needs an origin nobody can write down in advance. */
    expect(
      allowedReturn("https://sk-studio-abc123-sheevajans-projects.vercel.app/api/auth", FLEET)
    ).toBeTruthy();
    /* The `*` may not cross a label: another team's project, or somebody
       else's host that merely ends the same way, stays out. */
    expect(
      allowedReturn("https://evil.attacker.test-sheevajans-projects.vercel.app/x", FLEET)
    ).toBeNull();
    expect(allowedReturn("https://sheevajans-projects.vercel.app/x", FLEET)).toBeNull();
    expect(allowedReturn("https://evil.example/-sheevajans-projects.vercel.app", FLEET)).toBeNull();
  });

  it("refuses a wildcard that would match a whole suffix", () => {
    expect(allowedReturn("https://anything.vercel.app/x", "https://*.vercel.app")).toBeNull();
    expect(allowedReturn("https://x.test/a", "https://*")).toBeNull();
    expect(allowedReturn("https://x.test/a", "*")).toBeNull();
  });
});

describe("requestOrigin", () => {
  it("prefers what the browser asked for over what the platform passed in", () => {
    const request = new Request("http://internal/api/handoff", {
      headers: { host: "internal", "x-forwarded-host": "sk.works", "x-forwarded-proto": "https" }
    });
    expect(requestOrigin(request)).toBe("https://sk.works");
  });

  it("takes the first hop when a proxy chain appended to the header", () => {
    const request = new Request("http://internal/api/handoff", {
      headers: { host: "internal", "x-forwarded-host": "sk.works, inner", "x-forwarded-proto": "https,http" }
    });
    expect(requestOrigin(request)).toBe("https://sk.works");
  });
});

function servingJwks(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(await ticketJwks(PEM)), {
      headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch;
}
