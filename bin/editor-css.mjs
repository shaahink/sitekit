#!/usr/bin/env node
/* Copy the editor's stylesheet into a site's public/.
   ---------------------------------------------------------------------------
   Usage, from a site root:  sitekit-editor-css [destination]
   Default destination:      public/editor-panel.css

   The panel's CSS lives in the kit and is *copied* rather than imported: Astro
   folds every processed stylesheet's hash into every page's CSP, so importing
   it would change the public pages' policy to serve one admin route. A static
   asset under style-src 'self' keeps that policy exact.

   This lives in the kit rather than as a script in each site for the same
   reason the panel does. If it were per-site, moving the asset inside dist —
   or renaming it — would mean editing every site repo, which is precisely the
   boundary session 7.5 exists to get right. Sites run it; nobody maintains
   four copies of it.

   Each site's CI runs it and diffs, so a stale copy fails the build. */

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = resolve(dirname(dirname(fileURLToPath(import.meta.url))), "dist/editor/editor.css");
const destination = resolve(process.cwd(), process.argv[2] ?? "public/editor-panel.css");

let bytes;
try {
  bytes = readFileSync(source);
} catch {
  console.error(
    `sitekit-editor-css: ${source} isn't there.\n` +
      "The installed @shaahink/sitekit predates the editor — pin 0.6.0 or later."
  );
  process.exit(1);
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`editor stylesheet → ${process.argv[2] ?? "public/editor-panel.css"} (${bytes.length} bytes)`);
