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

import { describe, expect, it, vi } from "vitest";
import type { Field } from "../src/cms/fields.js";
import {
  entryFields,
  findIn,
  fold,
  foldQuery,
  searchBox,
  searchEntry
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
    const persian = {
      hero: { title: "کتاب‌های معمولاً ۱۲۳", tagline: "  spaced   out  " }
    };
    const before = Buffer.from(JSON.stringify(persian), "utf8");

    searchEntry(
      [text("hero.title", "Title"), text("hero.tagline", "Tagline")],
      persian,
      "معمولاً"
    );
    searchEntry([text("hero.title", "Title")], persian, "spaced out");
    entryFields([text("hero.title", "Title")], persian);

    const after = Buffer.from(JSON.stringify(persian), "utf8");
    expect(after.equals(before)).toBe(true);
    /* Named individually as well, because a deep-equal that both sides fold
       identically would pass while both were wrong. */
    expect(persian.hero.title).toBe("کتاب‌های معمولاً ۱۲۳");
  });
});
