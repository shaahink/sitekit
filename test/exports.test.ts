/* Is the thing a site imports actually reachable from where it imports it?
   ---------------------------------------------------------------------------
   This file exists because 0.23.0 shipped without it and got it wrong. The
   passkey handler was written, compiled, covered by its own tests and present
   in `dist/cms/passkey.js` — and never re-exported from `src/cms/index.ts`, so
   `import { createPasskeyHandler } from "@shaahink/sitekit/cms"` did not
   resolve. Everything was green. The module was simply unreachable from the
   one specifier any site would use.

   It is the same shape as the trap `prove.mjs`'s header already records: for
   four releases the proof overlaid the kit's `dist` but not its
   `package.json`, so a new subpath was unreachable and correct code failed.
   Both are the same lesson — a module that compiles is not a module a site can
   import — and both are invisible to a unit test that imports by relative
   path, which every other test in this directory does.

   So this one imports the way a site does: through the package's own export
   map, by specifier. Adding an entry point without adding it here is possible;
   adding one that does not resolve is not. */

import { describe, expect, it } from "vitest";

/* Each entry point, with something from it that a site actually names. Kept
   deliberately short — this is a reachability check, not an API snapshot, and
   a list that tried to be exhaustive would be a second place to update on
   every release and would rot faster than the thing it guards. */
const SURFACE: [string, string[]][] = [
  ["@shaahink/sitekit/cms", ["createContentHandler", "createAuthHandler", "createPasskeyHandler"]],
  ["@shaahink/sitekit/app", ["createPasskey", "createLadder", "createPwa"]],
  ["@shaahink/sitekit/editor", ["mountEditor"]],
  ["@shaahink/sitekit/astro", ["editorRoute", "checkAnnotations", "checkPlaceholders"]],
  ["@shaahink/sitekit/credits", ["creditLine", "creditsFor", "creditsAnchor", "creditsJsonLd"]],
  ["@shaahink/sitekit/version", ["KIT_VERSION"]],
  ["@shaahink/sitekit/feedback", ["createFeedbackHandler"]],
  ["@shaahink/sitekit/widget", ["refine", "shrink", "squash"]],
  ["@shaahink/sitekit/companion", ["mountCompanion", "skFigure", "PACE"]],
  ["@shaahink/sitekit/motion/figure", ["createFigure", "stance", "emit", "flip", "PARTS"]]
];

describe("what a site can import", () => {
  for (const [specifier, names] of SURFACE) {
    it(`${specifier} resolves and exports what sites name`, async () => {
      /* Resolved through the export map rather than by relative path, which is
         the entire point: `../src/cms/passkey.js` would have passed on the day
         this bug shipped. */
      const module = (await import(specifier)) as Record<string, unknown>;
      for (const name of names) {
        expect(module[name], `${specifier} → ${name}`).toBeDefined();
      }
    });
  }
});
