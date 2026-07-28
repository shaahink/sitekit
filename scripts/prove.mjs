/* Build a real site against this working copy of the kit.
   ---------------------------------------------------------------------------
   Two of the kit's exports only exist inside an Astro build: `editorRoute`
   injects a route and reads the resolved config, and `checkAnnotations` reads
   the built pages back in `astro:build:done`. Unit tests call those hooks
   directly, which proves what they do with the arguments they are handed and
   nothing at all about whether Astro hands them those arguments. Every fact
   the kit has been wrong about here — that `insertDirective` replaces rather
   than merges, that an injected route follows the site's `build.format` —
   came from reading a real build's output.

   So: overlay this checkout's dist onto site-template's installed copy, build
   it, put the installed copy back. Nothing is written to the site except its
   own dist, and the overlay is restored even when the build fails.

   `site-template` and not a client: it is one of the two repos that exist so
   that proving something never has to happen on somebody's business (the
   other is sk-studio). It is also the site that carries every integration the
   kit ships, which is the point of a template.

   Run it by hand before a release — `npm run proof`. Deliberately not part of
   `prepublishOnly`: publishing happens from CI through the npm Trusted
   Publisher, where there is no sibling checkout to build. */

import { cpSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kit = dirname(dirname(fileURLToPath(import.meta.url)));
const site = process.argv[2] ?? join(kit, "..", "site-template");
const installed = join(site, "node_modules", "@shaahink", "sitekit", "dist");
const backup = `${installed}.proof-backup`;

if (!existsSync(join(site, "astro.config.mjs"))) {
  console.error(`no site to build at ${site} — pass one as an argument`);
  process.exit(1);
}
if (!existsSync(join(kit, "dist", "astro", "index.js"))) {
  console.error("build the kit first: npm run build");
  process.exit(1);
}

console.log(`proving ${kit}/dist against ${site}`);

rmSync(backup, { recursive: true, force: true });
cpSync(installed, backup, { recursive: true });

let code = 1;
try {
  rmSync(installed, { recursive: true, force: true });
  cpSync(join(kit, "dist"), installed, { recursive: true });
  code = spawnSync("npm", ["run", "build"], { cwd: site, stdio: "inherit", shell: true }).status ?? 1;
} finally {
  /* The site is left exactly as it was found. A half-overlaid node_modules is
     the sort of thing that gets debugged for an hour a week later. */
  rmSync(installed, { recursive: true, force: true });
  cpSync(backup, installed, { recursive: true });
  rmSync(backup, { recursive: true, force: true });
}

console.log(code === 0 ? "\nproof: the site builds against this kit" : "\nproof: FAILED");
process.exit(code);
