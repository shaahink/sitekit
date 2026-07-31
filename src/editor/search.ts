/* Finding the words an owner came to change.
   ---------------------------------------------------------------------------
   0.17.0 made the panel a list of collapsed sections, which fixed a form that
   was 14,437px tall on nimagiti and answered "what is on my site" in one
   screen. It did not answer *which section is that sentence in* — and on
   mosleh-clinic that is 21 pages of Persian prose, where the question comes
   before the scrolling does.

   So: type, and get the fields whose label or whose current text matches, each
   naming the section it is in and showing the words around the match. Tap one
   and the panel opens that section and puts the caret in that field, which is
   `revealField` — the same three lines an incoming `#field=` link has used
   since 7.6.

   **This half never asks the server anything.** The panel already holds every
   field descriptor and the document itself, and every control writes what is
   typed back into that document as it goes (see `render`), so searching it is
   free and searches what is on screen *now* rather than what loaded. Searching
   across the other twenty entries is A3.2's, it needs the content edge, and it
   is deliberately not started here.

   ── Was the browser already doing this? ────────────────────────────────────
   Measured in Chrome 150 rather than assumed, because `render.ts` says
   find-in-page opens a closed `<details>` on a match and A3 was told to check
   before duplicating it. What is true: a closed section's content is
   `content-visibility: hidden` on `::details-content` and `beforematch` is
   supported, which is exactly the machinery find-in-page reveals through, and
   the browser's matcher does reach a `<textarea>`'s *value*, including one
   typed a moment ago. What no amount of it can do is say **which section and
   which field** a match is in, list every match at once, or be reached at all
   on a phone without going through the browser's own menus. That is the whole
   of what this file adds, and it is why it is not a duplicate.

   (The full measurement, including that the DevTools protocol exposes no
   find-in-page command at all — so `window.find` was the proxy and is named as
   one — is in session 21's A3 notes.) */

import type { Field } from "../cms/fields.js";
import { el } from "./dom.js";
import { digitsFor, fill, type EditorStrings } from "./strings.js";
import { plural, retarget, valueAt } from "./values.js";

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
    already tested.

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

/* --- the field at the top of the panel ------------------------------------ */

export interface SearchBoxOptions {
  strings: EditorStrings;
  /** For the count, which is a number and must be written in the panel's own
      digits — "۳ مورد", not "3 مورد". Same rule as the save button's. */
  lang: string;
  /** Called with a concrete path when a result is chosen. The panel passes
      `revealField`, which opens every section above the control and focuses
      it. */
  onPick(path: string): void;
}

export interface SearchBox {
  element: HTMLElement;
  /** Point it at the entry now on screen. `null` while one is loading, or
      where one failed to load — a search field over content that is not there
      would answer "nothing matches" to every word on the owner's own page. */
  setEntry(entry: { fields: Field[]; values: unknown } | null): void;
}

export function searchBox(options: SearchBoxOptions): SearchBox {
  const { strings, lang } = options;
  const digits = digitsFor(lang);

  const element = el("div", "sk-editor__search");
  element.hidden = true;

  const field = el("label", "sk-editor__field sk-editor__searchfield");
  field.append(el("span", "sk-editor__label", strings.searchLabel));
  const input = el("input", "sk-editor__input sk-editor__searchinput");
  /* `search` rather than `text`: it is the type that means this, and it is
     what puts a clear button under a thumb on a phone. */
  input.type = "search";
  /* The one place `dir="auto"` is right, and the reason is that this *is* the
     editor's own field rather than the site's content: an owner types Farsi
     into an English panel and Latin into a Farsi one, and the box should
     follow whichever they typed. On a site's own page the same attribute moved
     a plus sign 38px across nimagiti's live layout — that is content, this is
     not. */
  input.setAttribute("dir", "auto");
  input.autocomplete = "off";
  field.append(input);
  element.append(field);

  /* Announced rather than merely drawn: an owner using a screen reader types
     and hears how many, without having to go looking for the list. */
  const count = el("p", "sk-editor__searchcount");
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  element.append(count);

  const list = el("ul", "sk-editor__hits");
  element.append(list);

  let entry: { fields: Field[]; values: unknown } | null = null;

  const draw = (): void => {
    list.textContent = "";
    const query = input.value;
    if (!entry || !query.trim()) {
      count.textContent = "";
      list.hidden = true;
      return;
    }

    const { hits, total } = searchEntry(entry.fields, entry.values, query, {
      toggleLabel: strings.sectionShow
    });
    list.hidden = false;

    if (!total) {
      count.textContent = strings.searchNothing;
      return;
    }

    count.textContent = fill(strings.searchCount, {
      count: plural(total, strings.searchMatch, strings.searchMatches, digits)
    });
    for (const hit of hits) list.append(row(hit));
    /* Said rather than silently dropped: a list that stops at twenty while
       claiming twenty-three matches is a list that lied about where the other
       three are. */
    if (total > hits.length) {
      const more = el("li", "sk-editor__hitmore", strings.searchNarrow);
      list.append(more);
    }
  };

  function row(hit: SearchHit): HTMLElement {
    const item = el("li", "");
    const button = el("button", "sk-editor__hit");
    button.type = "button";

    /* Where it is and what it is called, in one line: "Rooms — Room 2 —
       Description". The separator is an em dash rather than a chevron because
       a chevron points the wrong way in a right-to-left panel, and this line
       is the site's own words, which may be either. */
    const where = el("span", "sk-editor__hitwhere");
    where.setAttribute("dir", "auto");
    if (hit.where.length) {
      where.append(el("span", "sk-editor__hittrail", `${hit.where.join(" — ")} — `));
    }
    /* The label is appended separately rather than joined into the line above,
       so marking the part that matched is a slice of the label itself and not
       arithmetic over a string built somewhere else. */
    where.append(...marked(hit.label, hit.labelMatch));
    button.append(where);

    if (hit.snippet) {
      const snippet = el("span", "sk-editor__hitsnippet");
      /* The owner's own words, so they decide the direction — the same reason
         every control in `render` carries this. */
      snippet.setAttribute("dir", "auto");
      const { before, match, after, cutStart, cutEnd } = hit.snippet;
      snippet.append(document.createTextNode(`${cutStart ? "…" : ""}${before}`));
      if (match) snippet.append(el("mark", "sk-editor__hitmark", match));
      snippet.append(document.createTextNode(`${after}${cutEnd ? "…" : ""}`));
      button.append(snippet);
    }

    button.addEventListener("click", () => options.onPick(hit.path));
    item.append(button);
    return item;
  }

  /** A string with its matched part marked. */
  function marked(text: string, span: Span | undefined): Node[] {
    if (!span) return [document.createTextNode(text)];
    return [
      document.createTextNode(text.slice(0, span.from)),
      el("mark", "sk-editor__hitmark", text.slice(span.from, span.to)),
      document.createTextNode(text.slice(span.to))
    ];
  }

  input.addEventListener("input", draw);
  input.addEventListener("keydown", (event) => {
    /* Enter takes the first result. Typing a word and pressing Enter is what
       every other search field an owner has used does, and without it the only
       way through is a tap on a list that has just this moment redrawn under
       their thumb. */
    if (event.key === "Enter") {
      event.preventDefault();
      list.querySelector<HTMLButtonElement>(".sk-editor__hit")?.click();
      return;
    }
    /* Escape empties the box rather than leaving the results standing over a
       page the owner has moved on from. */
    if (event.key === "Escape" && input.value) {
      event.preventDefault();
      input.value = "";
      draw();
    }
  });

  return {
    element,
    setEntry(next) {
      entry = next;
      element.hidden = !next;
      /* The query survives an entry change on purpose: an owner fixing the
         same phrase on the English page and then the French one types it once.
         The results are redrawn against the new entry, so nothing on screen is
         about the old one. */
      draw();
    }
  };
}
