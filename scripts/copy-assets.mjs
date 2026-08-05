/* The one non-TypeScript thing the kit ships.
   ---------------------------------------------------------------------------
   tsc emits JavaScript and declarations and knows nothing about CSS, so the
   editor's stylesheet is copied into dist by hand. It belongs in the published
   package because that is the whole point of the lift: one stylesheet in the
   kit, copied into each site's public/ by that site's `npm run editor`, CI
   diffing it — so the panel cannot drift into four versions of itself.

   Node's own fs, no dependency. Run by `npm run build`. */

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/* The .astro route is here for the same reason as the stylesheets and a
   different one besides: tsc does not know the format, and neither should it —
   a site's own Astro build compiles this file, which is the only way an
   injected route can inherit that site's build.format, CSP and asset
   pipeline. It ships as source on purpose. */
const assets = [
  ["src/editor/editor.css", "dist/editor/editor.css"],
  ["src/editor/inline.css", "dist/editor/inline.css"],
  ["src/astro/edit.astro", "dist/astro/edit.astro"],
  ["src/astro/Credit.astro", "dist/astro/Credit.astro"],
  ["src/astro/virtual.d.ts", "dist/astro/virtual.d.ts"]
];

for (const [from, to] of assets) {
  mkdirSync(dirname(`${root}/${to}`), { recursive: true });
  copyFileSync(`${root}/${from}`, `${root}/${to}`);
  console.log(`copied ${from} → ${to}`);
}
