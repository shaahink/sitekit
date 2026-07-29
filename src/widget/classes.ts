/* The review widget's class names, as a contract.
   ---------------------------------------------------------------------------
   Six sites style this widget from their own `feedback-chrome.css`, and those
   stylesheets stay per-site on purpose: a reviewer is looking at the client's
   page, so the widget wears the client's palette (PLAN §3.2, and CLAUDE.md's
   "the kit holds logic; sites hold presentation"). The DOM moved into the kit
   at 0.16.0; the paint did not.

   That makes every name below a published interface. Renaming one is a
   breaking change against six stylesheets in six repos, and it would fail
   *silently* — an unstyled review widget still works, so nothing goes red and
   nobody finds out until a reviewer sees a pile of unstyled buttons on a
   client's page. `widget-classes.test.ts` reads `chrome.ts` back and refuses
   any class name the chrome uses that is not listed here, which is the same
   trick `checkAnnotations` plays on the built pages: measure the artifact, do
   not trust the comment.

   Adding a name is not breaking — an unstyled new element inherits the
   stylesheet's own `.rv-root` defaults — but it does mean six stylesheets have
   nothing to say about it, so add with that in mind. */

/** Structural class names, in roughly the order the widget builds them. */
export const WIDGET_CLASSES: readonly string[] = [
  /* Root and the bar that is always visible in review mode. */
  "rv-root",
  "rv-pins",
  "rv-bar",
  "rv-main",
  "rv-dot",
  "rv-badge",
  "rv-more",

  /* The ▾ menu. */
  "rv-menu",
  "rv-count",

  /* Hover highlight while picking. */
  "rv-hl",
  "rv-hl-tag",

  /* The composer. */
  "rv-scrim",
  "rv-sheet",
  "rv-ctx",
  "rv-ctx-text",
  "rv-up",
  "rv-body",
  "rv-attach",
  "rv-attach-btn",
  "rv-thumb",
  "rv-foot",
  "rv-ghost",
  "rv-msg",
  "rv-send",
  /* Not styled by any of the six stylesheets — it rides `rv-ghost`. It is a
     hook the chrome queries so a failed send only ever offers Copy once. */
  "rv-copy",

  /* The confirmation card that replaces the composer after a send. */
  "rv-done",
  "rv-check",
  "rv-done-quote",
  "rv-done-bar",

  /* Pins and the toast. */
  "rv-pin",
  "rv-toast"
];

/** State classes, which are toggled rather than built. `rv-picking` is the odd
    one out: it goes on `<html>`, not inside the widget, because it is what
    gives the whole page its crosshair cursor. */
export const WIDGET_STATE_CLASSES: readonly string[] = [
  "rv-picking",
  "rv-drop",
  "is-picking",
  "is-new"
];
