// @vitest-environment happy-dom

/* Finding a word on the page in front of the owner.
   ---------------------------------------------------------------------------
   Three things in here would be wrong *silently*, which is this suite's own
   bar for what gets a unit test rather than a browser pass.

   The offset map. A fold that deletes a character moves every offset after it,
   so a match found in the folded text names the wrong span in the real one —
   and the symptom is a snippet that underlines the wrong half of a sentence,
   which reads as a rendering quirk rather than as a bug. A3.3 adds three more
   deleting folds on top of this one, so the map is tested before it carries
   them.

   The whole value. `searchEntry` compares against the field's full text and
   quotes a trimmed slice of it; comparing against the trimmed slice instead
   would look perfect on every short field and quietly stop finding anything
   past the first sixty characters of a paragraph. That is exactly the shape of
   mosleh-clinic's content.

   And the read-only promise. Nothing in search.ts may touch the document it is
   searching. The panel hands it the *same* object every control writes into,
   so a fold that normalised in place would rewrite an owner's Persian —
   dropping a ZWNJ or Latinising a digit — and the first anyone would know is a
   commit. The last test in this file says so in bytes. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Field } from "../src/cms/fields.js";
import {
  entryFields,
  findIn,
  fold,
  foldQuery,
  searchBox,
  searchEntry,
  type SiteHit,
  type SiteSearch
} from "../src/editor/search.js";
import { defaultStrings } from "../src/editor/strings.js";

const text = (path: string, label: string): Field => ({
  kind: "text",
  path,
  label,
  required: true,
  long: false
});

/* A model with one of everything the walk has to handle: a section with a
   switch, a nested group, a repeater of groups, a select and an image. */
const model: Field[] = [
  {
    kind: "group",
    path: "hero",
    label: "Hero",
    required: true,
    toggle: { kind: "boolean", path: "hero.visible", label: "Visible", required: false },
    fields: [text("hero.title", "Title"), text("hero.tagline", "Tagline")]
  },
  {
    kind: "group",
    path: "contact",
    label: "Contact",
    required: true,
    fields: [
      text("contact.email", "Email address"),
      {
        kind: "group",
        path: "contact.hours",
        label: "Opening hours",
        required: false,
        fields: [text("contact.hours.weekday", "Weekdays")]
      }
    ]
  },
  {
    kind: "array",
    path: "slides",
    label: "Slides",
    required: true,
    item: {
      kind: "group",
      path: "slides[]",
      label: "Slide",
      required: true,
      fields: [
        text("slides[].alt", "Description"),
        {
          kind: "select",
          path: "slides[].fit",
          label: "Fit",
          required: false,
          options: [
            { value: "cover", label: "Fill the frame" },
            { value: "contain", label: "Show all of it" }
          ]
        }
      ]
    }
  }
];

const values = (): unknown => ({
  hero: { visible: true, title: "Elfine", tagline: "Slow clothes, made once" },
  contact: {
    email: "hello@elfine.example",
    hours: { weekday: "Ten until six,\nMonday to Friday" }
  },
  slides: [
    { alt: "A coat on a rail", fit: "cover" },
    { alt: "The workroom window", fit: "contain" }
  ]
});

/* --- what there is to search --------------------------------------------- */

describe("the fields a loaded entry offers", () => {
  const found = entryFields(model, values(), { toggleLabel: defaultStrings.sectionShow });
  const at = (path: string) => found.find((candidate) => candidate.path === path);

  it("names the section a field is in, outermost first", () => {
    expect(at("hero.tagline")?.where).toEqual(["Hero"]);
    expect(at("contact.hours.weekday")?.where).toEqual(["Contact", "Opening hours"]);
  });

  it("numbers a repeater's rows the way the panel draws them", () => {
    expect(at("slides[1].alt")?.where).toEqual(["Slides", "Slide 2"]);
    expect(at("slides[1].alt")?.text).toBe("The workroom window");
  });

  /* The switch is lifted out of `fields` by form.ts, so a walk that only
     descends `fields` cannot offer it at all — and "how do I put that section
     back" is one of the few things an owner goes hunting for. */
  it("offers a section's on/off switch, under the words the panel shows", () => {
    expect(at("hero.visible")?.label).toBe(defaultStrings.sectionShow);
    expect(at("hero.visible")?.where).toEqual(["Hero"]);
  });

  it("reads a select as the option the owner can see, not the value behind it", () => {
    expect(at("slides[0].fit")?.text).toBe("Fill the frame");
  });

  it("has nothing to quote for a field that holds no words", () => {
    expect(at("hero.visible")?.text).toBe("");
  });
});

/* --- folding, and the map that makes it safe ------------------------------ */

describe("folding for comparison", () => {
  it("collapses a run of whitespace to one space", () => {
    expect(fold("Ten until six,\n  Monday").text).toBe("ten until six, monday");
  });

  /* The one that would be silently wrong: every offset after a collapsed run
     has moved, so a naive index would quote the wrong words back. */
  it("maps a match back to where it really is, past a deletion", () => {
    const source = "Ten until six,\n  Monday to Friday";
    const span = findIn(source, foldQuery("monday"));
    expect(span).not.toBeNull();
    expect(source.slice(span!.from, span!.to)).toBe("Monday");
  });

  it("matches whatever case it was written in", () => {
    const span = findIn("Slow clothes", foldQuery("SLOW"));
    expect(span).toEqual({ from: 0, to: 4 });
  });

  /* A code point outside the BMP is two UTF-16 units and one character to
     fold; both units have to map to the same source span or every offset after
     an emoji in someone's tagline is off by one. */
  it("keeps the offsets right after a surrogate pair", () => {
    const source = "🌿 made once";
    const span = findIn(source, foldQuery("once"));
    expect(source.slice(span!.from, span!.to)).toBe("once");
  });

  it("matches nothing on a query that is only spaces", () => {
    expect(foldQuery("   ").text).toBe("");
    expect(findIn("anything at all", foldQuery("  "))).toBeNull();
  });
});

/* --- and the folds that are the reason this stage exists ------------------ */

describe("folding Persian, for the comparison and nothing else", () => {
  /* Built from code points rather than typed. A ZWNJ and a tanween are
     invisible in a source file, and an Arabic yeh is a pixel away from a
     Persian one — a fixture nobody can read is a test that can pass with both
     sides wrong in the same way. */
  const ZWNJ = String.fromCharCode(0x200c);
  const TANWEEN = String.fromCharCode(0x064b);
  const PERSIAN_YEH = String.fromCharCode(0x06cc);
  const PERSIAN_KAF = String.fromCharCode(0x06a9);
  const YEAR = String.fromCharCode(0x06f1, 0x06f4, 0x06f0, 0x06f1); // ۱۴۰۱

  /** The same word as an Arabic keyboard, an iOS suggestion or a paste out of
      an Arabic-language PDF gives it. */
  const arabicKeyboard = (word: string): string =>
    word
      .split(PERSIAN_YEH)
      .join(String.fromCharCode(0x064a))
      .split(PERSIAN_KAF)
      .join(String.fromCharCode(0x0643));

  /* mosleh's own spelling, and there are 903 of these in her 24 files. */
  const cells = "سلول" + ZWNJ + "های";
  const sentence = "عفونت در " + cells + " ماستوئید";

  it("finds a word joined by a ZWNJ when nothing was typed in its place", () => {
    const span = findIn(sentence, foldQuery("سلولهای"));
    expect(span).not.toBeNull();
    expect(sentence.slice(span!.from, span!.to)).toBe(cells);
  });

  it("finds it when a plain space was typed instead", () => {
    const span = findIn(sentence, foldQuery("سلول های"));
    expect(span).not.toBeNull();
    expect(sentence.slice(span!.from, span!.to)).toBe(cells);
  });

  /* The other direction, and it is the one the round wrote down: mosleh really
     does store `گرومت ها` where the ZWNJ was meant. An owner who spells their
     own word correctly must still find their own page. */
  it("finds a plural the file stored with a space, spelled correctly", () => {
    const stored = "قرار دادن گرومت ها انجام دهد";
    const span = findIn(stored, foldQuery("گرومت" + ZWNJ + "ها"));
    expect(span).not.toBeNull();
    expect(stored.slice(span!.from, span!.to)).toBe("گرومت ها");
  });

  /* mosleh's corpus holds both spellings of this: `معمولا` bare 49 times, and
     `کاملاً` marked 3 times in 94,878 code points. The direction that was
     broken is the one where the *file* is bare and the owner types the mark. */
  it("finds a word whose tanween the file kept, and one whose it dropped", () => {
    const kept = "معمولا" + TANWEEN + " بدون درد است";
    expect(findIn(kept, foldQuery("معمولا"))).not.toBeNull();

    const dropped = "معمولا بدون درد است";
    const span = findIn(dropped, foldQuery("معمولا" + TANWEEN));
    expect(span).not.toBeNull();
    expect(dropped.slice(span!.from, span!.to)).toBe("معمولا");
  });

  /* Found on mosleh's real content rather than reasoned about: searching
     `کاملا` quoted `کاملا` back and left her tanween orphaned at the head of
     the words after the highlight. */
  it("takes the marks the last matched letter carries", () => {
    const stored = "درمان" + " کاملا" + TANWEEN + " فردی";
    const span = findIn(stored, foldQuery("کاملا"));
    expect(span).not.toBeNull();
    expect(stored.slice(span!.from, span!.to)).toBe("کاملا" + TANWEEN);

    const { hits } = searchEntry([text("hero.title", "عنوان")], { hero: { title: stored } }, "کاملا");
    expect(hits[0]?.snippet?.match).toBe("کاملا" + TANWEEN);
    expect(hits[0]?.snippet?.after?.startsWith(TANWEEN)).toBe(false);
  });

  /* The one Chrome's own matcher does not do, measured in A3.1. */
  it("finds Persian letters typed on an Arabic keyboard", () => {
    const stored = "کلینیک زیبایی";
    expect(stored).toContain(PERSIAN_KAF);
    expect(stored).toContain(PERSIAN_YEH);

    const typed = arabicKeyboard(stored);
    expect(typed).not.toBe(stored);

    const span = findIn(stored, foldQuery(typed));
    expect(span).not.toBeNull();
    expect(stored.slice(span!.from, span!.to)).toBe(stored);
  });

  it("finds a number written in the other script, both ways round", () => {
    const stored = "از سال " + YEAR;
    const span = findIn(stored, foldQuery("1401"));
    expect(span).not.toBeNull();
    expect(stored.slice(span!.from, span!.to)).toBe(YEAR);
    expect(findIn("since 1401", foldQuery(YEAR))).not.toBeNull();
  });

  /* The map, on the forgiving path. A dropped separator moves every offset
     after it exactly as a collapsed run of whitespace does, and the symptom is
     a snippet quoting the wrong half of a Persian sentence — which reads as a
     bidi rendering quirk rather than as a bug. */
  it("quotes the owner's own words back, with the joiner still in them", () => {
    const values = { hero: { title: sentence } };
    const { hits } = searchEntry([text("hero.title", "عنوان")], values, "سلول های");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.snippet?.match).toBe(cells);
    expect(hits[0]?.snippet?.before).toBe("عفونت در ");
  });

  /* Two negative controls, because the forgiving pass is the one thing here
     that could make search *worse*. */
  it("never loosens a query with no Persian in it", () => {
    /* If it ever ran on Latin text, "the cat" would find "breathe catalogue".
       The pass hangs off the needle, so this asserts the needle itself. */
    expect(foldQuery("slow clothes").loose).toBeUndefined();
    expect(findIn("Slow clothes", foldQuery("slowclothes"))).toBeNull();
  });

  it("prefers the spelling the owner actually typed", () => {
    /* Both spellings on one line: the exact one wins, because the forgiving
       pass runs only when the honest comparison has found nothing at all. */
    const both = "کتاب ها و کتاب" + ZWNJ + "ها";
    const span = findIn(both, foldQuery("کتاب" + ZWNJ + "ها"));
    expect(both.slice(span!.from, span!.to)).toBe("کتاب" + ZWNJ + "ها");
  });

  it("drops the space between two letters and keeps every other one", () => {
    /* A word separator, not every space: the one before a number is a space an
       owner typed and may well be searching for. */
    expect(fold("درد " + YEAR, true).text).toBe("درد 1401");
    expect(fold("سلول های", true).text).toBe("سلولهای");
  });
});

/* --- the search itself ---------------------------------------------------- */

describe("searching the loaded entry", () => {
  const run = (query: string) =>
    searchEntry(model, values(), query, { toggleLabel: defaultStrings.sectionShow });

  /* The acceptance test of the whole stage, in its within-one-entry half:
     `hello@elfine.example` has been on every page of a live client site since
     it was built, `.example` can never resolve, and it took a person noticing.
     Searching across the other entries is A3.2's; this is the same string in
     the entry an owner has open. */
  it("finds the placeholder address a person had to notice", () => {
    const { hits, total } = run("hello@elfine.example");
    expect(total).toBe(1);
    expect(hits[0]?.path).toBe("contact.email");
    expect(hits[0]?.where).toEqual(["Contact"]);
    expect(hits[0]?.label).toBe("Email address");
    expect(hits[0]?.snippet?.match).toBe("hello@elfine.example");
  });

  it("finds a word in the middle of a sentence and quotes it in place", () => {
    const { hits } = run("clothes");
    const snippet = hits[0]?.snippet;
    expect(snippet?.before).toBe("Slow ");
    expect(snippet?.match).toBe("clothes");
    expect(snippet?.after).toBe(", made once");
    expect(snippet?.cutStart).toBe(false);
    expect(snippet?.cutEnd).toBe(false);
  });

  it("cuts a long value around the match and says it did", () => {
    const long = { hero: { title: `${"a word ".repeat(40)}needle${" and more".repeat(40)}` } };
    const { hits } = searchEntry([text("hero.title", "Title")], long, "needle");
    expect(hits[0]?.snippet?.match).toBe("needle");
    expect(hits[0]?.snippet?.cutStart).toBe(true);
    expect(hits[0]?.snippet?.cutEnd).toBe(true);
  });

  /* Comparing against the trimmed snippet instead of the whole value would
     pass every test above and fail only on the long fields — which is what
     mosleh-clinic is made of. */
  it("finds a word past the end of any snippet it would show", () => {
    const long = { hero: { title: `${"padding ".repeat(60)}needle` } };
    const { total } = searchEntry([text("hero.title", "Title")], long, "needle");
    expect(total).toBe(1);
  });

  it("searches labels as well as words, and offers those first", () => {
    const { hits } = run("email");
    expect(hits[0]?.path).toBe("contact.email");
    expect(hits[0]?.labelMatch).toEqual({ from: 0, to: 5 });
  });

  it("offers every row of a repeater in its own right", () => {
    const { hits, total } = run("the workroom");
    expect(total).toBe(1);
    expect(hits[0]?.path).toBe("slides[1].alt");
    expect(hits[0]?.where).toEqual(["Slides", "Slide 2"]);
  });

  it("finds nothing for a word nobody wrote", () => {
    expect(run("aubergine").total).toBe(0);
  });

  it("caps the list it hands back and still says how many there are", () => {
    const many: Field[] = Array.from({ length: 30 }, (_, index) =>
      text(`f${index}`, `Field ${index}`)
    );
    const held = Object.fromEntries(many.map((field) => [field.path, "needle"]));
    const { hits, total } = searchEntry(many, held, "needle", { limit: 20 });
    expect(total).toBe(30);
    expect(hits).toHaveLength(20);
  });
});

/* --- the field at the top of the panel ------------------------------------ */

function box(onPick = vi.fn()): {
  element: HTMLElement;
  setEntry: (entry: { fields: Field[]; values: unknown } | null) => void;
  onPick: ReturnType<typeof vi.fn>;
} {
  const made = searchBox({ strings: defaultStrings, lang: "en", onPick });
  document.body.append(made.element);
  return { ...made, onPick };
}

const field = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(".sk-editor__searchinput")!;

const type = (query: string): void => {
  const input = field();
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".sk-editor__hit")];

/* --- the second list, over the owner's other pages ------------------------ */

const elsewhereRows = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(".sk-editor__hits--elsewhere .sk-editor__hit")
];

const localRows = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(".sk-editor__hits:not(.sk-editor__hits--elsewhere) .sk-editor__hit")
];

const elsewhereNote = (): string =>
  document.querySelector<HTMLElement>(".sk-editor__searchelsewhere")?.textContent ?? "";

const siteHit = (over: Partial<SiteHit> = {}): SiteHit => ({
  path: "contact.email",
  label: "Email",
  where: ["Contact"],
  snippet: {
    before: "",
    match: "hello@elfine.example",
    after: "",
    cutStart: false,
    cutEnd: false
  },
  collection: "site",
  entry: "site.fr",
  title: "Shared — Français",
  file: "src/content/site/site.fr.yaml",
  ...over
});

/* A panel wired to a server that is under the test's control: `answer` is what
   the next look returns, and `asked` is every question it was given. */
function boxWithElsewhere(answer: () => Promise<SiteSearch>): {
  element: HTMLElement;
  setEntry: (entry: { fields: Field[]; values: unknown; where?: string } | null) => void;
  onPick: ReturnType<typeof vi.fn>;
  onPickElsewhere: ReturnType<typeof vi.fn>;
  asked: Array<[string, string | null]>;
} {
  const onPick = vi.fn();
  const onPickElsewhere = vi.fn();
  const asked: Array<[string, string | null]> = [];
  const made = searchBox({
    strings: defaultStrings,
    lang: "en",
    onPick,
    onPickElsewhere,
    elsewhere: (query, skip) => {
      asked.push([query, skip]);
      return answer();
    }
  });
  document.body.append(made.element);
  return { ...made, onPick, onPickElsewhere, asked };
}

const nothingElsewhere = (): Promise<SiteSearch> =>
  Promise.resolve({ hits: [], total: 0, entries: 3 });

describe("the other pages", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  /** Let the debounce fire and the promise settle. */
  async function settle(): Promise<void> {
    await vi.runAllTimersAsync();
  }

  it("asks the server once for a word typed in six keystrokes", async () => {
    const made = boxWithElsewhere(nothingElsewhere);
    made.setEntry({ fields: model, values: values(), where: "site/site.en" });
    for (const partial of ["e", "em", "ema", "emai", "email"]) type(partial);
    await settle();
    /* One question, and it carries the page to leave out — the panel already
       answers for that one instantly and client-side. */
    expect(made.asked).toEqual([["email", "site/site.en"]]);
  });

  it("says it is looking rather than going quiet for a second", async () => {
    const made = boxWithElsewhere(nothingElsewhere);
    made.setEntry({ fields: model, values: values(), where: "site/site.en" });
    type("email");
    expect(elsewhereNote()).toBe(defaultStrings.searchLooking);
    await settle();
    expect(elsewhereNote()).toBe(defaultStrings.searchElsewhereNothing);
  });

  it("names the page each match is on, and how many there are", async () => {
    const made = boxWithElsewhere(() =>
      Promise.resolve({ hits: [siteHit(), siteHit({ entry: "site.de", title: "Shared — Deutsch" })], total: 2, entries: 3 })
    );
    made.setEntry({ fields: model, values: values(), where: "site/site.en" });
    type("hello@elfine.example");
    await settle();

    expect(elsewhereNote()).toBe("2 matches on your other pages");
    const drawn = elsewhereRows();
    expect(drawn).toHaveLength(2);
    expect(drawn[0]?.querySelector(".sk-editor__hitpage")?.textContent).toBe("Shared — Français");
    expect(drawn[0]?.querySelector(".sk-editor__hitmark")?.textContent).toBe("hello@elfine.example");
  });

  /* Found by reading a real row back out of a browser, not by reading the
     source: a field at the top level of its entry has no section trail, so
     nothing supplied the dash and the line read "Case studies — Bruce —
     bezLink". The gap was there — it was a CSS margin, and a margin is not
     something a screen reader reads. */
  it("separates the page's name from what follows with a character, not a margin", async () => {
    const made = boxWithElsewhere(() =>
      /* `where: []` is the case: a field sitting at the top level of its entry. */
      Promise.resolve({ hits: [siteHit({ where: [], label: "Link" })], total: 1, entries: 3 })
    );
    made.setEntry({ fields: model, values: values(), where: "site/site.en" });
    type("hello@elfine.example");
    await settle();

    const line = elsewhereRows()[0]?.querySelector(".sk-editor__hitwhere")?.textContent ?? "";
    expect(line).toBe("Shared — Français — Link");
    expect(line).not.toContain("FrançaisLink");
  });

  it("hands back the collection, the entry and the path when one is chosen", async () => {
    const made = boxWithElsewhere(() =>
      Promise.resolve({ hits: [siteHit()], total: 1, entries: 3 })
    );
    made.setEntry({ fields: model, values: values(), where: "site/site.en" });
    type("hello@elfine.example");
    await settle();
    elsewhereRows()[0]?.click();
    expect(made.onPickElsewhere).toHaveBeenCalledWith("site", "site.fr", "contact.email");
    /* And not the other one: a match on another page is not a field on this
       one, and revealing a path this form does not have would do nothing while
       looking like it worked. */
    expect(made.onPick).not.toHaveBeenCalled();
  });

  /* A search field is the one control where a slow answer to an old question
     is worse than no answer: an owner types "email", waits, types "emails",
     and the first request lands second under their thumb. */
  it("ignores an answer to a question that has been replaced", async () => {
    let resolveFirst: ((found: SiteSearch) => void) | undefined;
    let call = 0;
    const made = boxWithElsewhere(() => {
      call++;
      if (call === 1) return new Promise<SiteSearch>((resolve) => (resolveFirst = resolve));
      return Promise.resolve({ hits: [siteHit({ title: "The second answer" })], total: 1, entries: 3 });
    });
    made.setEntry({ fields: model, values: values(), where: "site/site.en" });

    type("email");
    await vi.advanceTimersByTimeAsync(400);
    type("emails");
    await settle();

    /* The second answer is on screen. Now the first one arrives, late. */
    resolveFirst?.({ hits: [siteHit({ title: "The stale answer" })], total: 9, entries: 3 });
    await vi.runAllTimersAsync();

    expect(elsewhereNote()).toBe("1 match on your other pages");
    expect(elsewhereRows()[0]?.querySelector(".sk-editor__hitpage")?.textContent).toBe(
      "The second answer"
    );
  });

  /* Being quietly wrong about an absence is the one thing this cannot afford.
     An owner told "nothing on your other pages" when the truth is "we could
     not look" stops looking. */
  it("says it could not look, rather than saying there was nothing", async () => {
    const made = boxWithElsewhere(() => Promise.reject(new Error("502")));
    made.setEntry({ fields: model, values: values(), where: "site/site.en" });
    type("email");
    await settle();
    expect(elsewhereNote()).toBe(defaultStrings.searchElsewhereFailed);
    expect(elsewhereNote()).not.toBe(defaultStrings.searchElsewhereNothing);
  });

  it("clears the second list and cancels the question when the box is emptied", async () => {
    const made = boxWithElsewhere(() =>
      Promise.resolve({ hits: [siteHit()], total: 1, entries: 3 })
    );
    made.setEntry({ fields: model, values: values(), where: "site/site.en" });
    type("hello@elfine.example");
    await settle();
    expect(elsewhereRows()).toHaveLength(1);

    type("");
    await settle();
    expect(elsewhereRows()).toHaveLength(0);
    expect(elsewhereNote()).toBe("");
    /* And nothing further was asked on the way out. */
    expect(made.asked).toHaveLength(1);
  });

  it("re-asks when the picker moves to another page, because the page to skip changed", async () => {
    const made = boxWithElsewhere(nothingElsewhere);
    made.setEntry({ fields: model, values: values(), where: "site/site.en" });
    type("email");
    await settle();
    made.setEntry({ fields: model, values: values(), where: "site/site.fr" });
    await settle();
    expect(made.asked).toEqual([
      ["email", "site/site.en"],
      ["email", "site/site.fr"]
    ]);
  });

  /* Enter must never navigate away from the page an owner is on while a match
     on it is sitting on screen. */
  it("gives Enter the match on this page first, and the other pages only if there is none", async () => {
    const made = boxWithElsewhere(() =>
      Promise.resolve({ hits: [siteHit()], total: 1, entries: 3 })
    );
    made.setEntry({ fields: model, values: values(), where: "site/site.en" });

    type("Tagline");
    await settle();
    expect(localRows().length).toBeGreaterThan(0);
    expect(elsewhereRows()).toHaveLength(1);
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(made.onPick).toHaveBeenCalled();
    expect(made.onPickElsewhere).not.toHaveBeenCalled();

    made.onPick.mockClear();
    /* A word this entry does not have — the fixture's own contact block
       carries `hello@elfine.example`, which is the point of the fixture and
       would have matched here too. */
    type("Les heures d'ouverture");
    await settle();
    expect(localRows()).toHaveLength(0);
    expect(elsewhereRows()).toHaveLength(1);
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(made.onPickElsewhere).toHaveBeenCalled();
    expect(made.onPick).not.toHaveBeenCalled();
  });

  /* A panel with no way to ask is a panel that draws one list — which is what
     an older site against a newer kit would want, and is the feature's whole
     off switch. */
  it("draws nothing about other pages when it was given no way to look", () => {
    document.body.innerHTML = "";
    const made = box();
    made.setEntry({ fields: model, values: values() });
    type("email");
    expect(elsewhereNote()).toBe("");
    expect(elsewhereRows()).toHaveLength(0);
  });
});

describe("the search field in the panel", () => {
  it("is not on the page until an entry is", () => {
    document.body.innerHTML = "";
    const made = box();
    expect(made.element.hidden).toBe(true);
    made.setEntry({ fields: model, values: values() });
    expect(made.element.hidden).toBe(false);
  });

  it("draws where a match is, what it is called, and the words around it", () => {
    document.body.innerHTML = "";
    box().setEntry({ fields: model, values: values() });
    type("workroom");

    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.querySelector(".sk-editor__hitwhere")?.textContent).toBe(
      "Slides — Slide 2 — Description"
    );
    expect(rows()[0]?.querySelector("mark")?.textContent).toBe("workroom");
    expect(rows()[0]?.querySelector(".sk-editor__hitsnippet")?.textContent).toBe(
      "The workroom window"
    );
  });

  it("hands the panel the concrete path when a result is chosen", () => {
    document.body.innerHTML = "";
    const made = box();
    made.setEntry({ fields: model, values: values() });
    type("workroom");
    rows()[0]?.click();
    expect(made.onPick).toHaveBeenCalledWith("slides[1].alt");
  });

  it("takes the first result on Enter", () => {
    document.body.innerHTML = "";
    const made = box();
    made.setEntry({ fields: model, values: values() });
    type("workroom");
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(made.onPick).toHaveBeenCalledWith("slides[1].alt");
  });

  it("says how many, and says so when there are none", () => {
    document.body.innerHTML = "";
    box().setEntry({ fields: model, values: values() });
    type("the");
    const count = document.querySelector(".sk-editor__searchcount")!;
    expect(count.textContent).toMatch(/on this page$/);
    type("aubergine");
    expect(count.textContent).toBe(defaultStrings.searchNothing);
    expect(rows()).toHaveLength(0);
  });

  it("says out loud that it stopped short rather than silently dropping rows", () => {
    document.body.innerHTML = "";
    const many: Field[] = Array.from({ length: 30 }, (_, index) =>
      text(`f${index}`, `Field ${index}`)
    );
    box().setEntry({
      fields: many,
      values: Object.fromEntries(many.map((each) => [each.path, "needle"]))
    });
    type("needle");
    expect(rows()).toHaveLength(20);
    expect(document.querySelector(".sk-editor__hitmore")?.textContent).toBe(
      defaultStrings.searchNarrow
    );
  });

  /* The one place `dir="auto"` is right — these are the editor's own fields,
     and the same attribute on a site's content moved a plus sign 38px across
     nimagiti's live page. */
  it("lets the field and the snippet each decide their own direction", () => {
    document.body.innerHTML = "";
    box().setEntry({ fields: model, values: values() });
    type("workroom");
    expect(field().getAttribute("dir")).toBe("auto");
    expect(rows()[0]?.querySelector(".sk-editor__hitsnippet")?.getAttribute("dir")).toBe("auto");
    expect(rows()[0]?.querySelector(".sk-editor__hitwhere")?.getAttribute("dir")).toBe("auto");
  });

  it("empties itself on Escape", () => {
    document.body.innerHTML = "";
    box().setEntry({ fields: model, values: values() });
    type("workroom");
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(field().value).toBe("");
    expect(rows()).toHaveLength(0);
  });

  /* The panel hands over the same object its controls write into, so what an
     owner has typed this minute is what a search finds — not what the file
     held when the panel opened. */
  it("finds a word that was typed a moment ago rather than loaded", () => {
    document.body.innerHTML = "";
    const live = values() as { hero: { tagline: string } };
    const made = box();
    made.setEntry({ fields: model, values: live });
    type("cardigans");
    expect(rows()).toHaveLength(0);
    live.hero.tagline = "Slow cardigans, made once";
    type("cardigans");
    expect(rows()).toHaveLength(1);
  });
});

/* --- and it never writes ------------------------------------------------- */

describe("what a search does to the content", () => {
  /* Farsi is the case where a normalising search would do real damage: fold in
     place and an owner's ZWNJ or Persian digits are gone, the panel sends the
     folded string as an edit, and the first anyone knows is a commit. So the
     comparison is on a copy and the document is compared in bytes afterwards. */
  it("leaves the stored bytes exactly as they were", () => {
    /* One of everything A3.3 folds, so that a fold which normalised in place
       would have something of each kind to destroy: a zero-width non-joiner, a
       tanween, an alef with madda, and Persian digits. */
    const zwnj = String.fromCharCode(0x200c);
    const tanween = String.fromCharCode(0x064b);
    const title = "کتاب" + zwnj + "های معمولا" + tanween + " آ" + String.fromCharCode(0x06f1, 0x06f2, 0x06f3);
    const persian = { hero: { title, tagline: "  spaced   out  " } };
    const before = Buffer.from(JSON.stringify(persian), "utf8");

    /* Every path that touches the value: an exact query, one that only the
       forgiving pass can answer, an Arabic-keyboard spelling, the Latin
       digits, and the walk on its own. */
    searchEntry(
      [text("hero.title", "Title"), text("hero.tagline", "Tagline")],
      persian,
      "معمولا" + tanween
    );
    searchEntry([text("hero.title", "Title")], persian, "کتاب های");
    searchEntry([text("hero.title", "Title")], persian, "معمولا");
    searchEntry([text("hero.title", "Title")], persian, "123");
    searchEntry(
      [text("hero.title", "Title")],
      persian,
      "کتاب".split(String.fromCharCode(0x06a9)).join(String.fromCharCode(0x0643))
    );
    searchEntry([text("hero.title", "Title")], persian, "spaced out");
    entryFields([text("hero.title", "Title")], persian);

    const after = Buffer.from(JSON.stringify(persian), "utf8");
    expect(after.equals(before)).toBe(true);
    /* Named individually as well, because a deep-equal that both sides fold
       identically would pass while both were wrong. Code point by code point,
       because every character this stage added is one nobody can see. */
    expect(persian.hero.title).toBe(title);
    expect([...persian.hero.title].map((ch) => ch.codePointAt(0))).toEqual([
      ...title
    ].map((ch) => ch.codePointAt(0)));
    expect(persian.hero.title).toContain(zwnj);
    expect(persian.hero.title).toContain(tanween);
    expect(persian.hero.title).toContain(String.fromCharCode(0x06f1));
  });
});
