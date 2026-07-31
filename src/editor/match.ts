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

/** A query, folded once for the whole pass, and — when it is Persian — folded
    a second, more forgiving way as well.
    -------------------------------------------------------------------------
    The second fold exists because of a measurement, not a hunch. mosleh's 24
    content files hold **903 zero-width non-joiners**, and the word an owner
    types is very often the same word written with a plain space, or with
    nothing at all: three spellings of one word, all of which they can see on
    their own page. Deleting the ZWNJ (which is what the primary fold does, and
    what Chrome's own matcher does) closes two of the three, and leaves the one
    the round wrote down as its example — a plural stored as `گرومت ها` where
    it wanted `گرومت‌ها`, which mosleh really does contain.

    So `loose` folds the separator away on **both** sides, and `findIn` tries
    it only after the honest comparison has failed. That ordering is what keeps
    it safe: an exact match always wins, and the forgiving pass only ever turns
    *nothing found* into *found* — never a nearer match into a further one. It
    is attached only when the query contains a Persian or Arabic letter, so no
    English or French search behaves differently by a single character, and it
    is attached even when it folds to the same text as the primary, because the
    spelling that needs forgiving may be the one in the **file**. */
export interface Needle extends Folded {
  loose?: Folded;
}

/** Characters an owner cannot see, which must therefore never decide a match.
    -------------------------------------------------------------------------
    The zero-width family first, because a ZWNJ is the whole reason this list
    exists: it is invisible, it is 903 characters of mosleh's content, and a
    Persian keyboard gives it to one person and a plain space to the next. Its
    relatives ride along — a ZWJ, a bidi mark or a BOM comes free with a paste
    out of a PDF or a browser, and an invisible character that silently
    prevents a match is the worst kind of nothing.

    Then the tatweel, which only stretches a join, and the combining marks —
    which is where **tanween** lives. `معمولا` for `معمولاً` was named in the
    round as the imperfection that breaks naive matching, and the census found
    it: three tanween in 94,878 code points, so the corpus is *inconsistent*
    rather than uniformly bare, which is the case that hurts. The rest of the
    harakat (fatha, kasra, damma, sukun, shadda, the combining madda and hamza)
    fold by exactly the same argument — an owner does not type what they cannot
    see, and one file having them while nine do not is what stops a search. */
function isInvisible(code: number): boolean {
  if (code >= 0x200b && code <= 0x200f) return true; // ZWSP, ZWNJ, ZWJ, LRM, RLM
  if (code === 0x061c || code === 0xfeff) return true; // Arabic letter mark, BOM
  if (code === 0x0640) return true; // tatweel, which only stretches a join
  return isCombiningMark(code);
}

/** A mark that sits *on* the letter before it rather than beside it: the
    harakat, tanween first, and the superscript alef.
    -------------------------------------------------------------------------
    It has a name of its own because the span needs it as well as the fold. A
    mark folds away, so a match ends one code point short of the grapheme an
    owner is looking at — measured on mosleh's own `کاملاً`, where searching
    `کاملا` quoted `کاملا` back and left her tanween outside the highlight,
    orphaned at the head of the text that follows it. `locate` walks the span
    over them for that reason. */
function isCombiningMark(code: number): boolean {
  return (code >= 0x064b && code <= 0x0655) || code === 0x0670;
}

/** One letter, written more than one way.
    -------------------------------------------------------------------------
    The census says the corpus is clean here — 0 Arabic yeh among 5,394, 0
    Arabic kaf among 1,765 — so this half is about the **query**: an Arabic
    keyboard layout, an iOS suggestion or a paste out of an Arabic-language
    source gives `ي` and `ك`, and A3.1 measured that Chrome's own matcher folds
    neither. The alef and heh forms are not on the round's list and are here
    because the census argued for them: 270 of `آ أ إ` in the corpus, against
    an owner who types a bare `ا` because that is what they hear. `ئ` is
    deliberately absent — it is a letter of its own in Persian (`مسئول`), not a
    spelling of `ی`. */
const SAME_LETTER = new Map<number, number>([
  [0x064a, 0x06cc], // arabic yeh      -> persian yeh
  [0x0649, 0x06cc], // alef maksura    -> persian yeh
  [0x0643, 0x06a9], // arabic kaf      -> persian kaf
  [0x0622, 0x0627], // alef with madda -> alef
  [0x0623, 0x0627], // alef, hamza above -> alef
  [0x0625, 0x0627], // alef, hamza below -> alef
  [0x0671, 0x0627], // alef wasla      -> alef
  [0x0629, 0x0647], // teh marbuta     -> heh
  [0x06c0, 0x0647] //  heh, yeh above  -> heh
]);

/** Persian and Arabic-Indic digits as the Latin digit they are. The corpus
    holds both — 146 Persian and 204 Latin across the same 24 files — so a year
    or a phone number an owner reads in one script is one they may well type in
    the other. Folding runs one way only, and only on the comparison path: the
    stored `۱۴۰۱` stays `۱۴۰۱`, which the fleet already learned the hard way
    about normalisation. */
function foldDigit(code: number): string | null {
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  return null;
}

/** What one code point folds to, for the purpose of comparison only.
    -------------------------------------------------------------------------
    Case, and any run of whitespace as a single space so that a phrase still
    matches across the line breaks a YAML block scalar puts in; then the
    Persian folds above. Nothing here is on a write path — `fold` builds a new
    string and the caller reads its answer back out of the original, which
    `test/editor-search.test.ts` proves in bytes. */
function foldChar(ch: string): string {
  if (/\s/.test(ch)) return " ";
  const code = ch.codePointAt(0) ?? 0;
  if (isInvisible(code)) return "";
  const same = SAME_LETTER.get(code);
  if (same !== undefined) return String.fromCodePoint(same);
  const digit = foldDigit(code);
  if (digit !== null) return digit;
  return ch.toLowerCase();
}

/** A letter of the Persian/Arabic script, as opposed to a digit or a mark of
    punctuation that shares its block. Asked of *folded* text, where the digits
    have already become Latin ones — but it answers honestly on its own, since
    a predicate that is only correct in one caller is a bug waiting for a
    second. */
function isPersianLetter(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x0620 || code > 0x06ff) return false;
  if (code >= 0x0660 && code <= 0x0669) return false; // ٠-٩
  if (code >= 0x06f0 && code <= 0x06f9) return false; // ۰-۹
  // The comma, semicolon, question mark and full stop share the block and
  // are not letters, so a space beside one is a space an owner typed.
  return code !== 0x060c && code !== 0x061b && code !== 0x061f && code !== 0x06d4;
}

/** Fold `source` for comparison. `loose` additionally drops a space that sits
    between two Persian letters — see `Needle`, and note that it is only ever
    reached after the honest comparison has already failed. */
export function fold(source: string, loose = false): Folded {
  const chars: string[] = [];
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
       the deletion case the map exists for — and which every fold added since
       leans on, because most of them delete outright. */
    if (mapped === " " && chars[chars.length - 1] === " ") continue;
    /* By code *unit* on the way out, because these are indices into the folded
       string and `indexOf` answers in code units. */
    for (let i = 0; i < mapped.length; i++) {
      chars.push(mapped[i] as string);
      start.push(from);
      end.push(at);
    }
  }
  if (loose) dropWordSpaces(chars, start, end);
  return { text: chars.join(""), start, end };
}

/** Remove each space between two Persian letters, keeping the map beside it in
    step. Backwards, so a removal cannot move the cursor onto a character it
    has already passed. */
function dropWordSpaces(chars: string[], start: number[], end: number[]): void {
  for (let i = chars.length - 1; i > 0; i--) {
    if (chars[i] !== " ") continue;
    if (!isPersianLetter(chars[i - 1]) || !isPersianLetter(chars[i + 1])) continue;
    chars.splice(i, 1);
    start.splice(i, 1);
    end.splice(i, 1);
  }
}

/** Where `query` sits inside `source`, in `source`'s own offsets, or null.
    Both sides are folded, so the comparison is on the folded text and the
    answer is on the real one — and when a Persian query finds nothing, both
    sides are folded again with the word separators dropped. The second pass
    costs a second walk of a string that has already failed, and it costs
    nothing at all for a query with no Persian in it. */
export function findIn(source: string, query: Needle): Span | null {
  if (!query.text) return null;
  const direct = locate(fold(source), query.text, source);
  if (direct || !query.loose?.text) return direct;
  return locate(fold(source, true), query.loose.text, source);
}

function locate(haystack: Folded, needle: string, source: string): Span | null {
  const at = haystack.text.indexOf(needle);
  if (at === -1) return null;
  const last = at + needle.length - 1;
  let to = haystack.end[last] ?? source.length;
  /* Take the marks the last matched letter carries. They folded away, so the
     span stops at the letter — and a highlight that splits a letter from its
     own tanween renders as a stray mark at the start of the words after it. */
  while (to < source.length && isCombiningMark(source.charCodeAt(to))) to += 1;
  return { from: haystack.start[at] ?? 0, to };
}

/** The query, folded once for the whole pass. Trimmed at the source rather
    than after folding, so the map stays aligned with the text it describes —
    and a query that is spaces alone folds to nothing and matches nothing,
    rather than matching every field on the page. */
export function foldQuery(query: string): Needle {
  const trimmed = query.trim();
  const primary = fold(trimmed);
  if (![...primary.text].some((ch) => isPersianLetter(ch))) return primary;
  return { ...primary, loose: fold(trimmed, true) };
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
