/* Unlocking an admin surface with the device instead of with Google.
   ---------------------------------------------------------------------------
   This is the client half of `cms/passkey.ts`, lifted out of the fleet console
   in 0.23.0 so the owner's editor could have the same thing. The console had
   it first and had it alone: a site owner opening their own editor on their
   own phone met Google's account chooser every time, which is the exact trip
   this removes.

   **It returns codes, never sentences.** The console says one language and the
   editor says three, so a shared module that held its own English would have
   forced the editor to either translate around it or ship an English line into
   a Farsi panel — which is the bug session 17 spent a whole session undoing.
   Every failure here is a `PasskeyReason`, and each caller maps it to words in
   whatever language it is already speaking.

   What this is and is not, unchanged from the console's original: it is a
   second way to prove you are the person who **already signed in on this
   device**, and nothing else. Enrolment requires a live session, and every
   unlock re-checks that deployment's own allowlist at that moment. It removes
   a round trip; it grants nothing.

   See `./unlock.ts` for the part that decides which of four things to offer,
   which is the half that was actually broken. */

export type PasskeyReason =
  /** The server has no session secret or no allowlist — nothing works yet. */
  | "not-configured"
  /** Enrolment was attempted without a live session. The ladder exists so a
      reader never reaches this, but a session can lapse mid-tap. */
  | "unauthorized"
  /** This browser holds no credential for this origin. */
  | "not-enrolled"
  /** The reader dismissed the platform's own prompt. Not a fault, and the one
      reason a caller should usually say nothing about. */
  | "cancelled"
  /** The authenticator declined — no sensor enrolled, hardware refused. */
  | "device-refused"
  /** A browser old enough to make credentials but not to hand back a public
      key in a form Web Crypto can import. */
  | "browser-too-old"
  /** The assertion did not check out server-side. */
  | "unverified"
  /** The account is no longer on this site's allowlist. Distinct from every
      other refusal because it is the one with a human cause. */
  | "revoked"
  /** The network did not answer. */
  | "offline"
  | "unknown";

export interface PasskeyResult {
  ok: boolean;
  reason?: PasskeyReason;
  /** Whatever the server said, for a log. Never for a reader — it is English
      from a handler and the reader may not be reading English. */
  detail?: string;
}

const OK: PasskeyResult = { ok: true };
const fail = (reason: PasskeyReason, detail?: string): PasskeyResult =>
  detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };

/* ── base64url ────────────────────────────────────────────────────────── */

/* Backed by an explicit ArrayBuffer rather than by the length shorthand: the
   WebAuthn types want a `BufferSource`, and `new Uint8Array(n)` is typed over
   `ArrayBufferLike`, which includes `SharedArrayBuffer` and therefore is not
   one. Same bytes, a type the DOM will accept. */
function decode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ── The server's answers, mapped ─────────────────────────────────────── */

interface Envelope {
  ok?: boolean;
  error?: string;
  enrolled?: boolean;
  options?: unknown;
}

/** The handler's refusals, turned into codes. Anything unrecognised becomes
    `unknown` and keeps its text in `detail`, so a new refusal added to the
    handler degrades to a generic message rather than to silence. */
function reasonOf(status: number, error: string | undefined): PasskeyReason {
  if (status === 503) return "not-configured";
  if (status === 401) return "unauthorized";
  if (status === 403) return "revoked";
  if (status === 404) return "not-enrolled";
  if (error === "not-enrolled") return "not-enrolled";
  return "unknown";
}

/** Every refusal from a WebAuthn ceremony, mapped once. `NotAllowedError` is
    both "the reader said no" and "the reader waited too long", and neither is
    worth a scolding message. */
function ceremonyReason(cause: unknown): PasskeyReason {
  if (!(cause instanceof Error)) return "unknown";
  if (cause.name === "NotAllowedError" || cause.name === "AbortError") return "cancelled";
  return "device-refused";
}

export interface PasskeyOptions {
  /** Where the handler is mounted. The editor and the console both use
      `/api/passkey`; a site is free to mount it elsewhere and say so. */
  endpoint?: string;
}

interface CreateOptions {
  challenge: string;
  rpId: string;
  rpName: string;
  userId: string;
  userName: string;
  userDisplayName: string;
  timeout: number;
  excludeCredentials: { id: string }[];
}

interface GetOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  allowCredentials: { id: string }[];
}

export interface Passkey {
  /** Does this device have a face or a fingerprint worth offering? A security
      key would work perfectly well, but the offer being made is a sensor, and
      making that offer to a laptop with neither is how a button gets pressed
      once and never again. */
  capable(): Promise<boolean>;
  /** Two facts in one round trip, and they must not be collapsed into one.

      `mounted` is whether this site has a passkey handler at all. During a
      fleet rollout most sites do not — the route is per-site wiring that lands
      with a bump — and a site without one answers 404, which is
      indistinguishable from "not enrolled" if only the second fact is read.
      Collapsing them would have offered every un-migrated owner a button that
      could only ever fail, which is the exact class of bug this release exists
      to remove.

      `enrolled` is whether this browser already holds a credential for this
      origin. Answerable without a session — it is a fact about the caller's
      own cookie jar. */
  state(): Promise<{ mounted: boolean; enrolled: boolean }>;
  enrol(): Promise<PasskeyResult>;
  unlock(): Promise<PasskeyResult>;
  /** Drop this device's credential. Needed because the promise the feature
      makes is "this device", and a promise about a device has to be
      breakable by whoever is holding it — somebody selling a phone should not
      have to rotate a secret that signs out five other people to do it. */
  forget(): Promise<PasskeyResult>;
}

export function createPasskey(options: PasskeyOptions = {}): Passkey {
  const endpoint = options.endpoint ?? "/api/passkey";

  async function post(body: Record<string, unknown>): Promise<{ status: number; body: Envelope }> {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const parsed = (await response.json().catch(() => ({}))) as Envelope;
      return { status: response.status, body: parsed };
    } catch {
      /* A thrown fetch is a network that is not there. Status 0 is not a
         status any server sends, which is what makes it usable as one. */
      return { status: 0, body: {} };
    }
  }

  async function capable(): Promise<boolean> {
    if (!globalThis.PublicKeyCredential || !navigator.credentials) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  async function state(): Promise<{ mounted: boolean; enrolled: boolean }> {
    const { status, body } = await post({ action: "state" });
    /* `ok: true` is the handler's own signature. A 404 from the host, a 503
       from a handler with no session secret, and an HTML error page that did
       not parse all arrive here as `ok` absent — and all three mean the same
       thing to a reader: there is nothing on this site to offer them. A
       network failure is deliberately in that set too; offering to set up a
       fingerprint while offline would fail at the next request anyway. */
    const mounted = status === 200 && body.ok === true;
    return { mounted, enrolled: mounted && body.enrolled === true };
  }

  async function enrol(): Promise<PasskeyResult> {
    const started = await post({ action: "register-options" });
    if (started.status === 0) return fail("offline");
    if (!started.body.ok || !started.body.options) {
      return fail(reasonOf(started.status, started.body.error), started.body.error);
    }
    const o = started.body.options as CreateOptions;

    let credential: PublicKeyCredential | null;
    try {
      credential = (await navigator.credentials.create({
        publicKey: {
          challenge: decode(o.challenge),
          rp: { id: o.rpId, name: o.rpName },
          user: {
            id: decode(o.userId),
            name: o.userName,
            displayName: o.userDisplayName
          },
          /* ES256 first because it is what a phone's secure enclave speaks,
             then RS256 because it is what Windows Hello has historically
             returned. A list of one would have worked on the author's phone
             and failed on the author's laptop. */
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 }
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "preferred",
            userVerification: "required"
          },
          /* No attestation. We are not deciding whether to trust the make of
             the authenticator — we are remembering one this browser already
             proved it owns — and asking for attestation is how a prompt grows
             a scary privacy sentence for no gain. */
          attestation: "none",
          timeout: o.timeout,
          excludeCredentials: o.excludeCredentials.map((held) => ({
            type: "public-key" as const,
            id: decode(held.id)
          }))
        }
      })) as PublicKeyCredential | null;
    } catch (cause) {
      return fail(ceremonyReason(cause));
    }
    if (!credential) return fail("cancelled");

    const response = credential.response as AuthenticatorAttestationResponse;
    /* `getPublicKey()` hands back SPKI, which Web Crypto imports directly. The
       alternative is parsing CBOR out of the attestation object to find a COSE
       key and rebuilding it — a hundred lines of parser, in a handler, for a
       value the browser is already willing to hand over. */
    const spki = response.getPublicKey?.();
    if (!spki) return fail("browser-too-old");

    const verified = await post({
      action: "register-verify",
      id: credential.id,
      clientDataJSON: encode(response.clientDataJSON),
      publicKey: encode(spki),
      alg: response.getPublicKeyAlgorithm?.() ?? -7
    });
    if (verified.status === 0) return fail("offline");
    if (!verified.body.ok) {
      const reason = reasonOf(verified.status, verified.body.error);
      return fail(reason === "unknown" ? "unverified" : reason, verified.body.error);
    }
    return OK;
  }

  async function unlock(): Promise<PasskeyResult> {
    const started = await post({ action: "auth-options" });
    /* Three lines that did not exist before 0.23.0, and their absence is the
       whole bug. This used to be `if (!ok) return false` — no code, no
       message, nothing — so a reader whose credential had been dropped, or
       whose network was down, or whose site had lost its session secret,
       pressed a button and watched nothing happen. Three different faults,
       one identical silence. */
    if (started.status === 0) return fail("offline");
    if (!started.body.ok || !started.body.options) {
      return fail(reasonOf(started.status, started.body.error), started.body.error);
    }
    const o = started.body.options as GetOptions;

    let assertion: PublicKeyCredential | null;
    try {
      assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: decode(o.challenge),
          rpId: o.rpId,
          timeout: o.timeout,
          userVerification: "required",
          allowCredentials: o.allowCredentials.map((held) => ({
            type: "public-key" as const,
            id: decode(held.id)
          }))
        }
      })) as PublicKeyCredential | null;
    } catch (cause) {
      return fail(ceremonyReason(cause));
    }
    if (!assertion) return fail("cancelled");

    const response = assertion.response as AuthenticatorAssertionResponse;
    const verified = await post({
      action: "auth-verify",
      id: assertion.id,
      clientDataJSON: encode(response.clientDataJSON),
      authenticatorData: encode(response.authenticatorData),
      signature: encode(response.signature)
    });
    if (verified.status === 0) return fail("offline");
    if (!verified.body.ok) {
      const reason = reasonOf(verified.status, verified.body.error);
      return fail(reason === "unknown" ? "unverified" : reason, verified.body.error);
    }
    return OK;
  }

  async function forget(): Promise<PasskeyResult> {
    const dropped = await post({ action: "forget" });
    if (dropped.status === 0) return fail("offline");
    if (!dropped.body.ok) {
      return fail(reasonOf(dropped.status, dropped.body.error), dropped.body.error);
    }
    return OK;
  }

  return { capable, state, enrol, unlock, forget };
}
