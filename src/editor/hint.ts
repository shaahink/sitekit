/* The one small way in a marked device is shown.
   ---------------------------------------------------------------------------
   Downloaded by a device that carries `marker.ts`'s marker and by nothing
   else: `inline-gate.ts` asks the cheapest question it can — is there a marker
   at all — and imports this only if there is. A visitor has none, so a
   visitor's browser reaches the gate's `return` having requested nothing. That
   is the whole of A2's constraint, and it is why this is not a footer link.

   `marker.ts` holds why the marker can be trusted with nothing and still be
   useful. This file holds what it draws.

   **It ships no stylesheet, and that is the trap it exists to avoid.** Not
   `import "./hint.css"`, which is the obvious thing and is what `inline.css`
   and `editor.css` do. Astro hoists CSS reachable from a page's script graph,
   so a dynamic CSS import keeps the JS off a visitor's page and puts the
   stylesheet on it — measured again while this was written, and exactly why
   `feedback-chrome.css` is `<link>`ed on the public page of all six sites at
   7.3–7.9 kB although both of the imports that reach it are dynamic and behind
   a `localStorage` check. The failure would be invisible in review: the JS
   really would stay lazy.

   So everything here is styled through CSSOM writes, `element.style.x = …`,
   which `src/widget/chrome.ts` already does on these same sites under these
   same policies. CSSOM is not covered by `style-src`; a `style=""` attribute
   in markup is, and four of the six sites would block one. */

import type { InlineOptions } from "./inline.js";
import { editorRemembered, forgetEditor } from "./marker.js";
import { EDIT_PARAM, editHref, TOUR_PARAM } from "./return-to.js";
import { dirFor, editorStrings } from "./strings.js";

/** The hook a capture or a test finds this by, and the guard against drawing
    twice on a site that calls `installInlineEditor` from two places. */
const HOOK = "data-sk-edit-hint";

/** Draw the way in, if this device still has a live marker. */
export function showEditHint(options: InlineOptions = {}): void {
  if (!editorRemembered()) return;
  /* The gate only waits for the document in its edit-mode branch, and this
     appends to `document.body`. A site that inlines the gate's script, or a
     bundler that stops deferring, must not race the body it is looking for. */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => draw(options), { once: true });
  } else {
    draw(options);
  }
}

function draw(options: InlineOptions = {}): void {
  /* A page with no content model has nothing this could open: `inline.ts`
     returns on the same question. Offering a door onto an empty room is worse
     than offering nothing. */
  if (!document.querySelector("[data-sk-collection]")) return;
  if (document.querySelector(`[${HOOK}]`)) return;

  const lang = options.lang ?? document.documentElement.lang;
  const strings = editorStrings(lang, options.strings);

  const box = document.createElement("div");
  box.setAttribute(HOOK, "");
  box.dir = dirFor(lang);
  style(box, {
    position: "fixed",
    insetBlockEnd: "16px",
    insetInlineEnd: "16px",
    /* Under a site's own modals is where this belongs — it is an offer, not an
       interruption — but above its ordinary chrome, or it lands behind a
       sticky header on a phone. */
    zIndex: "2147482000",
    display: "flex",
    alignItems: "stretch",
    /* A site tunes this the way it tunes the panel: custom properties, not a
       copy of the file. `var()` inside a CSSOM write costs nothing and needs
       no stylesheet to declare a fallback. */
    background: "var(--sk-hint-bg, #16181d)",
    color: "var(--sk-hint-fg, #ffffff)",
    borderRadius: "999px",
    boxShadow: "0 2px 14px rgba(0, 0, 0, 0.28)",
    overflow: "hidden",
    /* `system-ui` asks for nothing. A webfont here would be a request a public
       page's `font-src 'self'` refuses, on a surface that may add no requests
       at all — and the fleet's own fonts are self-hosted woff2 for the same
       kind of reason. */
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
    fontSize: "15px",
    lineHeight: "20px",
    maxWidth: "calc(100vw - 32px)"
  });

  /* The page the owner is standing on, in edit mode — not the panel. That
     derives the target completely and never names the editor's path, which is
     `/edit` on four sites and `/edit.html` on two; anything that spells one is
     wrong about a third of the fleet.

     Both parameters come off first. Arriving with `?edit=off` in the URL is
     exactly how an owner who has just left edit mode gets here — the gate
     reads the first `edit` it finds, so appending a second would build a link
     that turns edit mode on and then straight back off. */
  const url = new URL(location.href);
  url.searchParams.delete(EDIT_PARAM);
  url.searchParams.delete(TOUR_PARAM);

  const link = document.createElement("a");
  link.href = editHref(`${url.pathname}${url.search}${url.hash}`);
  link.textContent = strings.hintEdit;
  style(link, {
    color: "inherit",
    textDecoration: "none",
    /* 44px tall: 20px of line and 12px above and below it. A control an owner
       has to aim at on a phone is a control they tap twice. */
    paddingBlock: "12px",
    paddingInline: "18px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  });

  /* Dismissing deletes the marker rather than setting a second "dismissed"
     one, and that is the design rather than a shortcut. The marker names
     nobody, so on a shared family device the honest answer to "this is not
     mine" is for the device to forget — and only a server verdict brings it
     back, on the next request the site accepts. It costs a stray tap one
     `/edit`, which is recoverable; a hidden permanent flag would cost an owner
     a way in they cannot get back without being told a second secret. */
  const hide = document.createElement("button");
  hide.type = "button";
  hide.textContent = strings.hintDismiss;
  hide.title = strings.hintDismissTitle;
  hide.setAttribute("aria-label", strings.hintDismissTitle);
  style(hide, {
    appearance: "none",
    background: "transparent",
    border: "0",
    borderInlineStart: "1px solid rgba(255, 255, 255, 0.22)",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    paddingBlock: "12px",
    paddingInline: "16px"
  });
  hide.addEventListener("click", () => {
    forgetEditor();
    box.remove();
  });

  box.append(link, hide);
  document.body.append(box);
}

/** CSSOM, one property at a time, and never `setAttribute("style", …)`.
    `Object.assign` onto a `CSSStyleDeclaration` is the same set of writes with
    less noise; what it must not become is a string handed to the attribute,
    which is markup and which `style-src-attr` blocks on four of six sites. */
function style(element: HTMLElement, properties: Record<string, string>): void {
  Object.assign(element.style, properties);
}
