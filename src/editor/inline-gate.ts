/* The only inline-editing code a public visitor ever runs.
   ---------------------------------------------------------------------------
   Deliberately the same shape as each site's review-gate.js, because that
   pattern is already proven on four sites: a few lines on every page that read
   a URL parameter and *dynamically import* the real thing only if it is
   wanted. The public downloads this function and nothing else.

   Which is what keeps the public pages' CSP untouched. The chunk is
   same-origin, so `script-src 'self'` already covers it; it talks only to
   /api/content, so `connect-src 'self'` already covers it; and it never loads
   Google, because sign-in stays at /edit.

   `?edit=1` turns it on, `?edit=off` turns it off, and sessionStorage keeps it
   on for the tab so an owner can navigate their own site while editing without
   the parameter riding along in every link they might then copy.

   This is not a permission. Anyone may set it; the server is what decides, and
   an unauthenticated visitor who sets it gets a bar that says to sign in.

   **A function rather than a side-effecting module, and that is load-bearing.**
   The kit declares `sideEffects: false`, which is true of every other file in
   it and lets bundlers drop what a site does not use. A bare
   `import "@shaahink/sitekit/editor/inline-gate"` under that flag is dropped
   *entirely* — the gate compiled away to nothing, on every page, silently.
   Found on the template before it reached a site. An imported binding that is
   called cannot be tree-shaken, so the site's one line says what it does and
   survives the optimiser. */

import type { InlineOptions } from "./inline.js";

const STORE = "sk-edit-mode";

/** Call once, from the layout every page shares. */
export function installInlineEditor(options: InlineOptions = {}): void {
  try {
    const asked = new URLSearchParams(location.search).get("edit");
    if (asked !== null) {
      if (asked && asked !== "off") sessionStorage.setItem(STORE, "1");
      else sessionStorage.removeItem(STORE);
    }

    if (!sessionStorage.getItem(STORE)) return;

    const start = (): void => {
      void import("./inline.js").then((module) => module.startInlineEditor(options));
    };
    /* Astro emits this as a deferred module, so the document is normally
       parsed by now — but a site that inlines it, or a future bundler that
       does not defer, must not race the annotations it is looking for. */
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  } catch {
    /* Private browsing refuses sessionStorage. Edit mode simply stays off,
       which is the same outcome as never having asked for it. */
  }
}
