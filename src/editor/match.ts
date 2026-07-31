/* The matcher, with nothing around it.
   ---------------------------------------------------------------------------
   A3.1 put all of this at the top of `search.ts`, beside the field it draws,
   and that was right while the only thing searching was the panel. A3.2 gives
   the *server* the same job across every entry, and a server that imported
   `search.ts` would import what `search.ts` imports: `dom.ts`, and through
   `strings.ts` the whole three-language string table — 1,149 lines of panel
   copy pulled into every site's serverless bundle to reach forty lines of
   arithmetic. So the arithmetic moved here and the drawing stayed there.

   **This file is a leaf on purpose.** It imports a type from `cms/fields.ts`
   and two pure readers from `values.ts`, and it must never import anything
   that touches `document`, `window` or `fetch` — that is the whole property
   that lets one matcher answer for both halves. One matcher is the point: a
   word that finds a field on the page in front of the owner has to find the
   same field on the page beside it, and two implementations of "does this
   match" are two implementations that drift.

   Nothing here writes. The panel hands `searchEntry` the *same* document
   object every control types into, so a fold that normalised in place would
   rewrite an owner's Persian and the first anyone would know is a commit.
   `test/editor-search.test.ts` says so in bytes. */

import type { Field } from "../cms/fields.js";
import { retarget, valueAt } from "./values.js";

/** One field the search can offer, with everything the result row says about
    it already worked out. */
export interface SearchHit {
  /** The concrete path, which is what `[data-path]` carries on the control —
      so picking a result is a `querySelector` and nothing more. */
  path: string;
  /** The field's own label, as the panel draws it. */
  label: string;
  /** The sections it sits inside, outermost first: `["Rooms", "Room 2"]`. */
  where: string[];
  /** Where in the label the query matched, if it did. */
  labelMatch?: Span;
  /** The words around a match in the field's current value. Absent when only
      the label matched — there is nothing useful to quote. */
  snippet?: Snippet;
}

export interface Span {
  from: number;
  to: number;
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
  /** Whether text was cut off at either end, so the row can say so. */
  cutStart: boolean;
  cutEnd: boolean;
}

/* --- folding, and the map that makes it safe ------------------------------ */

/** A folded string beside the offsets each of its characters came from.
    -------------------------------------------------------------------------
    The map is the whole reason this is not a `toLowerCase().indexOf()`. A fold
    that *deletes* a character — a run of whitespace collapsing to one space
    here, and in A3.3 a zero-width non-joiner going entirely — moves every
    offset after it, so an index found in the folded text names the wrong place
    in the real one. Quoting the owner's own words back at them off a shifted
    index is how a search comes to underline the wrong half of a sentence.

    So every folded character remembers the source code point it came from, and
    a match is mapped back through it before anything is read out of the
    original string. The original is never modified, and nothing in this file
    is on the write path — the stored bytes are the ones the file had. */
export interface Folded {
  text: string;
  /** Source offset each folded character starts at. */
  start: number[];
  /** Source offset each folded character ends at. */
  end: number[];
}

/** What one code point folds to, for the purpose of comparison only.

    Deliberately thin at this stage: case, and any run of whitespace as a
    single space so that a phrase still matches across the line breaks a YAML
    block scalar puts in. **A3.3 extends exactly this function** — ZWNJ,
    tanween, Arabic-versus-Persian ye and kaf, Persian versus Latin digits —
    and the machinery it needs is the deletion case, which is already here and
    already tested. (It moved from `search.ts` to this file in A3.2; it is
    still the one function to extend, and now extending it fixes the server's
    search and the panel's in the same edit, which is the argument for the
    move.)

    Three of those four the browser's own matcher turns out to do already
    (measured: `معمولا` finds `معمولاً`, `کتابها` finds `کتاب‌ها`, `123` finds
    `۱۲۳`); the kaf it does not. None of that helps here, because this file is
    its own matcher — it is recorded because it says what an owner expects. */
function foldChar(ch: string): string {
  if (/\s/.test(ch)) return " ";
  return ch.toLowerCase();
}

export function fold(source: string): Folded {
  let text = "";
  const start: number[] = [];
  const end: number[] = [];
  let at = 0;
  /* By code point, not by code unit: a surrogate pair is one character to fold
     and its two units must map to the same source span. */
  for (const ch of source) {
    const from = at;
    at += ch.length;
    const mapped = foldChar(ch);
    /* A collapsed run of whitespace emits one space and then nothing, which is
       the deletion case the map exists for. */
    if (mapped === " " && text.endsWith(" ")) continue;
    for (let i = 0; i < mapped.length; i++) {
      start.push(from);
      end.push(at);
    }
    text += mapped;
  }
  return { text, start, end };
}

/** Where `query` sits inside `source`, in `source`'s own offsets, or null.
    Both sides are folded, so the comparison is on the folded text and the
    answer is on the real one. */
export function findIn(source: string, query: Folded): Span | null {
  if (!query.text) return null;
  const haystack = fold(source);
  const at = haystack.text.indexOf(query.text);
  if (at === -1) return null;
  const last = at + query.text.length - 1;
  return { from: haystack.start[at] ?? 0, to: haystack.end[last] ?? source.length };
}

/** The query, folded once for the whole pass. Trimmed at the source rather
    than after folding, so the map stays aligned with the text it describes —
    and a query that is spaces alone folds to nothing and matches nothing,
    rather than matching every field on the page. */
export function foldQuery(query: string): Folded {
  return fold(query.trim());
}

/* --- what there is to search --------------------------------------------- */

/** One searchable field, before anything has been searched for. */
export interface Candidate {
  path: string;
  label: string;
  where: string[];
  /** The field's current value in full, as the owner would read it — never
      truncated, because this is the string the query is compared against and a
      trimmed one would quietly stop finding anything past its own end. Empty
      for the kinds that have no words in them. */
  text: string;
}

export interface SearchOptions {
  /** What a section's on/off switch is called on screen. The schema's own
      label for it is usually "visible", which is not the word the panel draws
      — see `sectionSwitch` — and searching should find what is written, not
      what the file happens to call it. */
  toggleLabel?: string;
  /** How many hits to hand back. The list is a list an owner reads, and a
      single letter matches every field on the page. */
  limit?: number;
}

/** Every field on screen, in the order the panel drew them.
    -------------------------------------------------------------------------
    Array rows are expanded against the real values through `retarget`, exactly
    as `render` draws them and `emptyRequired` walks them, so the third slide's
    caption is offered in its own right and its result row says "Slides — Slide
    3" rather than the template it came from. */
export function entryFields(
  fields: Field[],
  values: unknown,
  options: SearchOptions = {}
): Candidate[] {
  const out: Candidate[] = [];
  const walk = (field: Field, where: string[]): void => {
    if (field.kind === "group") {
      const inside = [...where, field.label];
      /* The switch is not in `fields` — form.ts lifts it out so the panel can
         draw it in the summary — so a walk that only descends `fields` cannot
         offer "show this section", which is one of the few things in here an
         owner goes hunting for. */
      if (field.toggle && options.toggleLabel) {
        out.push({ path: field.toggle.path, label: options.toggleLabel, where: inside, text: "" });
      }
      for (const child of field.fields) walk(child, inside);
      return;
    }

    if (field.kind === "array") {
      const rows = valueAt(values, field.path);
      if (!Array.isArray(rows)) return;
      const inside = [...where, field.label];
      rows.forEach((_, index) => {
        const row = retarget(field.item, `${field.path}[]`, `${field.path}[${index}]`);
        /* The same number the panel puts on the row, so a result names
           something an owner can see once they get there. */
        walk({ ...row, label: `${field.item.label} ${index + 1}` }, inside);
      });
      return;
    }

    out.push({ path: field.path, label: field.label, where, text: textOf(field, values) });
  };

  for (const field of fields) walk(field, []);
  return out;
}

/** A field's current value as words. Anything that is not words — a checkbox,
    an unexpected object where a string was described — is empty rather than
    `[object Object]`, which is `render`'s own rule for the same reason. */
function textOf(field: Field, values: unknown): string {
  const value = valueAt(values, field.path);
  if (field.kind === "boolean") return "";
  if (field.kind === "select") {
    /* What the owner sees in the box, not the value behind it. */
    const option = field.options.find((each) => each.value === value);
    return option ? option.label : scalar(value);
  }
  return scalar(value);
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value);
}

const SNIPPET_BEFORE = 34;
const SNIPPET_AFTER = 60;

function snippetAround(text: string, span: Span): Snippet {
  const from = Math.max(0, span.from - SNIPPET_BEFORE);
  const to = Math.min(text.length, span.to + SNIPPET_AFTER);
  return {
    before: text.slice(from, span.from),
    match: text.slice(span.from, span.to),
    after: text.slice(span.to, to),
    cutStart: from > 0,
    cutEnd: to < text.length
  };
}

/** The fields matching `query`, label matches first and document order within.
    -------------------------------------------------------------------------
    A label match ranks above a value match because an owner who types "email"
    usually means the field called Email, and one who types a sentence means the
    sentence. Both kinds are offered either way; only the order changes. */
export function searchEntry(
  fields: Field[],
  values: unknown,
  query: string,
  options: SearchOptions = {}
): { hits: SearchHit[]; total: number } {
  const needle = foldQuery(query);
  if (!needle.text) return { hits: [], total: 0 };

  const byLabel: SearchHit[] = [];
  const byValue: SearchHit[] = [];

  for (const candidate of entryFields(fields, values, options)) {
    const labelMatch = findIn(candidate.label, needle);
    const valueMatch = candidate.text ? findIn(candidate.text, needle) : null;
    if (!labelMatch && !valueMatch) continue;

    const hit: SearchHit = {
      path: candidate.path,
      label: candidate.label,
      where: candidate.where,
      ...(labelMatch ? { labelMatch } : {}),
      ...(valueMatch ? { snippet: snippetAround(candidate.text, valueMatch) } : {})
    };
    (labelMatch ? byLabel : byValue).push(hit);
  }

  const all = [...byLabel, ...byValue];
  const limit = options.limit ?? 20;
  return { hits: all.slice(0, limit), total: all.length };
}
