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

   ── Two lists, and the difference between them is the whole design ────────
   **The page in front of the owner: free, client-side, instant.** The panel
   already holds every field descriptor and the document itself, and every
   control writes what is typed back into that document as it goes (see
   `render`), so searching it costs nothing and searches what is on screen
   *now* rather than what loaded. It answers on the keystroke.

   **Their other pages: the server, and it takes about a second.** A3.2's
   measurement, against the real repositories: mosleh's 24 files read in 697ms
   in parallel and 5,555ms one after another, and a warm instance answers in
   ~250ms because the handler keeps the parse and re-reads only when the
   branch's head commit sha moves. That is fast enough to be worth having and
   far too slow to sit in front of the instant half — so it does not. The local
   list draws on the keystroke and the elsewhere list arrives underneath it,
   debounced, labelled with which page each match is on, and honest about
   having failed if it did. An owner who was only ever looking at this page
   never waits for the other twenty.

   ── Was the browser already doing this? ────────────────────────────────────
   Measured in Chrome 150 rather than assumed, because `render.ts` says
   find-in-page opens a closed `<details>` on a match and A3 was told to check
   before duplicating it. What is true: a closed section's content is
   `content-visibility: hidden` on `::details-content` and `beforematch` is
   supported, which is exactly the machinery find-in-page reveals through, and
   the browser's matcher does reach a `<textarea>`'s *value*, including one
   typed a moment ago. What no amount of it can do is say **which section and
   which field** a match is in, list every match at once, reach a page that is
   not loaded, or be found at all on a phone without going through the
   browser's own menus. That is the whole of what this file adds, and it is why
   it is not a duplicate.

   (The full measurement, including that the DevTools protocol exposes no
   find-in-page command at all — so `window.find` was the proxy and is named as
   one — is in session 21's A3 notes.)

   The matcher itself is `match.ts`, which has no DOM in it because the handler
   runs the same code over the other entries. See its header. */

import type { Field } from "../cms/fields.js";
/* Type-only, and it has to stay that way: the shape of the elsewhere list is
   the *handler's* shape, and two declarations of one JSON payload is two
   declarations that drift. `import type` is erased at build, so nothing of the
   server reaches a visitor's bundle — checked in A3.2's evidence. */
import type { SiteSearch } from "../cms/search.js";
import { el } from "./dom.js";
import { searchEntry, type SearchHit, type Span } from "./match.js";
import { digitsFor, fill, type EditorStrings } from "./strings.js";
import { plural } from "./values.js";

/* Re-exported so every existing caller — and the suite that has tested this
   arithmetic since A3.1 — keeps importing it from where it has always been.
   New server-side callers import `match.js` directly, because importing *this*
   file drags the string table in behind it. That is the whole reason for the
   split; see match.ts's header. */
export type { Candidate, Folded, Needle, SearchHit, SearchOptions, Snippet, Span } from "./match.js";
export { entryFields, findIn, fold, foldQuery, searchEntry } from "./match.js";
export type { SiteHit, SiteSearch } from "../cms/search.js";

/* --- the field at the top of the panel ------------------------------------ */

export interface SearchBoxOptions {
  strings: EditorStrings;
  /** For the count, which is a number and must be written in the panel's own
      digits — "۳ مورد", not "3 مورد". Same rule as the save button's. */
  lang: string;
  /** Called with a concrete path when a result on *this* page is chosen. The
      panel passes `revealField`, which opens every section above the control
      and focuses it. */
  onPick(path: string): void;
  /** Ask the server about every other entry. Injected rather than fetched in
      here so this file stays testable without a network, and so the one place
      that knows the content URL stays the one place that knows it.

      Absent means the elsewhere list is simply never drawn — which is what an
      older kit's panel against a newer site would want, and is also the whole
      of the feature's off switch. */
  elsewhere?: (query: string, skip: string | null) => Promise<SiteSearch>;
  /** Called when a result on another page is chosen: load that entry and
      reveal that field. The panel points the picker at it, which loads. */
  onPickElsewhere?: (collection: string, entry: string, path: string) => void;
}

export interface SearchBox {
  element: HTMLElement;
  /** Point it at the entry now on screen. `null` while one is loading, or
      where one failed to load — a search field over content that is not there
      would answer "nothing matches" to every word on the owner's own page.

      `where` is the picker's own `collection/entry` value, which is what the
      server is told to skip so it never offers a second route to a field the
      list above already has. Optional because "which entry is this" is a
      question a caller can genuinely not have an answer to, and skipping
      nothing is the honest behaviour then — a duplicated row is a smaller
      failure than a search that quietly leaves a page out. */
  setEntry(entry: { fields: Field[]; values: unknown; where?: string } | null): void;
}

/** How long after the last keystroke the server is asked. Long enough that
    typing a word is one request rather than six, short enough that it does not
    read as a stall on top of the ~700ms the request itself costs. */
const ELSEWHERE_DELAY = 300;

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

  /* The second list and its own heading, built once and emptied rather than
     rebuilt, so the live region below announces a *change* rather than being
     replaced mid-announcement. */
  const elsewhereNote = el("p", "sk-editor__searchcount sk-editor__searchelsewhere");
  elsewhereNote.setAttribute("role", "status");
  elsewhereNote.setAttribute("aria-live", "polite");
  element.append(elsewhereNote);

  const elsewhereList = el("ul", "sk-editor__hits sk-editor__hits--elsewhere");
  elsewhereList.hidden = true;
  element.append(elsewhereList);

  let entry: { fields: Field[]; values: unknown; where?: string } | null = null;

  /* Which request the answer on the way back belongs to. A search field is the
     one control where a slow answer to an old question is worse than no answer
     at all: an owner types "email", waits, types "emails", and the first
     request lands second and puts the wrong list under their thumb. Every
     response is checked against this before it draws anything. */
  let asked = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearElsewhere = (): void => {
    elsewhereNote.textContent = "";
    elsewhereList.textContent = "";
    elsewhereList.hidden = true;
  };

  const draw = (): void => {
    list.textContent = "";
    const query = input.value;
    if (!entry || !query.trim()) {
      count.textContent = "";
      list.hidden = true;
      /* A cleared box cancels the question as well as the answer: the request
         in flight belongs to a query that no longer exists. */
      asked++;
      if (timer !== undefined) clearTimeout(timer);
      clearElsewhere();
      return;
    }

    const { hits, total } = searchEntry(entry.fields, entry.values, query, {
      toggleLabel: strings.sectionShow
    });
    list.hidden = false;

    if (!total) {
      count.textContent = strings.searchNothing;
    } else {
      count.textContent = fill(strings.searchCount, {
        count: plural(total, strings.searchMatch, strings.searchMatches, digits)
      });
      for (const hit of hits) list.append(row(hit, () => options.onPick(hit.path)));
      /* Said rather than silently dropped: a list that stops at twenty while
         claiming twenty-three matches is a list that lied about where the other
         three are. */
      if (total > hits.length) {
        list.append(el("li", "sk-editor__hitmore", strings.searchNarrow));
      }
    }

    askElsewhere(query);
  };

  /** The other pages, debounced, and never in the way of the list above. */
  function askElsewhere(query: string): void {
    if (!options.elsewhere || !entry) return;
    if (timer !== undefined) clearTimeout(timer);
    const mine = ++asked;
    /* Said while it is happening rather than after: without this the panel is
       silent for the whole second the read takes, and a silent second under a
       list that has already answered reads as "that is all there is". */
    elsewhereNote.textContent = strings.searchLooking;
    elsewhereList.textContent = "";
    elsewhereList.hidden = true;

    const where = entry.where ?? null;
    timer = setTimeout(() => {
      void options
        .elsewhere?.(query, where)
        .then((found) => {
          if (mine !== asked) return;
          drawElsewhere(found);
        })
        .catch(() => {
          if (mine !== asked) return;
          /* Named, not swallowed. An owner told "nothing on your other pages"
             when the truth is "we could not look" will stop looking — and the
             one thing this feature cannot afford is to be quietly wrong about
             an absence. */
          elsewhereNote.textContent = strings.searchElsewhereFailed;
        });
    }, ELSEWHERE_DELAY);
  }

  function drawElsewhere(found: SiteSearch): void {
    if (!found.total) {
      elsewhereNote.textContent = strings.searchElsewhereNothing;
      elsewhereList.hidden = true;
      return;
    }
    elsewhereNote.textContent = fill(strings.searchElsewhere, {
      count: plural(found.total, strings.searchMatch, strings.searchMatches, digits)
    });
    elsewhereList.hidden = false;
    for (const hit of found.hits) {
      elsewhereList.append(
        row(hit, () => options.onPickElsewhere?.(hit.collection, hit.entry, hit.path), hit.title)
      );
    }
    if (found.total > found.hits.length) {
      elsewhereList.append(el("li", "sk-editor__hitmore", strings.searchNarrow));
    }
  }

  /** One result. `page` names the entry it is on, and is absent for a hit on
      the page already open — where saying so on every row would be noise. */
  function row(hit: SearchHit, pick: () => void, page?: string): HTMLElement {
    const item = el("li", "");
    const button = el("button", "sk-editor__hit");
    button.type = "button";

    /* Where it is and what it is called, in one line: "Rooms — Room 2 —
       Description". The separator is an em dash rather than a chevron because
       a chevron points the wrong way in a right-to-left panel, and this line
       is the site's own words, which may be either. */
    const where = el("span", "sk-editor__hitwhere");
    where.setAttribute("dir", "auto");
    if (page) {
      /* The page's own name leads and is marked as its own element, because on
         the elsewhere list it is the thing an owner is scanning for — they know
         what they wrote, they are asking *where*.

         The separator is a node of its own rather than a margin, and that is
         not decoration: a browser pass read this row back as
         "Case studies — Bruce — bezLink" when the field sat at the top level
         of its entry and so had no section trail to supply the dash. A gap
         drawn in CSS is not a gap a screen reader reads. */
      where.append(el("span", "sk-editor__hitpage", page));
      where.append(el("span", "sk-editor__hittrail", " — "));
    }
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

    button.addEventListener("click", pick);
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
       their thumb.

       The list on *this* page first and the other pages only if it is empty:
       Enter should never navigate away from the page an owner is on while a
       match on it is sitting on screen. */
    if (event.key === "Enter") {
      event.preventDefault();
      const here = list.querySelector<HTMLButtonElement>(".sk-editor__hit");
      (here ?? elsewhereList.querySelector<HTMLButtonElement>(".sk-editor__hit"))?.click();
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
         about the old one — and the elsewhere list is re-asked, because the
         page it must now skip is a different page. */
      draw();
    }
  };
}
