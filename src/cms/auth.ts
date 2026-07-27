/* Sign in, sign out.
   ---------------------------------------------------------------------------
   POST   {credential}   a Google ID token in, a session cookie back
   DELETE                the cookie cleared

   This is the JS-callback half of Google Identity Services, not the redirect
   half: the rendered button hands the credential to our own script, which
   POSTs it here with `fetch`. That is why there is no `g_csrf_token` anywhere
   in this file — Google's CSRF cookie belongs to the redirect flow, where the
   browser form-POSTs to a `login_uri` we never set. Origin validation covers
   this shape, and no third-party cookie is involved.

   Every rejection returns the same message. Whether an account failed the
   signature check or simply isn't on the allowlist is not a stranger's
   business, and the server log keeps the real reason. */

import { sameHost } from "../feedback/guards.js";
import { json } from "../feedback/http.js";
import { allows } from "./allowlist.js";
import { verifyIdToken } from "./google.js";
import { clearSession, issueSession } from "./session.js";
import type { CmsEnv } from "./types.js";

export interface AuthHandler {
  POST(request: Request): Promise<Response>;
  DELETE(request?: Request): Promise<Response>;
}

export interface AuthHandlerOptions {
  env: CmsEnv | (() => CmsEnv);
  /** How long a sign-in lasts, in seconds. An hour by default. */
  sessionMaxAge?: number;
}

export function createAuthHandler(options: AuthHandlerOptions): AuthHandler {
  const resolveEnv: () => CmsEnv =
    typeof options.env === "function" ? options.env : () => options.env as CmsEnv;

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

  return { POST, DELETE };
}

function withCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}
