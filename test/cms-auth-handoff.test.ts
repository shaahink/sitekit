/* The verifier — a site's whole share of the fleet hand-off.
   ---------------------------------------------------------------------------
   Everything here goes through `createAuthHandler`'s existing GET, because that
   is the design: session 22 promises a new site costs one environment variable,
   and a second route file per site would be six edits now and a seventh for
   every site after.

   `fetch` is stubbed globally rather than injected, deliberately. There is no
   `fetchImpl` seam on this path in production and adding one for a test would
   be proving a code path nobody runs — the JWKS really is fetched by the same
   `internal/jwks.ts` an owner's sign-in uses.

   Decision 3 property 5 lives here and nowhere else: `state` is not in the
   ticket, it is a cookie the site set before it redirected, and the whole
   session-fixation story is about this file. */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createAuthHandler } from "../src/cms/auth.js";
import { readSession } from "../src/cms/session.js";
import { clearTicketKeyCache, signTicket, ticketJwks } from "../src/cms/ticket.js";
import { clearJwksCache } from "../src/internal/jwks.js";

const keypair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = keypair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const OTHER_PEM = other.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

const HOST = "mosleh-clinic.vercel.app";
const SITE = `https://${HOST}`;
const AUTH = "https://sk.works";
const SECRET = "a-session-secret";

const OWNER = {
  sub: "108134",
  email: "dr@example.com",
  name: "Dr Mosleh",
  picture: "https://lh3.googleusercontent.com/a/x"
};
const STRANGER = { sub: "999", email: "stranger@example.com", name: "A Stranger", picture: "" };

const env = (overrides: Record<string, unknown> = {}) => ({
  googleClientId: "1234.apps.googleusercontent.com",
  allowlist: OWNER.email,
  sessionSecret: SECRET,
  authOrigin: AUTH,
  ...overrides
});

const handler = (overrides: Record<string, unknown> = {}) =>
  createAuthHandler({ env: env(overrides) });

function req(path: string, cookie?: string): Request {
  return new Request(`${SITE}${path}`, {
    headers: { host: HOST, ...(cookie ? { cookie } : {}) }
  });
}

const mint = (overrides: Record<string, unknown> = {}) =>
  signTicket({ privateKey: PEM, issuer: AUTH, audience: SITE, identity: OWNER, ...overrides });

/** The `Set-Cookie` values a response carries, by name. */
function cookies(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of response.headers.getSetCookie()) {
    const eq = raw.indexOf("=");
    out[raw.slice(0, eq)] = raw;
  }
  return out;
}

/** Reproduce what a browser would send back after a `Set-Cookie`. */
function cookieHeaderFrom(response: Response, name: string): string {
  const raw = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "";
  return raw.split(";")[0] as string;
}

beforeEach(() => {
  clearJwksCache();
  clearTicketKeyCache();
  vi.stubGlobal("fetch", (async () =>
    new Response(JSON.stringify(await ticketJwks(PEM)), {
      headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the editor is told", () => {
  it("names the hand-off first, because it is the path that always works", async () => {
    const body = await (await handler().GET(req("/api/auth"))).json();
    expect(body).toEqual({
      ok: true,
      configured: true,
      paths: ["handoff", "google"],
      clientId: "1234.apps.googleusercontent.com",
      authOrigin: AUTH
    });
  });

  it("offers only the hand-off on a site with no Google client of its own", async () => {
    const body = await (await handler({ googleClientId: undefined }).GET(req("/api/auth"))).json();
    expect(body.paths).toEqual(["handoff"]);
    expect(body.configured).toBe(true);
  });

  it("offers only Google where no auth origin was configured", async () => {
    const body = await (await handler({ authOrigin: undefined }).GET(req("/api/auth"))).json();
    expect(body.paths).toEqual(["google"]);
    expect(body.authOrigin).toBeUndefined();
  });

  it("reports no way in at all rather than one that cannot finish", async () => {
    /* An allowlist that admits nobody, or no secret to sign a session with,
       means every path ends in a refusal. Saying `configured: true` there is
       what put a confident card in front of Dr Mosleh with nothing behind it. */
    expect((await (await handler({ allowlist: undefined }).GET(req("/api/auth"))).json()).paths)
      .toEqual([]);
    expect(
      (await (await handler({ sessionSecret: undefined }).GET(req("/api/auth"))).json()).configured
    ).toBe(false);
  });

  it("trims a trailing slash somebody left on the variable", async () => {
    const body = await (await handler({ authOrigin: `${AUTH}/` }).GET(req("/api/auth"))).json();
    expect(body.authOrigin).toBe(AUTH);
  });

  it("still answers the callerless GET a route file may make", async () => {
    /* `export const GET = handler.GET` is what every site does, and a bare
       call has to keep working or a pin bump breaks six sites at once. */
    const body = await (await handler().GET()).json();
    expect(body.ok).toBe(true);
  });
});

describe("starting the hand-off", () => {
  it("sets the state cookie, then sends the owner to the one registered origin", async () => {
    const response = await handler().GET(req("/api/auth?handoff=1&to=%2Fedit.html&lang=fa"));
    expect(response.status).toBe(303);

    const destination = new URL(response.headers.get("location") as string);
    expect(destination.origin).toBe(AUTH);
    expect(destination.pathname).toBe("/api/handoff");
    expect(destination.searchParams.get("return")).toBe(`${SITE}/api/auth`);
    expect(destination.searchParams.get("lang")).toBe("fa");

    const cookie = cookies(response)["sk_auth_state"] as string;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    /* Lax is required, not convenient: the callback is a top-level cross-site
       navigation, which is exactly what Lax permits and Strict would break. */
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=300");
    const state = destination.searchParams.get("state") as string;
    expect(cookie.startsWith(`sk_auth_state=${state}.`)).toBe(true);
  });

  it("gives a different state every time, so one cannot be reused", async () => {
    const a = await handler().GET(req("/api/auth?handoff=1"));
    const b = await handler().GET(req("/api/auth?handoff=1"));
    expect(new URL(a.headers.get("location") as string).searchParams.get("state")).not.toBe(
      new URL(b.headers.get("location") as string).searchParams.get("state")
    );
  });

  it("never tells the auth origin where on the site the owner is going", async () => {
    const response = await handler().GET(req("/api/auth?handoff=1&to=%2Fedit.html%3Ffrom%3D%252F"));
    const destination = response.headers.get("location") as string;
    expect(destination).not.toContain("edit.html");
    /* It travels in the site's own cookie instead, which is also the only
       place it could travel and still be the site's business. */
    expect(cookies(response)["sk_auth_state"]).toBeTruthy();
  });

  it("refuses to carry a destination that would leave the site", async () => {
    for (const nasty of [
      "%2F%2Fevil.example",
      "https%3A%2F%2Fevil.example",
      "%5C%5Cevil.example",
      "evil.example"
    ]) {
      const response = await handler().GET(req(`/api/auth?handoff=1&to=${nasty}`));
      const carried = decodeURIComponent(
        Buffer.from(
          (cookieHeaderFrom(response, "sk_auth_state").split(".")[1] as string),
          "base64url"
        ).toString()
      );
      expect(carried).toBe("/edit");
    }
  });

  it("says so rather than redirecting nowhere when no auth origin is set", async () => {
    const response = await handler({ authOrigin: undefined }).GET(req("/api/auth?handoff=1"));
    expect(response.status).toBe(503);
  });

  it("checks the sign-in origin before sending anyone there, and asks it for keys", async () => {
    /* Decision 5's check, and it is the JWKS rather than a liveness route
       deliberately: an origin that answers but has lost its signing key would
       pass a ping and then hand back a ticket nobody can verify. */
    const asked: string[] = [];
    vi.stubGlobal("fetch", (async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify(await ticketJwks(PEM)), {
        headers: { "content-type": "application/json" }
      });
    }) as unknown as typeof fetch);

    const response = await handler().GET(req("/api/auth?handoff=1"));
    expect(response.status).toBe(303);
    expect(asked).toEqual([`${AUTH}/api/handoff?jwks=1`]);
  });

  it("sends the owner back to their own page when the sign-in origin is down", async () => {
    vi.stubGlobal("fetch", (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);

    const response = await handler().GET(req("/api/auth?handoff=1&to=%2Fedit.html"));
    expect(response.status).toBe(303);
    /* Not somebody else's error page, and not a JSON body on a host they did
       not mean to visit. Their own editor, with a sentence. */
    expect(response.headers.get("location")).toBe("/edit.html?sk_auth=down");
  });

  it("treats an origin that answers without keys as down, not as fine", async () => {
    vi.stubGlobal("fetch", (async () =>
      new Response(JSON.stringify({ ok: false, error: "no key" }), { status: 503 })) as unknown as typeof fetch);
    const response = await handler().GET(req("/api/auth?handoff=1"));
    expect(response.headers.get("location")).toContain("sk_auth=down");

    vi.stubGlobal("fetch", (async () =>
      new Response(JSON.stringify({ keys: [] }))) as unknown as typeof fetch);
    expect(
      (await handler().GET(req("/api/auth?handoff=1"))).headers.get("location")
    ).toContain("sk_auth=down");
  });
});

describe("coming back with a ticket", () => {
  /** A full round trip: start, mint against the state that was set, come back. */
  async function roundTrip(
    options: {
      ticket?: string;
      identity?: typeof OWNER;
      state?: string;
      to?: string;
      env?: Record<string, unknown>;
      dropCookie?: boolean;
    } = {}
  ) {
    const site = handler(options.env);
    const started = await site.GET(req(`/api/auth?handoff=1&to=${encodeURIComponent(options.to ?? "/edit")}`));
    const issued = new URL(started.headers.get("location") as string).searchParams.get(
      "state"
    ) as string;
    const cookie = cookieHeaderFrom(started, "sk_auth_state");

    const ticket =
      options.ticket ?? (await mint({ ...(options.identity ? { identity: options.identity } : {}) }));
    const state = options.state ?? issued;
    const back = await site.GET(
      req(
        `/api/auth?ticket=${encodeURIComponent(ticket)}&state=${encodeURIComponent(state)}`,
        options.dropCookie ? undefined : cookie
      )
    );
    return { back, issued };
  }

  it("signs the owner in and lands them where they started", async () => {
    const { back } = await roundTrip({ to: "/edit.html" });
    expect(back.status).toBe(303);
    expect(back.headers.get("location")).toBe("/edit.html");

    const session = cookies(back)["sk_cms"] as string;
    expect(session).toContain("HttpOnly");
    /* The identity that reaches `issueSession` is the same object a verified
       Google ID token produces — which is Decision 2's test of the design. */
    const read = await readSession(session.split(";")[0] as string, { secret: SECRET });
    expect(read?.sub).toBe(OWNER.sub);
    expect(read?.email).toBe(OWNER.email);
    expect(read?.name).toBe(OWNER.name);
  });

  it("clears the state cookie on the way through, which is what stops a replay", async () => {
    const { back } = await roundTrip();
    expect(cookies(back)["sk_auth_state"]).toContain("Max-Age=0");
  });

  it("refuses a ticket presented without the cookie that started the hand-off", async () => {
    /* Property 5, and the reason it exists: the callback is a GET, so an
       attacker can make a browser perform it. Without the cookie there is
       nothing tying this request to somebody who asked to sign in. */
    const { back } = await roundTrip({ dropCookie: true });
    expect(back.status).toBe(400);
    expect(cookies(back)["sk_cms"]).toBeUndefined();
  });

  it("refuses a state that does not match the cookie", async () => {
    const { back } = await roundTrip({ state: "somebody-elses-state" });
    expect(back.status).toBe(303);
    expect(back.headers.get("location")).toContain("sk_auth=failed");
    expect(cookies(back)["sk_cms"]).toBeUndefined();
  });

  it("refuses a ticket minted for a different site", async () => {
    const { back } = await roundTrip({
      ticket: await mint({ audience: "https://shade-site.vercel.app" })
    });
    expect(back.headers.get("location")).toContain("sk_auth=failed");
    expect(cookies(back)["sk_cms"]).toBeUndefined();
  });

  it("refuses a ticket from an issuer this site was not pointed at", async () => {
    const { back } = await roundTrip({ ticket: await mint({ issuer: "https://not-sk.example" }) });
    expect(back.headers.get("location")).toContain("sk_auth=failed");
  });

  it("refuses a ticket signed by a key the auth origin does not publish", async () => {
    const forged = await signTicket({
      privateKey: OTHER_PEM,
      issuer: AUTH,
      audience: SITE,
      identity: OWNER
    });
    const { back } = await roundTrip({ ticket: forged });
    expect(back.headers.get("location")).toContain("sk_auth=failed");
    expect(cookies(back)["sk_cms"]).toBeUndefined();
  });

  it("refuses one that expired while the tab sat open", async () => {
    const { back } = await roundTrip({ ticket: await mint({ now: Date.now() - 120_000 }) });
    expect(back.headers.get("location")).toContain("sk_auth=failed");
  });

  it("refuses a stranger, because the site's own allowlist still answers", async () => {
    /* Decision 4. The auth origin mints a ticket for anybody who signs in with
       Google — an assertion about who they are, not a grant — and this is the
       step that makes that safe. */
    const { back } = await roundTrip({ identity: STRANGER });
    expect(back.status).toBe(303);
    expect(back.headers.get("location")).toContain("sk_auth=denied");
    expect(cookies(back)["sk_cms"]).toBeUndefined();
  });

  it("refuses everybody where the site's allowlist is empty", async () => {
    const { back } = await roundTrip({ env: { allowlist: "" } });
    expect(back.headers.get("location")).toContain("sk_auth=denied");
  });

  it("sends the owner back to the same page it was told, error and all", async () => {
    const { back } = await roundTrip({ identity: STRANGER, to: "/edit.html?from=%2Fabout" });
    const location = back.headers.get("location") as string;
    expect(location.startsWith("/edit.html?")).toBe(true);
    expect(location).toContain("from=%2Fabout");
    expect(location).toContain("sk_auth=denied");
  });

  it("says it is unconfigured rather than verifying against nothing", async () => {
    const response = await handler({ authOrigin: undefined }).GET(
      req("/api/auth?ticket=x&state=y", "sk_auth_state=a.L2VkaXQ")
    );
    expect(response.status).toBe(503);
  });
});
