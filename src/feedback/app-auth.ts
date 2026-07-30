/* GitHub App authentication — the PAT's replacement.
   ---------------------------------------------------------------------------
   A hand-minted PAT expires within a year and someone has to notice. An App
   installation mints its own short-lived tokens forever: sign a JWT with the
   App's private key, trade it for an installation token, cache until expiry.
   Web Crypto only (PLAN §3.4) — this must run identically on Vercel and
   Workers.

   The key must be PKCS#8 ("-----BEGIN PRIVATE KEY-----"). GitHub hands out
   PKCS#1; the registration script converts it once before it ever reaches an
   environment variable, because Web Crypto cannot import PKCS#1 and a
   runtime conversion would drag in a dependency. */

import { base64UrlEncode, base64UrlJson } from "../internal/base64url.js";
import { deadline, GITHUB_TIMEOUT_MS } from "../internal/upstream.js";

export interface AppAuthOptions {
  appId: string;
  /** PKCS#8 PEM. See module note — PKCS#1 is rejected with a pointed error. */
  privateKey: string;
  installationId: string;
  userAgent: string;
  /** Override the deadline; 0 removes it. This mint precedes every other call
      the handler makes, so a hang here costs the whole invocation rather than
      one block of it. */
  timeoutMs?: number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/* Warm-instance cache, like the handler's throttle: survives requests on the
   same instance, vanishes with it, and that is enough — a cold mint costs
   two round-trips once an hour. */
const cache = new Map<string, CachedToken>();

/** An installation access token, minted or cached. Tokens live ~1 hour; the
    cache refreshes a minute early so an in-flight request never gets a
    just-expired token. */
export async function installationToken(options: AppAuthOptions): Promise<string> {
  const key = `${options.appId}/${options.installationId}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt - 60_000) return hit.token;

  const jwt = await appJwt(options.appId, options.privateKey);
  const signal = deadline(options.timeoutMs ?? GITHUB_TIMEOUT_MS);
  const response = await fetch(
    `https://api.github.com/app/installations/${options.installationId}/access_tokens`,
    {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": options.userAgent
      }
    }
  );
  if (!response.ok) {
    throw new Error(`installation token: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const data = (await response.json()) as { token: string; expires_at: string };
  cache.set(key, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

/** The App JWT GitHub trades for installation tokens. iat is backdated 60s
    against clock drift; exp is +9 minutes (GitHub's cap is 10). */
export async function appJwt(appId: string, privateKey: string, now: number = Date.now()): Promise<string> {
  const seconds = Math.floor(now / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({ iat: seconds - 60, exp: seconds + 540, iss: appId });
  const signingInput = `${header}.${payload}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Test seam: a fresh mint on demand without waiting an hour. */
export function clearAppTokenCache(): void {
  cache.clear();
}

function pemToDer(pem: string): ArrayBuffer {
  if (pem.includes("RSA PRIVATE KEY")) {
    throw new Error(
      "GitHub App key is PKCS#1; convert to PKCS#8 first: openssl pkcs8 -topk8 -nocrypt -in app.pem"
    );
  }
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

