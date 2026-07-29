/* Lift the fleet's three widget string tables out of the sites that own them.
   ---------------------------------------------------------------------------
   Run once, when `feedback-chrome.js` moved into the kit (0.16.0). Elfine's
   French and nimagiti's Farsi were written for those two sites and are good;
   the instruction was to lift them *verbatim*, and a hand-transcribed
   twenty-six-string table with typographic apostrophes and a Persian numeral
   in it is exactly the kind of thing that arrives one character wrong and is
   never noticed. So the tables are extracted mechanically here and committed
   as a test fixture, and `test/widget-strings.test.ts` asserts the kit's
   tables still equal them character for character.

   The fixture is committed rather than re-extracted at test time on purpose:
   the kit's CI has no sibling checkouts, and after 0.16.0 lands the source
   files it reads are deleted from those repos. The fixture is the record.

       node scripts/extract-widget-strings.mjs ..           # checkout root

   Not part of any build. Kept because it says where the tables came from. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kit = dirname(dirname(fileURLToPath(import.meta.url)));
const root = process.argv[2] ?? join(kit, "..");

/* Which site owns which table, and the flag its fork branches on. `en` is the
   else-branch of both forks and the whole table on the four monolingual
   sites — site-template is the one to read it from, being the copy the other
   three are comment-only edits of. */
const sources = [
  { locale: "en", site: "site-template", branch: null },
  { locale: "fr", site: "elfine-site", branch: "FR" },
  { locale: "fa", site: "nimagiti", branch: "FA" }
];

/* The tables are object literals in a browser script, so there is nothing to
   import them from. Slice out the literal and read the key/value pairs with a
   regex over exactly that slice — not over the file, where `T.wholePageLabel`
   and every other mention would match too. */
function table(source, branch) {
  const start = source.indexOf("var T = ");
  if (start < 0) throw new Error("no `var T = ` in this file");

  let literal;
  if (branch) {
    /* `var T = FR ? { …translated… } : { …english… };` — take the first. */
    const open = source.indexOf("{", source.indexOf(`${branch} ? `, start));
    const close = source.indexOf("\n  } : {", open);
    if (open < 0 || close < 0) throw new Error(`no ${branch} branch`);
    literal = source.slice(open, close);
  } else {
    literal = source.slice(source.indexOf("{", start), source.indexOf("\n  };", start));
  }

  const strings = {};
  const pair = /^\s{4}(\w+): "((?:[^"\\]|\\.)*)"/gm;
  for (const [, key, value] of literal.matchAll(pair)) {
    strings[key] = JSON.parse(`"${value}"`);
  }
  if (Object.keys(strings).length === 0) throw new Error("matched no strings");
  return strings;
}

const fixture = {
  _source:
    "Extracted from the fleet's own src/scripts/feedback-chrome.js by " +
    "scripts/extract-widget-strings.mjs on 2026-07-29, when the chrome moved " +
    "into the kit. These are the strings six live sites were serving.",
  _sites: {}
};

for (const { locale, site, branch } of sources) {
  const path = join(root, site, "src", "scripts", "feedback-chrome.js");
  const strings = table(readFileSync(path, "utf8"), branch);
  fixture._sites[locale] = `${site}/src/scripts/feedback-chrome.js`;
  fixture[locale] = strings;
  console.log(`${locale}: ${Object.keys(strings).length} strings from ${site}`);
}

const out = join(kit, "test", "fixtures", "widget-strings.forked.json");
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
console.log(`wrote ${out}`);
