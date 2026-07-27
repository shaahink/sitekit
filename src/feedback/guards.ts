import type { RateLimit } from "./types.js";

/** Constant-time string comparison, so the review key can't be timed out. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Only the site's own pages may post. `allowedOrigin` admits one extra
    origin — a preview URL, say — configured at the edge. */
export function sameHost(
  origin: string,
  host: string | null,
  allowedOrigin?: string | undefined
): boolean {
  if (allowedOrigin && origin === allowedOrigin.replace(/\/+$/, "")) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/* Warm-instance throttle. Not airtight across instances, but it turns a
   hammering script into a trickle, and the review key is the real gate. */
export function createThrottle(limit: RateLimit): (ip: string) => boolean {
  const recent = new Map<string, number[]>();
  return function throttled(ip: string): boolean {
    const now = Date.now();
    const hits = (recent.get(ip) || []).filter((t) => now - t < limit.windowMs);
    hits.push(now);
    recent.set(ip, hits);
    /* Crude, deliberate: a full sweep beats a leak on a warm instance. */
    if (recent.size > 500) recent.clear();
    return hits.length > limit.max;
  };
}
