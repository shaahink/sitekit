/* Failing the build when an annotation stops resolving.
   ---------------------------------------------------------------------------
   The kit already detects annotation rot perfectly, at runtime: a
   `data-sk-edit` whose path resolves to nothing turns red on the page and
   names itself in the console. The gap SCALE.md §6 records is that nobody is
   looking — it is seen only by whoever opens that page in edit mode, which is
   the owner, after the redesign that broke it.

   So the same two verdicts move into the build:

     - the path resolves to nothing in the content file
     - the path has no field in the form model

   Both are `judge()`'s "broken" cases in editor/inline.ts, reached the same
   way — `valueAt` over the parsed YAML, `findField` over `formModel()` — so
   the build cannot disagree with the page about what is broken. Everything
   judge() calls "panel" is deliberately *not* checked: a value inside
   `aria-hidden`, one wrapping the design's own spans, one the template
   upper-cases, are all correct annotations that simply cannot be edited in
   place. Failing a build on those would be failing it on working sites.

   Nesting — an annotation inside another annotation — is left to the runtime
   on purpose. It needs a tree rather than a scan, and more to the point it is
   a mis-authoring caught the first time anyone opens the page, where rot is
   the thing that happens later, to a page nobody touched. This checker exists
   for the second.

   One line per site, in astro.config.mjs:

     import { checkAnnotations } from "@shaahink/sitekit/astro";
     import { editable } from "./src/content/schema.js";

     integrations: [checkAnnotations({ collections: editable })]

   It reads the same `editable` map api/content.ts hands the content handler,
   which is why that map has always been a plain Zod module with nothing
   Astro-shaped in it (see any site's src/content/schema.ts). Nothing new is
   declared and nothing can drift: if the build and the editor disagree about
   what is editable, they are reading different objects.

   Why this is its own integration rather than an option on editorRoute().
   `sk-studio` is the case: it still owns a hand-written editor page (SCALE.md
   §9) and it has annotations today. A site should be able to have the check
   without having taken the route, and the route without having annotations at
   all. They answer different questions. */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CollectionConfig } from "../cms/types.js";
import type { Field } from "../cms/fields.js";
import { formModel } from "../cms/form.js";
import { readValues } from "../cms/yaml.js";
import { findField, valueAt } from "../editor/values.js";
import { scanAnnotations, type PageScan, type Scope } from "./scan.js";

/** One thing wrong on one page. `path` is absent when the fault is the page's
    rather than a single annotation's. */
export interface AnnotationProblem {
  /** The built file, relative to the output directory. */
  page: string;
  path?: string;
  message: string;
}

/** What a page's annotations are checked against. */
export interface Resolved {
  fields: Field[];
  values: unknown;
}

/** Returns the content behind a scope, or a sentence saying why there is
    none. Injected so the checking is pure and the file reading is not. */
export type Resolver = (scope: Scope) => Resolved | string;

/* --- the check, with no filesystem in it -------------------------------- */

export function checkPage(page: string, scan: PageScan, resolve: Resolver): AnnotationProblem[] {
  const problems: AnnotationProblem[] = [];
  const say = (message: string, path?: string): void => {
    problems.push({ page, message, ...(path === undefined ? {} : { path }) });
  };

  const scope = scan.scopes[0];

  if (!scope) {
    /* The quietest failure there is. Inline editing reads the collection off
       the page and returns immediately when there isn't one, so every
       annotation below it is inert and nothing anywhere says so — not the
       console, not the element, not the owner. A page that lost its body
       attribute in a layout change looks exactly like a page nobody
       annotated. */
    if (scan.paths.length) {
      say(
        `carries ${count(scan.paths.length, "annotation")} but no data-sk-collection, ` +
          `so none of them is editable and nothing says so at runtime`
      );
    }
    return problems;
  }

  if (scan.scopes.length > 1) {
    const rest = scan.scopes.slice(1).map((other) => other.collection);
    say(
      `has ${scan.scopes.length} elements carrying data-sk-collection; the editor reads the ` +
        `first ("${scope.collection}") and silently ignores ${rest.map((name) => `"${name}"`).join(", ")}`
    );
  }

  const resolved = resolve(scope);
  if (typeof resolved === "string") {
    say(resolved);
    return problems;
  }

  const seen = new Set<string>();
  for (const path of scan.paths) {
    if (seen.has(path)) {
      /* The runtime wires the first and refuses the rest, which is the right
         behaviour and an invisible one: both elements look editable and typing
         in the second does nothing. A duplicated marquee found this on bez. */
      say("appears more than once on this page; only the first would be editable", path);
      continue;
    }
    seen.add(path);

    const value = valueAt(resolved.values, path);
    if (value === undefined || value === null) {
      say("resolves to nothing in the content", path);
      continue;
    }

    if (!findField(resolved.fields, path)) {
      say("has no field in the form model — is it on the collection's omit list?", path);
    }
  }

  return problems;
}

/* --- the integration ---------------------------------------------------- */

export interface AnnotationCheckOptions {
  /** The same map api/content.ts passes to createContentHandler. */
  collections: Record<string, CollectionConfig>;
}

/* Only the properties this integration reads. Astro is a peer rather than a
   dependency, for the reason index.ts gives: six sites already have their own
   copy and pulling in a second to typecheck three property reads would be the
   tail wagging the dog. */
interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface ConfigDoneHook {
  config: { root: URL };
}

interface BuildDoneHook {
  dir: URL;
  logger: Logger;
}

export function checkAnnotations(options: AnnotationCheckOptions) {
  let root: URL | undefined;

  return {
    name: "@shaahink/sitekit:check-annotations",
    hooks: {
      "astro:config:done": ({ config }: ConfigDoneHook) => {
        /* The collections' file paths are repository-relative, the way the
           content handler sends them to GitHub. Resolving them against the
           site root rather than against process.cwd() is what lets the check
           survive a build run from anywhere. */
        root = config.root;
      },

      "astro:build:done": ({ dir, logger }: BuildDoneHook) => {
        const out = fileURLToPath(dir);
        const resolve = contentResolver(options.collections, fileURLToPath(root ?? dir));

        const problems: AnnotationProblem[] = [];
        let pages = 0;
        let annotations = 0;

        for (const page of htmlFiles(out)) {
          const scan = scanAnnotations(readFileSync(join(out, page), "utf8"));
          if (!scan.scopes.length && !scan.paths.length) continue;
          pages++;
          annotations += scan.paths.length;
          problems.push(...checkPage(page, scan, resolve));

          if (scan.scopes.length && !scan.paths.length) {
            /* Not a failure: a page may be scoped ahead of being annotated,
               and the template ships exactly that. It is still worth saying,
               because the other way to arrive here is a redesign that dropped
               every annotation and left the attribute behind. */
            logger.warn(`${page} scopes "${scan.scopes[0]?.collection}" but carries no data-sk-edit`);
          }
        }

        if (problems.length) {
          /* The detail goes through the logger and only a sentence is thrown.
             Astro prints a thrown hook error with its location and stack, and
             a stack into node_modules is noise on top of the one thing that
             matters — which of this site's elements an owner could point at
             and not be able to save. */
          logger.error(
            `${count(problems.length, "editor annotation problem")} across ${count(pages, "page")}:\n` +
              problems
                .map((problem) =>
                  problem.path === undefined
                    ? `  ${problem.page} ${problem.message}`
                    : `  ${problem.page}  data-sk-edit="${problem.path}" ${problem.message}`
                )
                .join("\n")
          );
          throw new Error(
            `${count(problems.length, "editor annotation problem")} — each is an element an owner ` +
              "can point at that would not save. Fix the annotation or the content, or remove it."
          );
        }

        logger.info(`${count(annotations, "annotation")} on ${count(pages, "page")} all resolve`);
      }
    }
  };
}

/** Reads and caches the content behind each scope. One page per entry is the
    common case, but a bilingual site renders two, and `works` on bez is five
    pages over one directory — so both the parsed YAML and the form model are
    kept rather than re-derived per page. */
function contentResolver(collections: Record<string, CollectionConfig>, root: string): Resolver {
  const cache = new Map<string, Resolved | string>();

  return (scope) => {
    const key = `${scope.collection}\u0000${scope.entry}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const answer = load(scope);
    cache.set(key, answer);
    return answer;
  };

  function load(scope: Scope): Resolved | string {
    const config = collections[scope.collection];
    if (!config) {
      const known = Object.keys(collections).map((name) => `"${name}"`).join(", ");
      return `scopes data-sk-collection="${scope.collection}", which is not a collection the editor has (${known})`;
    }

    /* filePath() in cms/handler.ts, mirrored: a directory collection reads
       `${dir}/${entry}.yaml` and a single-file one ignores the entry entirely.
       Mirrored rather than shared because the handler's copy takes repository
       paths for GitHub and this one takes a URL — and because a check that
       guessed differently from the thing it checks would be worse than none. */
    if (!config.dir) {
      const expected = (config.file ?? "").replace(/^.*\//, "").replace(/\.ya?ml$/, "");
      if (scope.entry && scope.entry !== expected) {
        return (
          `says data-sk-entry="${scope.entry}", but "${scope.collection}" is a single file ` +
          `(${config.file}) and the editor would open "${expected}" instead`
        );
      }
    }

    const path = config.dir ? `${config.dir.replace(/\/+$/, "")}/${scope.entry}.yaml` : (config.file as string);
    const text = read(path);
    if (text === undefined) {
      /* `listEntries` accepts .yml and `filePath` only ever asks for .yaml, so
         a .yml entry is listed in the panel and 404s when opened. Saying which
         of the two happened turns a puzzling error into a one-character fix. */
      const alternative = path.replace(/\.yaml$/, ".yml");
      return read(alternative) === undefined
        ? `scopes "${scope.collection}" entry "${scope.entry}", whose content file ${path} does not exist`
        : `scopes "${scope.collection}" entry "${scope.entry}": the editor reads ${path}, and this site has ${alternative}`;
    }

    return {
      fields: formModel(config.schema, { ...(config.omit ? { omit: config.omit } : {}) }),
      values: readValues(text)
    };
  }

  function read(path: string): string | undefined {
    try {
      return readFileSync(join(root, path), "utf8");
    } catch {
      return undefined;
    }
  }
}

/** Every built page, as forward-slashed paths relative to the output dir —
    Windows readdir hands back backslashes, and half of what these paths are
    for is being read in an error message. */
function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split("\\").join("/"))
    .filter((entry) => entry.endsWith(".html"))
    .sort();
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
