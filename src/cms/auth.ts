/* Sign in, sign out.
   ---------------------------------------------------------------------------
   GET                        what the page needs to render a way in
   GET  ?handoff=1&to=…       start the fleet hand-off (session 22)
   GET  ?ticket=…&state=…     come back from it, with a session
   POST {credential}          a Google ID token in, a session cookie back
   DELETE                     the cookie cleared

   The POST half is the JS-callback half of Google Identity Services, not the
   redirect half: the rendered button hands the credential to our own script,
   which POSTs it here with `fetch`. That is why there is no `g_csrf_token`
   anywhere in this file — Google's CSRF cookie belongs to the redirect flow,
   where the browser form-POSTs to a `login_uri` we never set. Origin validation
   covers this shape, and no third-party cookie is involved.

   **The two GET shapes added at 0.19.0 are the whole of a site's share of the
   fleet hand-off.** They ride the route that already exists rather than adding
   `/api/auth/callback`, and that is a design constraint rather than a
   convenience: session 22's promise is that a new site costs one environment
   variable, and a second route file per site would be six edits and a seventh
   for every site after. Everything downstream of the ticket — `allows()`,
   `issueSession()`, the cookie — is untouched, which is what keeps this a small
   diff in a well-proven file. The ticket's only job is to arrive at the
   allowlist with the same `identity` a verified Google ID token produces.

   Every rejection returns the same message. Whether an account failed the
   signature check or simply isn't on the allowlist is not a stranger's
   business, and the server log keeps the real reason. */

import { safeEqual, sameHost } from "../feedback/guards.js";
import { json } from "../feedback/http.js";
import { base64UrlDecode, base64UrlEncode } from "../internal/base64url.js";
import { allows } from "./allowlist.js";
import { verifyIdToken } from "./google.js";
import { requestOrigin } from "./handoff.js";
import { clearSession, issueSession } from "./session.js";
import { handoffUrl, jwksUrl, randomToken, trimOrigin, verifyTicket } from "./ticket.js";
import type { CmsEnv } from "./types.js";

export interface AuthHandler {
  GET(request?: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
  DELETE(request?: Request): Promise<Response>;
}

export interface AuthHandlerOptions {
  env: CmsEnv | (() => CmsEnv);
  /** How long a sign-in lasts, in seconds. An hour by default. */
  sessionMaxAge?: number;
}

/** The cookie that binds a hand-off to the browser that started it.

    Decision 3 property 5: the callback is a GET, and a GET is a request an
    attacker can make a browser perform. Without this, anyone holding a ticket
    could drive a victim's browser through the callback and sign them in as
    somebody else. `SameSite=Lax` is required rather than merely convenient —
    the callback is a top-level cross-site navigation, exactly what `Lax`
    permits and `Strict` would break. */
const STATE_COOKIE = "sk_auth_state";

/** Five minutes. Long enough to read a consent screen and pick an account,
    short enough that a tab left open overnight starts again rather than
    completing a hand-off nobody remembers beginning. */
const STATE_MAX_AGE = 300;

/** Where an owner lands if a site never says. Every site in this fleet serves
    the editor at `/edit` or at `/edit.html` and the kit cannot know which
    (bug #35), so this is only ever the fallback for a request that arrived
    without a `to` — the editor always sends one. */
const DEFAULT_RETURN_PATH = "/edit";

export function createAuthHandler(options: AuthHandlerOptions): AuthHandler {
  const resolveEnv: () => CmsEnv =
    typeof options.env === "function" ? options.env : () => options.env as CmsEnv;

  /* The client ID is public by design — in Google's own examples it sits in
     the page's HTML. Serving it from here rather than baking it into the build
     means setting it takes an environment variable and a redeploy, not a code
     change, and the page can say "not configured yet" instead of rendering a
     button that cannot work. */
  async function GET(request?: Request): Promise<Response> {
    const env = resolveEnv();
    const url = request ? new URL(request.url) : null;

    if (request && url?.searchParams.has("ticket")) return callback(request, url, env);
    if (request && url?.searchParams.has("handoff")) return start(request, url, env);

    /* `paths` rather than `configured` alone, and Decision 5 is why: a site
       whose own origin was never registered with Google has a client ID that
       renders an empty rectangle, so `configured: true` was telling the editor
       something true and useless. What the editor needs to know is which ways
       in exist. `configured` stays, and stays honest — at least one path. */
    const usable = Boolean(env.sessionSecret && env.allowlist);
    const paths: string[] = [];
    /* Hand-off first, deliberately. A site cannot know whether its own origin
       is registered without asking Google, so the path that always works leads
       and the direct button is the fallback. */
    if (usable && env.authOrigin) paths.push("handoff");
    if (usable && env.googleClientId) paths.push("google");

    return json({
      ok: true,
      configured: paths.length > 0,
      paths,
      ...(env.googleClientId ? { clientId: env.googleClientId } : {}),
      ...(env.authOrigin ? { authOrigin: trimOrigin(env.authOrigin) } : {})
    });
  }

  /** Step 2 and 3 of Decision 2: set the state cookie, then send the owner to
      the one origin Google knows about. */
  async function start(request: Request, url: URL, env: CmsEnv): Promise<Response> {
    if (!env.authOrigin || !env.sessionSecret) {
      return json({ ok: false, error: "Sign-in is not configured yet." }, 503);
    }

    const to = sitePath(url.searchParams.get("to"));
    const state = randomToken();
    const lang = url.searchParams.get("lang");

    /* Decision 5's failure that must not be silent, asked here rather than in
       the browser. Two reasons it belongs on this side. The editor page's CSP
       declares `connect-src 'self' https://accounts.google.com` — a browser
       asking the auth origin anything would be blocked on every site in the
       fleet, and only in production, where nothing tests it. And the thing
       worth asking about is not whether that host answers but whether it can
       still publish the keys this site is about to need, which is the same
       fetch the callback makes.

       It costs one cacheable request in front of a full page navigation to
       Google. What it buys is that an owner whose sign-in origin is down reads
       a sentence on their own site instead of somebody else's error page. */
    if (!(await issuerAnswering(env.authOrigin))) {
      console.error(`cms: ${trimOrigin(env.authOrigin)} is not answering`);
      return fail(to, "down");
    }

    /* `return` is this route's own URL, read from the request rather than
       written down: the kit does not get to assume a site mounts it at
       `/api/auth`, and the auth origin checks whatever it is handed against
       the fleet allowlist anyway. */
    const back = `${requestOrigin(request)}${url.pathname}`;
    const destination = handoffUrl(env.authOrigin, {
      return: back,
      state,
      ...(lang ? { lang } : {})
    });

    return redirect(destination, [stateCookie(`${state}.${base64UrlEncode(bytes(to))}`, STATE_MAX_AGE)]);
  }

  /** Step 7 to 10: verify, then hand the identity to code that has not
      changed. Every refusal here logs its reason and shows the owner one
      sentence on their own site, in their own language — the editor reads
      `?sk_auth=` and says it. Landing them back where they started beats a
      JSON body on an origin they did not mean to visit. */
  async function callback(request: Request, url: URL, env: CmsEnv): Promise<Response> {
    if (!env.authOrigin || !env.sessionSecret) {
      return json({ ok: false, error: "Sign-in is not configured yet." }, 503);
    }

    const carried = readStateCookie(request.headers.get("cookie"));
    /* No cookie means this callback was not started by this browser — a link
       somebody was sent, or a hand-off that lapsed. There is no `to` to return
       anyone to and no owner to apologise to, so it stops here. */
    if (!carried) {
      console.error("cms: hand-off callback with no state cookie");
      return json({ ok: false, error: "That sign-in didn't work." }, 400);
    }

    const state = url.searchParams.get("state") ?? "";
    if (!state || !safeEqual(state, carried.state)) {
      console.error("cms: hand-off state does not match");
      return fail(carried.to, "failed");
    }

    let claims;
    try {
      claims = await verifyTicket(url.searchParams.get("ticket") as string, {
        issuer: env.authOrigin,
        /* Property 1: a ticket minted for another site does not verify here,
           whatever else is true of it. */
        audience: requestOrigin(request)
      });
    } catch (error) {
      console.error("cms: ticket rejected:", (error as Error).message);
      return fail(carried.to, "failed");
    }

    if (!allows(env.allowlist, claims.identity)) {
      console.error(`cms: ${claims.identity.email} is not on the allowlist`);
      return fail(carried.to, "denied");
    }

    const cookie = await issueSession(claims.identity, {
      secret: env.sessionSecret,
      ...(options.sessionMaxAge !== undefined ? { maxAgeSeconds: options.sessionMaxAge } : {})
    });
    /* The state cookie is cleared on the way through, which is also what makes
       a replayed ticket fail: `jti` alone cannot, because this kit has no store
       to remember one in and says so in Decision 3. */
    return redirect(carried.to, [cookie, stateCookie("", 0)]);
  }

  function fail(to: string, reason: "failed" | "denied" | "down"): Response {
    const target = new URL(to, "https://site.invalid");
    target.searchParams.set("sk_auth", reason);
    return redirect(`${target.pathname}${target.search}`, [stateCookie("", 0)]);
  }

  async function POST(request: Request): Promise<Response> {
    const env = resolveEnv();
    if (!env.googleClientId || !env.sessionSecret) {
      return json({ ok: false, error: "Sign-in is not configured yet." }, 503);
    }

    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (!origin || !sameHost(origin, host, env.allowedOrigin)) {
      return json({ ok: false, error: "Bad origin." }, 403);
    }

    let credential: string;
    try {
      const payload = (await request.json()) as { credential?: unknown };
      credential = typeof payload.credential === "string" ? payload.credential : "";
    } catch {
      return json({ ok: false, error: "Malformed request." }, 400);
    }
    if (!credential) return json({ ok: false, error: "No credential." }, 400);

    let identity;
    try {
      identity = await verifyIdToken(credential, { clientId: env.googleClientId });
    } catch (error) {
      console.error("cms: token rejected:", (error as Error).message);
      return json({ ok: false, error: "That sign-in didn't work." }, 401);
    }

    if (!allows(env.allowlist, identity)) {
      console.error(`cms: ${identity.email} is not on the allowlist`);
      return json({ ok: false, error: "That account can't edit this site." }, 403);
    }

    const cookie = await issueSession(identity, {
      secret: env.sessionSecret,
      ...(options.sessionMaxAge !== undefined ? { maxAgeSeconds: options.sessionMaxAge } : {})
    });
    return withCookie(
      json({ ok: true, email: identity.email, name: identity.name, picture: identity.picture }),
      cookie
    );
  }

  async function DELETE(): Promise<Response> {
    return withCookie(json({ ok: true }), clearSession());
  }

  return { GET, POST, DELETE };
}

function withCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  /* 303 rather than 302: this is a GET that produced a result, and 303 says
     "go and GET that" without any browser inventing a method. */
  return new Response(null, { status: 303, headers });
}

function stateCookie(value: string, maxAge: number): string {
  return `${STATE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Path=/`;
}

function readStateCookie(header: string | null): { state: string; to: string } | null {
  const raw = cookieValue(header, STATE_COOKIE);
  if (!raw) return null;
  const split = raw.indexOf(".");
  if (split < 1) return null;
  const state = raw.slice(0, split);
  let to: string;
  try {
    to = new TextDecoder().decode(base64UrlDecode(raw.slice(split + 1)));
  } catch {
    return null;
  }
  /* Validated on the way out as well as on the way in. The path came from a
     query parameter originally, and a value that was checked once, stored, and
     trusted afterwards is how a cookie becomes an open redirect. */
  return { state, to: sitePath(to) };
}

/** A path on this site, or the default.

    Anything that could leave the site is refused rather than repaired: a
    leading `//` or a `\` is a protocol-relative URL to somewhere else, and
    browsers disagree about which. This is the only value in the hand-off that
    an owner's own browser supplies, so it is the only one that could turn the
    callback into a redirector. */
function sitePath(value: string | null): string {
  if (!value || !value.startsWith("/")) return DEFAULT_RETURN_PATH;
  if (value.startsWith("//") || value.includes("\\")) return DEFAULT_RETURN_PATH;
  if (/[ -]/.test(value)) return DEFAULT_RETURN_PATH;
  return value;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Whether the auth origin can still publish the keys this site will need.

    The JWKS and not a bare liveness route, deliberately: an origin that answers
    but has lost its signing key would pass a ping and then hand back a ticket
    nobody can verify, which is the failure mode Decision 5 is about wearing a
    green light. Deadlined by `internal/jwks.ts`, which is where every other
    call on this path is deadlined. */
async function issuerAnswering(authOrigin: string): Promise<boolean> {
  try {
    const response = await fetch(jwksUrl(authOrigin));
    if (!response.ok) return false;
    const body = (await response.json()) as { keys?: unknown[] };
    return Array.isArray(body.keys) && body.keys.length > 0;
  } catch {
    return false;
  }
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
