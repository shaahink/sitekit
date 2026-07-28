/* base64url — the JWT alphabet, in one place.
   ---------------------------------------------------------------------------
   feedback/app-auth.ts signs App JWTs with these; cms/google.ts verifies
   Google's ID tokens with them. Both halves speak the same dialect, so they
   share an implementation rather than a copy — a divergence between an
   encoder and its matching decoder surfaces as an inscrutable signature
   failure, which is the worst possible way to learn about a typo. */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/** Throws on anything that isn't valid base64url — callers treat that as a
    rejected token, never as a server fault. The return type names its buffer
    concretely so the bytes satisfy `BufferSource` and can go straight into
    Web Crypto without a cast. */
export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** One JWT segment's claims. Rejects arrays and null, which parse as JSON but
    are not claim sets. */
export function decodeJwtJson(segment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JWT segment is not a JSON object");
  }
  return value as Record<string, unknown>;
}
