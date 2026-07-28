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

const assets = [
  ["src/editor/editor.css", "dist/editor/editor.css"],
  ["src/editor/inline.css", "dist/editor/inline.css"]
];

for (const [from, to] of assets) {
  mkdirSync(dirname(`${root}/${to}`), { recursive: true });
  copyFileSync(`${root}/${from}`, `${root}/${to}`);
  console.log(`copied ${from} → ${to}`);
}
