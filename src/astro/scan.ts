/* Reading the editor's annotations back out of built HTML.
   ---------------------------------------------------------------------------
   Inline editing costs each site a set of `data-sk-edit="hero.tagline"`
   attributes on the elements already holding those values, and one
   `data-sk-collection` on the body saying which content file the page is. That
   is accepted per-site work (PLAN §3.9). What is not accepted is that it rots
   in silence: rename a field in the schema, drop a sentence from the YAML, and
   the annotation still sits in the markup pointing at nothing. The kit already
   notices at runtime — the element goes red and names itself in the console —
   but only for whoever happens to open the page in edit mode.

   310 annotations were checked by hand across four sites on 2026-07-28. At
   twenty sites that is roughly 1,500 nobody re-checks after a redesign, so the
   check moves into the build. See SCALE.md §6.

   This half is the parser, kept apart from the integration so it is pure: a
   string goes in, the annotations come out, and it is unit-tested like
   everything else in the kit.

   Why a tokenizer rather than a regex or a dependency.
   -------------------------------------------------------------------------
   A regex over `<[^>]*data-sk-edit="([^"]*)"` is wrong the first time any
   other attribute on the same element contains a `>` — `title="a > b"` is
   ordinary content, and two of these sites are hand-written prose. A DOM
   parser would be a second dependency for a package whose first one is
   documented as an event (`yaml`, cms/yaml.ts). The subset that actually
   matters here is start tags with quoted attributes in Astro's own output,
   which is about fifty lines and can be tested exactly.

   What it does not do: entity decoding. Astro escapes `&`, `<` and quotes in
   attribute values, and nothing in a content path or a collection name can be
   any of those — the handler's own ENTRY pattern is stricter still. A path
   that needed decoding would be one no editor could ever resolve. */

/** What a page says about itself, in document order. */
export interface PageScan {
  /** Every element carrying `data-sk-collection`. The runtime uses
      `querySelector`, so it only ever sees the first — a second one is a fault
      to report rather than a shape to support. */
  scopes: Scope[];
  /** Every `data-sk-edit` value, duplicates kept: the runtime wires the first
      of a repeated path and refuses the rest, so knowing there were two is the
      whole point. */
  paths: string[];
}

export interface Scope {
  collection: string;
  /** Empty when the element carries no `data-sk-entry` — which is what a
      single-file collection does, and the handler then derives the entry from
      the file name. */
  entry: string;
}

export function scanAnnotations(html: string): PageScan {
  const scopes: Scope[] = [];
  const paths: string[] = [];

  for (const tag of startTags(html)) {
    const collection = tag.attrs.get("data-sk-collection");
    if (collection !== undefined) {
      scopes.push({ collection, entry: tag.attrs.get("data-sk-entry") ?? "" });
    }
    const path = tag.attrs.get("data-sk-edit");
    if (path !== undefined) paths.push(path);
  }

  return { scopes, paths };
}

/* --- the tokenizer ------------------------------------------------------ */

interface StartTag {
  /** Lower-cased, as HTML tag names are matched. */
  name: string;
  /** Lower-cased attribute names to their raw values. A valueless attribute
      reads as the empty string, which is what the DOM does too. */
  attrs: Map<string, string>;
}

/* Elements whose content is text rather than markup. Skipping their bodies is
   not tidiness: Astro inlines small scripts into the page, and the inline
   editor's own bundle contains the literal string "[data-sk-edit]" — scanned
   naively, every page carrying the editor would report an annotation nobody
   wrote. Found by reading a built page rather than by reasoning about one. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

const NAME_START = /[a-zA-Z]/;
const NAME_CHAR = /[^\s/>]/;
const ATTR_NAME_CHAR = /[^\s/>=]/;

function* startTags(html: string): Generator<StartTag> {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) return;

    const next = html[lt + 1];

    /* Comments, doctype, CDATA. A comment ends at `-->` and nothing else;
       everything else in this family ends at the first `>`. */
    if (next === "!") {
      i = html.startsWith("<!--", lt) ? after(html, "-->", lt + 4) : after(html, ">", lt + 2);
      continue;
    }
    if (next === "/") {
      i = after(html, ">", lt + 2);
      continue;
    }
    if (next === undefined || !NAME_START.test(next)) {
      /* A bare `<` in text. The HTML parser treats it as data; so do we. */
      i = lt + 1;
      continue;
    }

    const read = readStartTag(html, lt);
    yield read.tag;
    i = read.end;

    if (!read.selfClosing && RAW_TEXT.has(read.tag.name)) i = skipRawText(html, read.tag.name, i);
  }
}

/** The index just past `needle`, or the end of the string when it is absent —
    an unterminated comment or tag ends the scan rather than looping. */
function after(html: string, needle: string, from: number): number {
  const at = html.indexOf(needle, from);
  return at < 0 ? html.length : at + needle.length;
}

function skipRawText(html: string, name: string, from: number): number {
  /* Case-insensitive without lower-casing the document: `toLowerCase()` can
     change a string's length — 'İ' becomes two code units — which would slide
     every index after it and is exactly the sort of bug that only shows up on
     the Persian half of the fleet. */
  const closer = new RegExp(`</${name}`, "gi");
  closer.lastIndex = from;
  const found = closer.exec(html);
  return found ? found.index : html.length;
}

function readStartTag(html: string, lt: number): { tag: StartTag; end: number; selfClosing: boolean } {
  let i = lt + 1;
  const nameStart = i;
  while (i < html.length && NAME_CHAR.test(html[i] as string)) i++;
  const name = html.slice(nameStart, i).toLowerCase();

  const attrs = new Map<string, string>();
  let selfClosing = false;

  while (i < html.length) {
    while (i < html.length && /\s/.test(html[i] as string)) i++;
    const char = html[i];
    if (char === undefined) break;
    if (char === ">") {
      i++;
      break;
    }
    if (char === "/") {
      /* `/` is only self-closing immediately before `>`; anywhere else it is
         part of an unquoted value and the loop below picks it up. */
      if (html[i + 1] === ">") {
        selfClosing = true;
        i += 2;
        break;
      }
      i++;
      continue;
    }

    const attrStart = i;
    while (i < html.length && ATTR_NAME_CHAR.test(html[i] as string)) i++;
    if (i === attrStart) {
      /* Nothing consumed — a stray `=` at the head of an attribute. Step over
         it rather than spinning. */
      i++;
      continue;
    }
    const attr = html.slice(attrStart, i).toLowerCase();

    while (i < html.length && /\s/.test(html[i] as string)) i++;
    if (html[i] !== "=") {
      attrs.set(attr, "");
      continue;
    }
    i++;
    while (i < html.length && /\s/.test(html[i] as string)) i++;

    const quote = html[i];
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, i + 1);
      const end = close < 0 ? html.length : close;
      attrs.set(attr, html.slice(i + 1, end));
      i = close < 0 ? html.length : close + 1;
    } else {
      const valueStart = i;
      while (i < html.length && !/[\s>]/.test(html[i] as string)) i++;
      attrs.set(attr, html.slice(valueStart, i));
    }
  }

  return { tag: { name, attrs }, end: i, selfClosing };
}
