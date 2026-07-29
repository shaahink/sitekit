#!/usr/bin/env node
/* Rewrite every content file in its normalized form.
   ---------------------------------------------------------------------------
   Usage, from a site root:  sitekit-normalize [directory]      (src/content)

   The editor writes YAML back through `yaml`'s document API, which preserves
   comments and each scalar's style but emits its own line breaks. Against a
   hand-authored file that means the first save reflows unrelated long lines and
   buries the owner's actual change in a hundred-line diff — which would defeat
   the point, since reviewing those edits as readable diffs is the safety net
   under the whole feature.

   So the reflow happens once, in its own reviewed commit. After it, `normalize`
   is a fixed point and every editor write is minimal. Each site's CI runs this
   and diffs, the same way it does for vercel.json: a hand edit that
   un-normalizes a file fails the build instead of quietly waiting to ambush the
   next owner edit.

   This replaces six copies of scripts/normalize-content.mjs. Unlike
   emit-headers, which had reached four distinct files by hash before it moved,
   these six were still byte-identical — which is the cheap moment to move
   something, not the late one. The `npm run content` name does not change, so
   the CI gate above does not either.

   The one thing that had to change is how the content directory is found. The
   per-site script resolved `../src/content` from its own location and then
   undid Node's URL pathname on Windows by hand — `replace(/^\/([A-Za-z]:)/, …)`
   — because a drive letter comes back with a leading slash. A command runs from
   the site root instead, so the path is `resolve(cwd, …)` and the workaround
   goes away with the copies. It also means a site whose content lives somewhere
   else says so as an argument rather than by editing a script. */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { normalize } from "../dist/cms/index.js";

const root = resolve(process.cwd(), process.argv[2] ?? join("src", "content"));

try {
  if (!statSync(root).isDirectory()) throw new Error("not a directory");
} catch (error) {
  console.error(
    `sitekit-normalize: no content directory at ${root}\n` +
      "Run it from a site root, or pass the directory as an argument.\n" +
      String(error?.message ?? error)
  );
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.ya?ml$/.test(name)) out.push(path);
  }
  return out;
}

let changed = 0;
for (const file of walk(root)) {
  /* Windows checkouts are CRLF because core.autocrlf converts on the way out,
     but git stores LF and the editor reads and writes through GitHub's Contents
     API, which deals in the stored bytes. Normalize in that form, and write it
     back that way — git converts again on checkout. */
  const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  let output;
  try {
    output = normalize(source);
  } catch (error) {
    /* `normalize()` says what is wrong with the YAML and cannot know where it
       read it from, so the command that opened the file says that part. The
       per-site script this replaces let the throw escape: on a fleet with
       thirty-two content files, CI printed a parse error and a stack through
       dist/cms/yaml.js with no filename anywhere in it. Found by breaking one
       on purpose, which is the only way anybody would ever see it. */
    console.error(
      `sitekit-normalize: ${relative(root, file) || file}\n  ${error?.message ?? error}`
    );
    process.exit(1);
  }
  if (output === source) continue;
  writeFileSync(file, output, "utf8");
  changed++;
}

console.log(
  changed === 0 ? "content already normalized" : `content normalized: ${changed} file(s) rewritten`
);
