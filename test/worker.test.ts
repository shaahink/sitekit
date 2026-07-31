/* The generated service worker must at least parse.
   ---------------------------------------------------------------------------
   This test exists because of a specific production failure, and the failure
   is worth restating because the class is invisible by construction.

   The fleet console's worker carried a bolded path in its header comment. The
   markdown way of writing one puts a star immediately before a slash, and that
   sequence closes a block comment. The script threw at the next word,
   registration failed, and **nothing anywhere said so** — a failed
   registration is caught and ignored on purpose, because the surface works
   perfectly well without a worker. It took Chrome's
   `ServiceWorker.workerErrorReported` over CDP to see it at all.

   Nothing in an Astro build ever parses a generated script. `node --check`
   catches the whole class in a second for a file on disk; this is the same
   check for a file that does not exist until a site builds. `new Function`
   compiles the body — which parses it — without running any of it, so a
   `self.addEventListener` at the top level is never reached.

   ⚠ If this file ever fails, the answer is a syntax error in `worker.ts`'s
   template, not a broken test. Read the reported position against the string
   the generator returns, not against the TypeScript around it. */

import { describe, expect, it } from "vitest";
import { serviceWorkerSource } from "../src/astro/worker.js";

const source = (overrides: Partial<Parameters<typeof serviceWorkerSource>[0]> = {}) =>
  serviceWorkerSource({
    editorPath: "/edit",
    manifestPath: "/sk-editor.webmanifest",
    version: "0.23.0",
    ...overrides
  });

describe("serviceWorkerSource", () => {
  it("produces JavaScript that parses", () => {
    expect(() => new Function(source())).not.toThrow();
  });

  it("still parses for a site whose editor is somewhere else", () => {
    expect(() => new Function(source({ editorPath: "/manage" }))).not.toThrow();
  });

  it("closes every block comment it opens", () => {
    /* The specific trap, asserted directly rather than only through the parse
       above: a `*` immediately before a `/` inside a comment. Counting
       delimiters catches it even in a version of this file where the template
       happens to stay syntactically valid after an early close. */
    const text = source();
    const opens = text.split("/*").length - 1;
    const closes = text.split("*/").length - 1;
    expect(closes).toBe(opens);
  });

  it("owns the editor route and its bundle, and nothing of the public site", () => {
    const text = source();
    expect(text).toContain('"/edit"');
    expect(text).toContain("/_astro/");
    /* The rule the whole file exists to keep: an owner who has just saved must
       see what they saved, so nothing here may claim a site's own pages. If a
       future edit adds a catch-all, this is what should stop it. */
    expect(text).not.toContain('path === "/"');
    expect(text).not.toContain("caches.match(request).then((held) => held || fetch(request))");
  });

  it("carries the release in its cache name, so a bump drops the old shell", () => {
    expect(source({ version: "9.9.9" })).toContain("sk-editor-9.9.9");
  });

  it("normalises a trailing slash rather than owning a path with two", () => {
    expect(source({ editorPath: "/edit/" })).toContain('const EDITOR = "/edit"');
  });
});
