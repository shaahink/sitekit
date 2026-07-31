/* Unlocking an admin surface with this device — the edge.
   ---------------------------------------------------------------------------
   Lifted into the kit in 0.23.0 from the fleet console, which had it alone
   since 0.22.0. The reason to move it is the reason the "sites hold
   presentation" rule was scoped in the first place: an owner opening their own
   editor on their own phone met Google's account chooser every single time,
   and the fix already existed one repo away. Six hand-maintained copies of a
   WebAuthn verifier would have been the worst possible answer.

   What it is not. It is **not a second authority**. Enrolment requires a live
   `sk_cms` session, the identity written into the credential is taken from
   that session and never from anything the page says, and the session it hands
   back is minted by the same `issueSession` `/api/auth` uses — after `allows()`
   is checked again, at that moment, against this deployment's own
   `CMS_ALLOWLIST`. Take somebody off the list and their passkey stops opening
   the door on the next attempt. It removes a round trip; it grants nothing.

   **There is no database, and there was never going to be one.** The hard rule
   in CLAUDE.md rules out Vercel KV, Blob and Postgres, and a fleet that keeps
   its content in git was not about to grow a user table. So the credential
   record — the credential id, its public key, and the identity it stands for —
   rides a cookie this server signs with the session secret, which makes it:

   - **unforgeable**, because the client cannot produce the HMAC;
   - **device-bound**, because a cookie is, which is the exact promise the
     feature makes: *this device* can unlock this site;
   - **useless if stolen**, because the private half never leaves the phone's
     secure enclave, and the assertion is what is actually checked.

   That it costs **no new environment variable** is what made it portable at
   all: `CMS_SESSION_SECRET` is already set on all six fleet projects, a
   distinct value per site, because the editor's own session has needed it
   since session 8. Rotating one invalidates that site's enrolments along with
   its sessions, which is the same blunt instrument CMS.md already documents
   and the right one here too.

   Two things it deliberately does not do. It does not track a signature
   counter — that detects a cloned authenticator, and there is nowhere to keep
   one; platform authenticators overwhelmingly report zero anyway. And it does
   not ask for attestation: we are not deciding whether to trust the make of
   the device, we are recognising one this browser already proved it owned.

   Environment:
     CMS_ALLOWLIST        required  who may edit — re-checked on every unlock
     CMS_SESSION_SECRET   required  signs the session, and this credential
   ------------------------------------------------------------------------ */

import { safeEqual } from "../feedback/guards.js";
import { base64UrlDecode, base64UrlEncode } from "../internal/base64url.js";
import { allows } from "./allowlist.js";
import { issueSession, readSession } from "./session.js";
import type { CmsEnv } from "./types.js";

export interface PasskeyHandler {
  POST(request: Request): Promise<Response>;
}

export interface PasskeyHandlerOptions {
  env: CmsEnv | (() => CmsEnv);
  /** What the platform's own prompt calls this site — "Use your fingerprint
      for **Elfine**". Defaults to the host the request arrived on, which is
      always true and never pretty. */
  rpName?: string;
  /** Where this handler is mounted. Only the challenge cookie's `Path` needs
      it, and narrowing that cookie to the one route that reads it keeps it off
      every other request the browser makes. */
  path?: string;
  /** How long a sign-in lasts, in seconds. Passed straight through so an
      unlock and a Google sign-in expire alike. */
  sessionMaxAge?: number;
}

const CRED_COOKIE = "sk_pk";
const CHALLENGE_COOKIE = "sk_pkc";
/* Chrome caps a cookie at 400 days and silently truncates anything longer, so
   asking for more would quietly get less. A year is what this actually wants. */
const CRED_MAX_AGE = 365 * 24 * 60 * 60;
const CHALLENGE_MAX_AGE = 180;
const TIMEOUT_MS = 60_000;

/** Like the kit's `json`, plus cookies — which is the whole reason it is not
    the kit's `json`. Two of these responses set two cookies at once, and
    `Set-Cookie` is the one header a browser will not accept comma-joined; it
    has to be appended twice. */
function json(payload: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(payload), { status, headers });
}

const encoder = new TextEncoder();

/* ── Cookies ──────────────────────────────────────────────────────────── */

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

interface Credential {
  id: string;
  key: string;
  alg: number;
  sub: string;
  email: string;
  name: string;
  rp: string;
  at: number;
}

async function readCredential(request: Request, secret: string): Promise<Credential | null> {
  const raw = cookieValue(request.headers.get("cookie"), CRED_COOKIE);
  if (!raw) return null;
  const split = raw.lastIndexOf(".");
  if (split < 1) return null;
  const payload = raw.slice(0, split);
  if (!safeEqual(raw.slice(split + 1), await hmac(payload, secret))) return null;
  try {
    const held = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as Credential;
    return held?.id && held?.key && held?.sub ? held : null;
  } catch {
    return null;
  }
}

async function credentialCookie(credential: Credential, secret: string): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(credential)));
  const value = `${payload}.${await hmac(payload, secret)}`;
  return `${CRED_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Max-Age=${CRED_MAX_AGE}; Path=/`;
}

const clearCredential = () =>
  `${CRED_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;

/** The challenge, kept in a cookie rather than only in a token the page holds.
    -------------------------------------------------------------------------
    Nothing here can enforce single use without storage, so the replay window
    is the challenge's lifetime. Binding it to a cookie shrinks that to
    *replay in the same browser*, which is not an attack — the browser already
    has the session. A captured assertion is useless anywhere else. */
const challengeCookie = (purpose: string, challenge: string, path: string) =>
  `${CHALLENGE_COOKIE}=${purpose}.${challenge}; HttpOnly; Secure; SameSite=Lax; Max-Age=${CHALLENGE_MAX_AGE}; Path=${path}`;

const clearChallenge = (path: string) =>
  `${CHALLENGE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=${path}`;

/* ── Where we are ─────────────────────────────────────────────────────── */

/** The relying party is this origin, and it has to be derived rather than
    configured: a site answers on a `.vercel.app` name today and would answer
    on its own domain the day one lands, and a hard-coded rp id would make
    every enrolled device stop working without saying why.

    `x-forwarded-proto` rather than the request URL's scheme, because behind
    Vercel's proxy the latter is not reliably the one the browser used.
    Localhost is the exception WebAuthn itself makes, and the harness needs
    it. */
function relyingParty(request: Request) {
  const host = (request.headers.get("host") ?? "").split(":")[0] ?? "";
  const hostWithPort = request.headers.get("host") ?? host;
  const local = host === "localhost" || host === "127.0.0.1";
  const proto = request.headers.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return { id: host, origin: `${proto}://${hostWithPort}` };
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer));
}

/** What the browser signed over, unpacked far enough to be checked. Returns a
    reason rather than throwing, because every one of these is a refusal the
    caller should report identically. */
async function checkClientData(
  clientDataJSON: Uint8Array,
  expect: { type: string; challenge: string; origin: string }
): Promise<string | null> {
  let data: { type?: string; challenge?: string; origin?: string };
  try {
    data = JSON.parse(new TextDecoder().decode(clientDataJSON));
  } catch {
    return "unreadable client data";
  }
  if (data.type !== expect.type) return "wrong ceremony";
  if (!data.challenge || !safeEqual(data.challenge, expect.challenge)) return "stale challenge";
  if (data.origin !== expect.origin) return "wrong origin";
  return null;
}

/** ECDSA signatures arrive DER-wrapped from WebAuthn and Web Crypto wants the
    raw r‖s pair. Two integers, each possibly carrying a leading zero byte to
    keep it positive, each possibly shorter than 32 bytes. Getting this wrong
    fails as an invalid signature, which looks exactly like a wrong key. */
function derToRaw(der: Uint8Array): Uint8Array {
  let at = 0;
  if (der[at++] !== 0x30) throw new Error("bad signature");
  if ((der[at] ?? 0) & 0x80) at += 1 + ((der[at] ?? 0) & 0x7f);
  else at += 1;

  const readInt = (): Uint8Array => {
    if (der[at++] !== 0x02) throw new Error("bad signature");
    const length = der[at++] ?? 0;
    let value = der.slice(at, at + length);
    at += length;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };

  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

const ALGORITHMS: Record<
  number,
  { import: EcKeyImportParams | RsaHashedImportParams; verify: AlgorithmIdentifier | EcdsaParams }
> = {
  /* ES256 is what a phone's secure enclave speaks. RS256 is what Windows Hello
     has historically returned — an owner editing from a laptop needs both, and
     supporting only the first passes every test on a phone. */
  [-7]: { import: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" } },
  [-257]: { import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verify: { name: "RSASSA-PKCS1-v1_5" } }
};

async function verifyAssertion(
  credential: Credential,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array,
  rpId: string
): Promise<string | null> {
  if (authenticatorData.length < 37) return "short authenticator data";

  const expectedRp = await sha256(encoder.encode(rpId));
  for (let i = 0; i < 32; i += 1) {
    if (authenticatorData[i] !== expectedRp[i]) return "wrong relying party";
  }
  const flags = authenticatorData[32] ?? 0;
  if (!(flags & 0x01)) return "the device was not present";
  /* User verification is required rather than merely requested, because the
     whole offer being made is "your face or your fingerprint". A credential
     that unlocks on presence alone is a credential that unlocks in a pocket. */
  if (!(flags & 0x04)) return "the device did not verify who you are";

  const algorithm = ALGORITHMS[credential.alg];
  if (!algorithm) return "unsupported key type";

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "spki",
      base64UrlDecode(credential.key) as unknown as ArrayBuffer,
      algorithm.import,
      false,
      ["verify"]
    );
  } catch {
    return "unreadable key";
  }

  const signed = new Uint8Array(authenticatorData.length + 32);
  signed.set(authenticatorData, 0);
  signed.set(await sha256(clientDataJSON), authenticatorData.length);

  let bytes = signature;
  if (credential.alg === -7) {
    try {
      bytes = derToRaw(signature);
    } catch {
      return "malformed signature";
    }
  }

  const ok = await crypto.subtle.verify(
    algorithm.verify,
    key,
    bytes as unknown as ArrayBuffer,
    signed as unknown as ArrayBuffer
  );
  return ok ? null : "the signature did not check out";
}

/** `purpose.challenge`, split on the first dot only — a base64url challenge
    never contains one, but the split has to be deliberate rather than lucky. */
function splitOnce(value: string): [string, string] {
  const at = value.indexOf(".");
  return at < 0 ? [value, ""] : [value.slice(0, at), value.slice(at + 1)];
}

/* ── The handler ──────────────────────────────────────────────────────── */

export function createPasskeyHandler(options: PasskeyHandlerOptions): PasskeyHandler {
  const resolveEnv: () => CmsEnv =
    typeof options.env === "function" ? options.env : () => options.env as CmsEnv;
  const path = options.path ?? "/api/passkey";

  async function POST(request: Request): Promise<Response> {
    const env = resolveEnv();
    if (!env.sessionSecret || !env.allowlist) {
      return json({ ok: false, error: "not-configured" }, 503);
    }

    let body: {
      action?: string;
      id?: string;
      clientDataJSON?: string;
      authenticatorData?: string;
      signature?: string;
      publicKey?: string;
      alg?: number;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ ok: false, error: "bad-request" }, 400);
    }

    const rp = relyingParty(request);
    const secret = env.sessionSecret;
    const held = await readCredential(request, secret);
    const mine = held && held.rp === rp.id ? held : null;

    /* Does this browser have a credential at all? The one question that is
       safe to answer without a session — it is a fact about the caller's own
       cookie jar, and the ladder needs it to know which of four things to
       offer. */
    if (body.action === "state") {
      return json({ ok: true, enrolled: Boolean(mine) });
    }

    /* Dropping a credential needs no session and no ceremony: the cookie is
       the credential, the caller is holding it, and clearing a cookie you
       already have is not a privilege. Requiring a session here would mean an
       owner whose session had lapsed could not un-enrol the phone they are
       about to sell without signing in on it first. */
    if (body.action === "forget") {
      return json({ ok: true }, 200, [clearCredential()]);
    }

    if (body.action === "register-options" || body.action === "register-verify") {
      const session = await readSession(request.headers.get("cookie"), { secret });
      if (!session || !allows(env.allowlist, session)) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      if (body.action === "register-options") {
        const challenge = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
        return json(
          {
            ok: true,
            options: {
              challenge,
              rpId: rp.id,
              rpName: options.rpName || rp.id,
              /* The Google `sub`, so the credential belongs to the account
                 rather than to the address on it — the same reason the
                 allowlist accepts both. */
              userId: base64UrlEncode(encoder.encode(session.sub)),
              userName: session.email,
              userDisplayName: session.name || session.email,
              timeout: TIMEOUT_MS,
              excludeCredentials: mine ? [{ id: mine.id }] : []
            }
          },
          200,
          [challengeCookie("create", challenge, path)]
        );
      }

      const [purpose, challenge] = splitOnce(
        cookieValue(request.headers.get("cookie"), CHALLENGE_COOKIE) ?? ""
      );
      if (purpose !== "create" || !challenge) {
        return json({ ok: false, error: "no challenge in flight" }, 400);
      }
      if (!body.id || !body.clientDataJSON || !body.publicKey) {
        return json({ ok: false, error: "bad-request" }, 400);
      }

      const problem = await checkClientData(base64UrlDecode(body.clientDataJSON), {
        type: "webauthn.create",
        challenge,
        origin: rp.origin
      });
      if (problem) return json({ ok: false, error: problem }, 400);

      if (!ALGORITHMS[Number(body.alg)]) {
        return json({ ok: false, error: "unsupported key type" }, 400);
      }

      const credential: Credential = {
        id: body.id,
        key: body.publicKey,
        alg: Number(body.alg),
        sub: session.sub,
        email: session.email,
        name: session.name || session.email,
        rp: rp.id,
        at: Date.now()
      };
      return json({ ok: true }, 200, [
        await credentialCookie(credential, secret),
        clearChallenge(path)
      ]);
    }

    if (body.action === "auth-options") {
      if (!mine) return json({ ok: false, error: "not-enrolled" }, 404);
      const challenge = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
      return json(
        {
          ok: true,
          options: {
            challenge,
            rpId: rp.id,
            timeout: TIMEOUT_MS,
            allowCredentials: [{ id: mine.id }]
          }
        },
        200,
        [challengeCookie("get", challenge, path)]
      );
    }

    if (body.action === "auth-verify") {
      if (!mine) return json({ ok: false, error: "not-enrolled" }, 404);
      const [purpose, challenge] = splitOnce(
        cookieValue(request.headers.get("cookie"), CHALLENGE_COOKIE) ?? ""
      );
      if (purpose !== "get" || !challenge) {
        return json({ ok: false, error: "no challenge in flight" }, 400);
      }
      if (!body.id || !body.clientDataJSON || !body.authenticatorData || !body.signature) {
        return json({ ok: false, error: "bad-request" }, 400);
      }
      if (!safeEqual(body.id, mine.id)) {
        return json({ ok: false, error: "unknown credential" }, 400);
      }

      const clientDataJSON = base64UrlDecode(body.clientDataJSON);
      const problem =
        (await checkClientData(clientDataJSON, {
          type: "webauthn.get",
          challenge,
          origin: rp.origin
        })) ??
        (await verifyAssertion(
          mine,
          base64UrlDecode(body.authenticatorData),
          clientDataJSON,
          base64UrlDecode(body.signature),
          rp.id
        ));
      if (problem) return json({ ok: false, error: problem }, 400, [clearChallenge(path)]);

      /* The allowlist, again, now. The credential proves *who*; this
         deployment's own variable is the only thing that answers *may they*,
         and it may have changed since the device was enrolled. Nothing about a
         passkey should survive being taken off the list. */
      if (!allows(env.allowlist, { sub: mine.sub, email: mine.email })) {
        return json({ ok: false, error: "revoked" }, 403, [clearChallenge(path)]);
      }

      const session = await issueSession(
        { sub: mine.sub, email: mine.email, name: mine.name },
        options.sessionMaxAge === undefined
          ? { secret }
          : { secret, maxAgeSeconds: options.sessionMaxAge }
      );
      return json({ ok: true, who: mine.name }, 200, [session, clearChallenge(path)]);
    }

    return json({ ok: false, error: "unknown-action" }, 400);
  }

  return { POST };
}
