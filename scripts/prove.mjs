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
   too and expects vercel.json not to move. `sitekit-normalize` joined it at
   0.16.0 on the same terms and expects `src/content` not to move.

   Run it by hand before a release — `npm run proof`.

   **Amended 2026-07-30 (session 16, F10).** The reason given here used to be
   that publishing happens from CI through the npm Trusted Publisher, "where
   there is no sibling checkout to build". That has stopped being a reason: a
   second `actions/checkout` makes one, `site-template` is public so it needs no
   token, and F9 has since given the kit a `ci.yml` that could carry the job.
   What is left is a cost rather than an obstacle — this installs and builds a
   whole Astro site, and it wants care around the overlay-and-restore before it
   runs unattended, which is why it is written into 0.17.0's scope instead.
   Amended in place rather than left standing, because a comment whose reason has
   quietly stopped being true is how a fleet stops questioning it. */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kit = dirname(dirname(fileURLToPath(import.meta.url)));
const site = process.argv[2] ?? join(kit, "..", "site-template");
const home = join(site, "node_modules", "@shaahink", "sitekit");

/* Two things are overlaid, not one. `dist` is the code; `package.json` is the
   `exports` map that decides which of it a site can reach at all. Overlaying
   only dist was enough for four releases and then 0.16.0 added a subpath —
   `@shaahink/sitekit/widget/chrome` — and the proof could not see it: the
   files were there, the installed release's exports map was not, and Astro
   failed to resolve an import that is correct. A proof that cannot prove a new
   entry point is a proof of the last release. */
const overlays = [
  { path: join(home, "dist"), from: join(kit, "dist") },
  { path: join(home, "package.json"), from: join(kit, "package.json") }
];

if (!existsSync(join(site, "astro.config.mjs"))) {
  console.error(`no site to build at ${site} — pass one as an argument`);
  process.exit(1);
}
if (!existsSync(join(kit, "dist", "astro", "index.js"))) {
  console.error("build the kit first: npm run build");
  process.exit(1);
}

console.log(`proving ${kit}/dist against ${site}`);

for (const overlay of overlays) {
  overlay.backup = `${overlay.path}.proof-backup`;
  rmSync(overlay.backup, { recursive: true, force: true });
  cpSync(overlay.path, overlay.backup, { recursive: true });
}

let code = 1;
try {
  for (const { path, from } of overlays) {
    rmSync(path, { recursive: true, force: true });
    cpSync(from, path, { recursive: true });
  }
  code = spawnSync("npm", ["run", "build"], { cwd: site, stdio: "inherit", shell: true }).status ?? 1;
} finally {
  /* The site is left exactly as it was found. A half-overlaid node_modules is
     the sort of thing that gets debugged for an hour a week later. */
  for (const { path, backup } of overlays) {
    rmSync(path, { recursive: true, force: true });
    cpSync(backup, path, { recursive: true });
    rmSync(backup, { recursive: true, force: true });
  }
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

/* `sitekit-normalize` is the same shape one gate along: CI runs it and then
   `git diff --exit-code -- src/content`, so the proof is that a site whose
   content is at the fixed point comes out of a run untouched. Every file is
   read before and compared after rather than trusting the command's own count,
   and any file it did move is put back — the same promise the vercel.json half
   makes, and it matters more here because content is somebody's words. */
const contentRoot = join(site, "src", "content");
function contentFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) contentFiles(path, out);
    else if (/\.ya?ml$/.test(entry.name)) out.push(path);
  }
  return out;
}

const before = new Map(contentFiles(contentRoot).map((path) => [path, readFileSync(path)]));
let normalize = 1;
try {
  const run = spawnSync(process.execPath, [join(kit, "bin", "normalize.mjs")], {
    cwd: site,
    stdio: "inherit",
    shell: false
  });
  const moved = [...before].filter(([path, bytes]) => !readFileSync(path).equals(bytes));
  if (run.status !== 0) normalize = run.status ?? 1;
  else if (moved.length) {
    console.error(
      `sitekit-normalize rewrote ${moved.length} content file(s) — the site's committed ` +
        "content is not at the normalizer's fixed point, so its CI would fail:\n" +
        moved.map(([path]) => `  ${path}`).join("\n")
    );
    normalize = 1;
  } else normalize = 0;
} finally {
  for (const [path, bytes] of before) writeFileSync(path, bytes);
}

const failed = code !== 0 || headers !== 0 || normalize !== 0;
console.log(
  failed
    ? "\nproof: FAILED"
    : "\nproof: the site builds against this kit, and sitekit-headers and sitekit-normalize both reproduce what it has committed"
);
process.exit(failed ? 1 : 0);
