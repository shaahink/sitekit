#!/usr/bin/env node
/* Copy the editor's stylesheets into a site's public/.
   ---------------------------------------------------------------------------
   Usage, from a site root:  sitekit-editor-css [directory]
   Default directory:        public/

   Writes two files:
     editor-panel.css   the panel at /edit
     editor-inline.css  inline editing, on the site's own pages

   Both are *copied* rather than imported: Astro folds every processed
   stylesheet's hash into every page's CSP, so importing either would change
   the public pages' policy to serve an admin surface. A static asset under
   `style-src 'self'` keeps that policy exact — which matters twice as much for
   the inline sheet, since it is linked from public pages rather than from one
   route nobody visits.

   This lives in the kit rather than as a script in each site for the same
   reason the panel does. If it were per-site, adding this second file would
   have meant editing five repos — which is precisely the boundary session 7.5
   exists to get right. Sites run it; nobody maintains five copies of it.

   Each site's CI runs it and diffs, so a stale copy fails the build. */

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const kit = dirname(dirname(fileURLToPath(import.meta.url)));

/* Before this file shipped two stylesheets the argument was a destination
   *file*. A site pinned to an older kit passes one; take its directory and
   carry on rather than writing editor-inline.css to a path called
   editor-panel.css. */
const asked = process.argv[2];
const directory = asked ? (extname(asked) === ".css" ? dirname(asked) : asked) : "public";

const files = [
  ["dist/editor/editor.css", "editor-panel.css"],
  ["dist/editor/inline.css", "editor-inline.css"]
];

for (const [from, name] of files) {
  const source = resolve(kit, from);
  const destination = resolve(process.cwd(), directory, name);

  let bytes;
  try {
    bytes = readFileSync(source);
  } catch {
    console.error(
      `sitekit-editor-css: ${source} isn't there.\n` +
        (name === "editor-inline.css"
          ? "The installed @shaahink/sitekit predates inline editing — pin 0.7.0 or later."
          : "The installed @shaahink/sitekit predates the editor — pin 0.6.0 or later.")
    );
    process.exit(1);
  }

  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  console.log(`editor stylesheet → ${directory}/${name} (${bytes.length} bytes)`);
}
