/* Failing the build when a placeholder is still in the content.
   ---------------------------------------------------------------------------
   The case for this is not a rule. It was on the first screen of a live
   client's editor, in an ordinary editable text field, and it was measured
   there: `hello@elfine.example`, in the Contact section of Elfine's shared
   collection, on every page of her site since the day it was built. Nothing in
   the build, the editor or the review widget had ever said a word about it.

   CLAUDE.md already records why this class of fault is invisible: *"our
   owner-ask lists are generated from what a client's material lacked, never
   from what the site asserts, so a confidently-wrong value is invisible to the
   process that catches missing ones."* A build-time refusal is the process
   that catches asserted ones. This is U12's question answered once — a trap
   that becomes a check stops being re-litigated.

   `checkAnnotations` is the precedent and the shape: one line in
   astro.config.mjs, reading the same `editable` map api/content.ts hands the
   content handler, so nothing new is declared and nothing can drift.

     import { checkPlaceholders } from "@shaahink/sitekit/astro";
     import { editable } from "./src/content/schema.js";

     integrations: [checkPlaceholders({ collections: editable })]

   Three decisions, taken with eyes open because session 23 named all three:

   **It reads the content files, not the built pages.** Cheaper — no output to
   walk — and it catches a value on a page that does not exist yet, which is
   exactly where a placeholder hides longest. What it misses is a placeholder
   baked into a *template* rather than into content, and that is a real gap
   left open on purpose: this gate is over the values an owner can edit, which
   is the same set the editor writes and the annotation checker resolves. A
   second checker over built HTML would report every `example.com` in the
   fleet's own documentation prose.

   **It runs before the build rather than after it.** `checkAnnotations` needs
   the output and so must wait for it; this needs nothing but the content, so
   it answers in about a second instead of after a full build. And it runs on
   `build` only — a dev server that refuses to start because a paragraph says
   TODO would be a check that gets removed rather than a check that gets
   obeyed.

   **The escape is part of the design, not an afterthought.** A string that is
   genuinely meant to be there must have somewhere to say so, or the gate gets
   switched off wholesale the first time it is wrong — which is how a check
   becomes a comment. So it names a *place*, in the site's own config, in the
   spelling the form model already uses:

     checkPlaceholders({ collections: editable, allow: ["site:contact.email"] })

   A place rather than a value, deliberately. A value-based escape would cover
   the same string silently wherever it later turned up; a place-based one is
   greppable against the schema, and the refusal below prints the exact line to
   add, which is what makes the escape get used instead of the gate getting
   deleted. */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { entryOf } from "../cms/entries.js";
import type { CollectionConfig } from "../cms/types.js";
import { templateOf } from "../editor/values.js";
import { readValues } from "../cms/yaml.js";

/** One placeholder, where it is and why it counts as one. */
export interface PlaceholderProblem {
  /** `site/site.en` — the collection and entry, as the panel names a page. */
  entry: string;
  /** `contact.email`, the concrete path including any list indices. */
  path: string;
  /** What the field actually holds, trimmed to something printable. */
  value: string;
  /** The sentence saying why this string is a placeholder and not content. */
  why: string;
  /** The line to add to `allow` if it is meant to be there. */
  escape: string;
}

/* What a placeholder looks like, and why each one is on the list.
   ---------------------------------------------------------------------------
   Five patterns and no more. Every one of them either names a domain the IANA
   has reserved so that nobody can own it, or is a word whose only reason to be
   in a sentence is that somebody meant to come back to it. The temptation is
   to add "555", "your name", "123-456-7890" and a dozen others; those are
   guesses about what a placeholder looks like, and a gate that is wrong on
   real content is a gate somebody switches off. */
const PATTERNS: Array<{ test: RegExp; why: string }> = [
  {
    /* RFC 6761 reserves `.example` precisely so that it can never resolve.
       A hostname or an address ending in it is documentation, always. */
    test: /[\w-]+\.example(?![\w-])/i,
    why: "`.example` is a reserved domain that can never resolve — it is documentation, not an address"
  },
  {
    /* RFC 2606's second-level reservations, same reasoning. */
    test: /\bexample\.(?:com|org|net|edu)(?![\w-])/i,
    why: "`example.com` and its siblings are reserved for documentation and belong to nobody"
  },
  {
    test: /\blorem\b/i,
    why: "lorem ipsum is filler text"
  },
  {
    /* Upper case and whole-word, both on purpose: an article about a to-do
       list is ordinary content, and "TODO" shouted in a value is not. */
    test: /\b(?:TODO|FIXME|TBD)\b/,
    why: "a note to come back to this, left in the content"
  },
  {
    test: /\bx{3,}\b/i,
    why: "a row of x's is a value nobody typed on purpose"
  }
];

/* --- the check, with no filesystem in it -------------------------------- */

/** Every placeholder in one entry's parsed content.

    Exported so the whole gate is testable — and runnable over a checkout —
    without an Astro build, which is how the fleet-wide census that justified
    the pattern list was taken. */
export function checkEntry(
  entry: string,
  values: unknown,
  allowed: (path: string) => boolean
): PlaceholderProblem[] {
  const problems: PlaceholderProblem[] = [];
  walk(values, "", (path, value) => {
    if (allowed(path)) return;
    for (const pattern of PATTERNS) {
      if (!pattern.test.test(value)) continue;
      problems.push({
        entry,
        path,
        value: value.length > 80 ? `${value.slice(0, 77)}…` : value,
        why: pattern.why,
        escape: `${entry.split("/")[0]}:${templateOf(path)}`
      });
      /* One verdict per field. A string matching two patterns is still one
         thing to fix, and two rows for it would make the list read as twice
         the problem it is. */
      return;
    }
  });
  return problems;
}

/** Every string in a parsed content document, with the path that reaches it —
    the same `a.b[0].c` spelling the form model, the annotations and the editor
    all use, so a path printed here can be pasted into `allow` or searched for
    in the schema. */
function walk(value: unknown, path: string, say: (path: string, value: string) => void): void {
  if (typeof value === "string") {
    if (value.trim()) say(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, say));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walk(child, path ? `${path}.${key}` : key, say);
    }
  }
}

/** Whether a path in an entry has been allowed.

    Two spellings are accepted and both are honest: `collection:path` covers
    every entry in the collection, which is what a bilingual site wants because
    the same field is the same field in both languages, and
    `collection/entry:path` covers one. Indices fold — allowing
    `works:items[].link` allows every row, and allowing `works:items[2].link`
    allows exactly the third. */
export function allowsPath(allow: string[], entry: string, path: string): boolean {
  const collection = entry.split("/")[0] ?? entry;
  const template = templateOf(path);
  return allow.some(
    (rule) =>
      rule === `${collection}:${path}` ||
      rule === `${collection}:${template}` ||
      rule === `${entry}:${path}` ||
      rule === `${entry}:${template}`
  );
}

/* --- the integration ---------------------------------------------------- */

export interface PlaceholderCheckOptions {
  /** The same map api/content.ts passes to createContentHandler. */
  collections: Record<string, CollectionConfig>;
  /** Places a placeholder-shaped string is genuinely meant to be, as
      `collection:path` or `collection/entry:path`. The refusal prints the
      exact line to add. */
  allow?: string[];
}

interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface SetupHook {
  command: string;
}

interface ConfigDoneHook {
  config: { root: URL };
  logger: Logger;
}

/** Every entry a collection has, read off the filesystem the way `listEntries`
    reads it off GitHub — same extensions, same sort, so the build and the
    panel cannot disagree about what a site's pages are. */
export function entriesOnDisk(config: CollectionConfig, root: string): Array<{ id: string; path: string }> {
  if (!config.dir) {
    const file = config.file;
    return file ? [{ id: entryOf(config), path: file }] : [];
  }
  const dir = config.dir.replace(/\/+$/, "");
  let names: string[];
  try {
    names = readdirSync(join(root, dir), { encoding: "utf8" });
  } catch {
    /* A collection whose directory is not there is a fault, and it is one the
       build and the annotation checker both already report. Reporting it a
       third time here would make this gate's output about something other than
       placeholders. */
    return [];
  }
  return names
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => ({ id: name.replace(/\.ya?ml$/, ""), path: `${dir}/${name}` }));
}

/** The whole census for one checkout: every collection, every entry, every
    string. Exported because it is what the fleet-wide run uses, and because a
    gate whose answer can only be got by running a build is a gate nobody
    measures before turning on. */
export function findPlaceholders(
  collections: Record<string, CollectionConfig>,
  root: string,
  allow: string[] = []
): { problems: PlaceholderProblem[]; entries: number } {
  const problems: PlaceholderProblem[] = [];
  let entries = 0;

  for (const [name, config] of Object.entries(collections)) {
    for (const entry of entriesOnDisk(config, root)) {
      let text: string;
      try {
        text = readFileSync(join(root, entry.path), "utf8");
      } catch {
        continue;
      }
      entries++;
      const id = `${name}/${entry.id}`;
      problems.push(...checkEntry(id, readValues(text), (path) => allowsPath(allow, id, path)));
    }
  }

  return { problems, entries };
}

export function checkPlaceholders(options: PlaceholderCheckOptions) {
  let building = false;

  return {
    name: "@shaahink/sitekit:check-placeholders",
    hooks: {
      "astro:config:setup": ({ command }: SetupHook) => {
        /* `dev` and `preview` are left alone. Somebody with a half-written
           paragraph on screen needs the dev server more than the fleet needs a
           refusal, and the thing this gate is protecting is what ships. */
        building = command === "build";
      },

      "astro:config:done": ({ config, logger }: ConfigDoneHook) => {
        if (!building) return;
        const root = fileURLToPath(config.root);
        const { problems, entries } = findPlaceholders(
          options.collections,
          root,
          options.allow ?? []
        );

        if (!problems.length) {
          logger.info(`no placeholder copy in ${count(entries, "content entry")}`);
          return;
        }

        /* The detail through the logger and a sentence thrown, for the reason
           checkAnnotations gives: Astro prints a thrown hook error with its
           stack, and a stack into node_modules is noise on top of the one
           thing that matters. What matters here is which field holds what, and
           the line that says it is meant to. */
        logger.error(
          `${count(problems.length, "placeholder")} in this site's content:\n` +
            problems
              .map(
                (problem) =>
                  `  ${problem.entry}  ${problem.path} = ${JSON.stringify(problem.value)}\n` +
                  `    ${problem.why}\n` +
                  `    if it is meant to be there: allow: ["${problem.escape}"]`
              )
              .join("\n")
        );
        throw new Error(
          `${count(problems.length, "placeholder")} in this site's content — each is a string a ` +
            "visitor would read as real. Replace it, or add its path to checkPlaceholders' allow list."
        );
      }
    }
  };
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
