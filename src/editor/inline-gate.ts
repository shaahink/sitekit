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

   Since 0.20.0 it asks one more question when edit mode is off, and it is the
   cheapest question there is: does this device carry the marker `hint.ts`
   writes after the server has accepted an editor request here? A visitor has
   no marker, reaches `return` one `localStorage.getItem` later and requests
   nothing — which is the whole constraint, because a footer link would have
   solved the same problem by showing the door to everyone. The marker grants
   nothing and no handler reads it; `hint.ts` explains why it can be trusted
   with nothing and still be useful.

   **A function rather than a side-effecting module, and that is load-bearing.**
   The kit declares `sideEffects: false`, which is true of every other file in
   it and lets bundlers drop what a site does not use. A bare
   `import "@shaahink/sitekit/editor/inline-gate"` under that flag is dropped
   *entirely* — the gate compiled away to nothing, on every page, silently.
   Found on the template before it reached a site. An imported binding that is
   called cannot be tree-shaken, so the site's one line says what it does and
   survives the optimiser. */

import type { InlineOptions } from "./inline.js";

/* **Nothing may import from this file, and that is a measurement rather than a
   preference.** Rollup will not fold a module into an entry chunk if a lazily
   imported chunk also imports it, so one `import { STORE } from
   "./inline-gate.js"` anywhere took the whole gate out of Base.astro's chunk
   and gave every public page a second script to fetch: 507 bytes plus a new
   1.9 kB `inline-gate.<hash>.js`, where there had been one 2.2 kB chunk.
   Measured on a real site-template build while A2.2 was being written. Both
   keys below are therefore private, and `hint.ts` spells the marker's key
   again rather than importing it — with `editor-hint.test.ts` asserting the
   two spellings agree, which is what an import would have bought. */

/** Edit mode, for this tab. */
const STORE = "sk-edit-mode";

/** This device has been accepted by this site's editor before, so it may be
    shown a way in. Everything else about it — writing it, expiring it,
    deleting it, and the one control it draws — is `hint.ts`, which is also
    where the reasons are. It is not a permission and no handler reads it. */
const MARK = "sk-edit-here";

/** Call once, from the layout every page shares. */
export function installInlineEditor(options: InlineOptions = {}): void {
  try {
    const asked = new URLSearchParams(location.search).get("edit");
    if (asked !== null) {
      if (asked && asked !== "off") sessionStorage.setItem(STORE, "1");
      else sessionStorage.removeItem(STORE);
    }

    /* Edit mode is off, which is every visitor on every page. The one extra
       question asked here is whether *this device* has been accepted by this
       site's editor before, and it is the cheapest form of it: a marker at
       all, not a live one. Whether it has expired is decided behind the
       import, by the chunk only a marked device ever downloads.

       A visitor has no marker, so a visitor's browser reaches `return` having
       run one `localStorage.getItem` and requested nothing. */
    if (!sessionStorage.getItem(STORE)) {
      if (localStorage.getItem(MARK)) {
        void import("./hint.js").then((module) => module.showEditHint(options));
      }
      return;
    }

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
