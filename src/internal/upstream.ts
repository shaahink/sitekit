/* A deadline on every call that leaves the building.
   ---------------------------------------------------------------------------
   Measured in session 16, drill 5: an analytics instance that accepts a
   connection and never answers cost the owner's home *every* block — the
   traffic, the change list, the deploy state and the share link — and then
   answered 504. That is precisely the failure `ownerHome` settles its blocks
   independently to prevent. The isolation was real; it had nothing to time
   against. One deadline per call, and a hung dependency becomes a failed block
   instead of a dead page, which is what the code already believed happened.

   The numbers are chosen against the *platform's* kill, not against a guess at
   how slow a good day is. A Vercel function's default ceiling is ten seconds,
   and `ownerHome` can make two GitHub calls in sequence (the change list, then
   the newest change's deploy state) — so a GitHub deadline has to leave room
   for two of itself inside one invocation, and analytics, which is the block
   an owner is least entitled to be shown a failure of, gets the shorter one.

   Every funnel takes an override, because the one call in the kit that can
   legitimately be slow is a commit carrying photographs and a site that raises
   its upload limit should be able to raise this with it. Nothing in the fleet
   overrides it today; the parameter exists so that the day it needs to, the
   answer is not "edit the kit". */

/** GitHub reads, and the App installation token that precedes every call. */
export const GITHUB_TIMEOUT_MS = 4000;

/** GitHub writes get longer, and the reason is worth stating: a write cut off
    in flight is ambiguous — GitHub may have taken the commit — so the deadline
    on one has to be generous enough that only a genuinely stuck request meets
    it. It is still inside the platform's ceiling, which is the point: without
    it the ambiguity happens anyway at ten seconds, as a 504 with nothing said
    to the owner at all. A save carrying photographs is the one call here that
    is legitimately slow, hence the gap. */
export const GITHUB_WRITE_TIMEOUT_MS = 8000;

/** Umami. Shorter deliberately — see above. */
export const STATS_TIMEOUT_MS = 3000;

/** Google's JWKS, on the sign-in path. */
export const JWKS_TIMEOUT_MS = 3000;

/** Which GitHub deadline applies. A read and a write are not the same question
    and the selection is here rather than inline in `gh` so it can be tested
    without waiting eight seconds for a signal that carries no readable delay. */
export function githubTimeout(method: string, override?: number): number {
  return override ?? (method === "GET" ? GITHUB_TIMEOUT_MS : GITHUB_WRITE_TIMEOUT_MS);
}

/** A signal that aborts after `ms`, or nothing at all when a caller passes 0.

    Zero is an escape hatch rather than a default: a Worker or a test that
    supplies its own `fetchImpl` may have no `AbortSignal.timeout` at all, and
    a kit that throws on a missing platform API would be a worse failure than
    the one this module exists to fix. */
export function deadline(ms: number): AbortSignal | undefined {
  if (!ms || typeof AbortSignal?.timeout !== "function") return undefined;
  return AbortSignal.timeout(ms);
}

/** Whether a rejection is this module's doing.

    Callers log the reason they failed, and "the request was aborted" reads as a
    bug in the caller unless it says who aborted it. `AbortSignal.timeout`
    rejects with a `TimeoutError` DOMException; a real abort by a client that
    hung up rejects with `AbortError`, and the two mean opposite things about
    whose fault it is. */
export function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}
