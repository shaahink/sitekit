#!/usr/bin/env node
/* Emit a site's host configuration from its own headers.config.mjs.
   ---------------------------------------------------------------------------
   Usage, from a site root:  sitekit-headers [--cloudflare [directory]]

   Writes vercel.json, always, in the exact form the six sites already commit.
   With --cloudflare it also writes _headers and _redirects — into public/ by
   default, because Astro copies that directory into dist/ and Cloudflare Pages
   reads both files from the build output root — and functions/_middleware.js,
   which goes to the site root whatever that directory is, because Pages reads
   functions/ from the repository rather than from the build output.

   The middleware is not a fourth spelling of the same thing: _headers is not
   applied to anything a Function returns, so on Cloudflare it is the only way
   the API responses get the headers the config declares. Session 9.5 Task 3
   finding 1 measured five of five on the static half and none on the other.

   This replaces six copies of scripts/emit-headers.mjs. They had not drifted in
   logic — normalised, all six were the same eleven lines — but they were four
   distinct files by hash, and the next change to them would have been logic:
   session 9.5's Task 3 needs the Cloudflare artefacts, and writing that six
   times is how a fleet ends up with six answers. The kit holds the emitting;
   headers.config.mjs stays the site's, because *what* a site sends is content
   and *how* it is spelled for a host is not.

   The config is deliberately not imported from the kit. It is plain data, so a
   site's headers can be read without resolving a dependency — which is also
   what lets this command run against a checkout that has never been installed.

   --cloudflare exists so that the emitters the kit has shipped since 0.2.0 stop
   being theoretical. They were written, exported, and never once invoked; the
   fleet has never produced a _headers file. That is a mechanism nobody has
   tested, which is exactly what session 9.5 found wrong with PLAN §3.4's
   promise. Invoking them is not the same as serving them — this writes files
   and reads them back, and nothing here has been through an edge. */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  cloudflareHeaders,
  cloudflareMiddleware,
  cloudflareRedirects,
  vercelJson
} from "../dist/headers/index.js";

const args = process.argv.slice(2);
const flag = args.indexOf("--cloudflare");
const cloudflare = flag !== -1;
/* The directory is the argument after the flag, unless that argument is
   another flag. `--cloudflare` alone means public/. */
const next = cloudflare ? args[flag + 1] : undefined;
const cloudflareDir = next && !next.startsWith("--") ? next : "public";

const root = process.cwd();
const configPath = resolve(root, "headers.config.mjs");

let config;
try {
  /* pathToFileURL, not the bare path: on Windows a drive letter reads as a
     URL scheme and import() rejects it. */
  const module = await import(pathToFileURL(configPath).href);
  config = module.default ?? module;
} catch (error) {
  console.error(
    `sitekit-headers: could not read ${configPath}\n` +
      "Run it from a site root — the file next to package.json that default-exports\n" +
      "the site's headers. See site-template/headers.config.mjs for the shape.\n" +
      String(error?.message ?? error)
  );
  process.exit(1);
}

if (!config || !Array.isArray(config.headers)) {
  console.error(
    `sitekit-headers: ${configPath} does not default-export a config with a headers array.`
  );
  process.exit(1);
}

/* Every artefact is rendered before any of them is written, so a config the
   emitters refuse leaves the site's committed files exactly as they were. A
   half-emitted vercel.json is worse than no run at all. */
const artefacts = [];
try {
  artefacts.push(["vercel.json", vercelJson(config)]);

  if (cloudflare) {
    artefacts.push([join(cloudflareDir, "_headers"), cloudflareHeaders(config)]);
    /* An empty _redirects file says the same thing as no file and costs a
       confusing diff, so a site with no redirects gets none. */
    if (config.redirects?.length) {
      artefacts.push([join(cloudflareDir, "_redirects"), cloudflareRedirects(config)]);
    }
    /* Root-relative on purpose: functions/ is read from the repository at build
       time, so it does not follow --cloudflare's directory into dist/. */
    artefacts.push([join("functions", "_middleware.js"), cloudflareMiddleware(config)]);
  }
} catch (error) {
  /* A refusal is a sentence about this site's config, not a bug in the kit.
     Node's default handler would print a stack through dist/headers/index.js
     on top of it, which buries the one line that says what to change. */
  console.error(`sitekit-headers: ${error?.message ?? error}\n  in ${configPath}`);
  process.exit(1);
}

for (const [name, text] of artefacts) {
  const destination = isAbsolute(name) ? name : resolve(root, name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, text);
  console.log(`${name} ← headers.config.mjs (${text.length} bytes)`);
}
