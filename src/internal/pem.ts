/* PKCS#8 PEM to DER, in one place.
   ---------------------------------------------------------------------------
   Two things in this kit hold an RSA private key in an environment variable and
   have to hand it to `crypto.subtle.importKey`: the GitHub App
   (feedback/app-auth.ts) and the hand-off ticket issuer (cms/ticket.ts). Both
   want exactly the same conversion and exactly the same refusal, so they share
   one rather than a copy — a divergence here surfaces as an unreadable
   `DataError` from Web Crypto, which says nothing about which of the two keys
   was the wrong shape.

   PKCS#8 only ("-----BEGIN PRIVATE KEY-----"). Web Crypto cannot import PKCS#1
   at all and converting at runtime would drag in a dependency, so the error
   names the one-line fix instead. GitHub hands out PKCS#1 and `openssl genrsa`
   writes it by default, which is why this trap is worth a pointed message in
   both callers rather than a comment in one. */

export function pkcs8ToDer(pem: string, what: string): ArrayBuffer {
  if (pem.includes("RSA PRIVATE KEY")) {
    throw new Error(
      `${what} is PKCS#1; convert to PKCS#8 first: openssl pkcs8 -topk8 -nocrypt -in key.pem`
    );
  }
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  if (!base64) throw new Error(`${what} is empty or not a PEM private key`);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
