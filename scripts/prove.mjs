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

   The bins have the same problem for the same reason: `sitekit-headers` reads
   a site's config from its cwd and writes a file the site commits, and nothing
   a unit test can call proves that. So the proof runs it against the template
   too and expects vercel.json not to move.

   Run it by hand before a release — `npm run proof`. Deliberately not part of
   `prepublishOnly`: publishing happens from CI through the npm Trusted
   Publisher, where there is no sibling checkout to build. */

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/* The second half: the commands a site runs.
   `sitekit-headers` regenerates a file the site commits, so the proof is that
   running it changes nothing — the same shape CI uses, and the reason the six
   copies of scripts/emit-headers.mjs could be deleted at all. The site's own
   vercel.json is restored either way, so a failure leaves a message rather
   than a dirty checkout.

   Run through node directly rather than through node_modules/.bin: the shim
   there belongs to the site's *installed* kit, which is not the code under
   proof. The name that shim carries is checked by test/bin.test.ts instead. */
const vercelJsonPath = join(site, "vercel.json");
const committed = readFileSync(vercelJsonPath);
let headers = 1;
try {
  const run = spawnSync(process.execPath, [join(kit, "bin", "headers.mjs")], {
    cwd: site,
    stdio: "inherit",
    shell: false
  });
  const emitted = readFileSync(vercelJsonPath);
  if (run.status !== 0) headers = run.status ?? 1;
  else if (!emitted.equals(committed)) {
    console.error("sitekit-headers rewrote vercel.json — the emitter and the committed file disagree");
    headers = 1;
  } else headers = 0;
} finally {
  writeFileSync(vercelJsonPath, committed);
}

const failed = code !== 0 || headers !== 0;
console.log(
  failed
    ? "\nproof: FAILED"
    : "\nproof: the site builds against this kit, and sitekit-headers reproduces its vercel.json"
);
process.exit(failed ? 1 : 0);
