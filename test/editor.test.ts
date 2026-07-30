/* The editor's arithmetic.
   ---------------------------------------------------------------------------
   The panel is mostly DOM construction, and that is verified by browser passes
   the way the widget's chrome is. What can be tested without a browser is the
   part that would be wrong silently: reading a value out of a parsed document
   by path, pointing a repeater's template at a real row, turning a control's
   string back into what the schema meant, and knowing what the owner touched.

   Those four are exactly where a bug would corrupt an owner's content rather
   than merely look wrong, so they live in files with no DOM in them and are
   tested here. */

import { describe, expect, it } from "vitest";
import type { Field } from "../src/cms/fields.js";
import { Dirty } from "../src/editor/dirty.js";
import {
  coerce,
  draftText,
  emptyRequired,
  fieldId,
  plural,
  retarget,
  valueAt
} from "../src/editor/values.js";
import { defaultStrings, fill } from "../src/editor/strings.js";

const text = (path: string): Field => ({
  path,
  label: path,
  required: true,
  kind: "text",
  long: true
});

describe("valueAt", () => {
  const doc = {
    hero: {
      cue: "Enter",
      slides: [{ alt: "A black canvas" }, { alt: "تکرار" }]
    },
    grid: [[{ n: 1 }, { n: 2 }]],
    empty: null
  };

  it("reads a plain path", () => {
    expect(valueAt(doc, "hero.cue")).toBe("Enter");
  });

  it("reads through an index", () => {
    expect(valueAt(doc, "hero.slides[1].alt")).toBe("تکرار");
  });

  it("reads through stacked indices", () => {
    expect(valueAt(doc, "grid[0][1].n")).toBe(2);
  });

  it("gives undefined for a path that isn't there, at any depth", () => {
    expect(valueAt(doc, "hero.missing")).toBeUndefined();
    expect(valueAt(doc, "nothing.at.all")).toBeUndefined();
    expect(valueAt(doc, "hero.slides[9].alt")).toBeUndefined();
    expect(valueAt(doc, "empty.anything")).toBeUndefined();
  });

  /* A field's own value must never be its parent's: an object rendered into a
     text control would show as [object Object] and then be saved over the real
     thing. Absent is the safer wrong answer. */
  it("gives undefined for a malformed segment rather than the parent", () => {
    expect(valueAt(doc, "hero.slides[x].alt")).toBeUndefined();
  });

  it("does not walk into a string's own properties", () => {
    expect(valueAt(doc, "hero.cue.length")).toBeUndefined();
  });
});

describe("retarget", () => {
  const row: Field = {
    path: "hero.slides[]",
    label: "Slide",
    required: true,
    kind: "group",
    fields: [text("hero.slides[].src"), text("hero.slides[].alt")]
  };

  it("points a row template at a concrete index, all the way down", () => {
    const at = retarget(row, "hero.slides[]", "hero.slides[2]");
    expect(at.path).toBe("hero.slides[2]");
    expect(at.kind).toBe("group");
    if (at.kind !== "group") throw new Error("unreachable");
    expect(at.fields.map((f) => f.path)).toEqual(["hero.slides[2].src", "hero.slides[2].alt"]);
  });

  it("descends into a nested list", () => {
    const nested: Field = {
      path: "rooms[]",
      label: "Room",
      required: true,
      kind: "group",
      fields: [
        {
          path: "rooms[].pieces",
          label: "Pieces",
          required: true,
          kind: "array",
          item: text("rooms[].pieces[].title")
        }
      ]
    };
    const at = retarget(nested, "rooms[]", "rooms[0]");
    if (at.kind !== "group") throw new Error("unreachable");
    const list = at.fields[0];
    if (list?.kind !== "array") throw new Error("unreachable");
    expect(list.path).toBe("rooms[0].pieces");
    expect(list.item.path).toBe("rooms[0].pieces[].title");
  });

  it("leaves the original untouched, so the next row starts from the template", () => {
    retarget(row, "hero.slides[]", "hero.slides[2]");
    expect(row.fields.map((f) => f.path)).toEqual(["hero.slides[].src", "hero.slides[].alt"]);
  });

  it("leaves a path that doesn't share the prefix alone", () => {
    expect(retarget(text("meta.title"), "hero.slides[]", "hero.slides[0]").path).toBe("meta.title");
  });
});

describe("coerce", () => {
  it("keeps a string a string", () => {
    expect(coerce(text("hero.cue"), "Enter")).toBe("Enter");
  });

  it("makes a number a number", () => {
    const field: Field = { path: "order", label: "Order", required: true, kind: "number", integer: true };
    expect(coerce(field, "3")).toBe(3);
  });

  /* An emptied number is "nothing", not zero. Letting Zod reject it is more
     honest than inventing a value the owner did not type. */
  it("makes an emptied number null rather than zero", () => {
    const field: Field = { path: "order", label: "Order", required: true, kind: "number", integer: true };
    expect(coerce(field, "")).toBeNull();
  });

  it("makes a checkbox a boolean", () => {
    const field: Field = { path: "tall", label: "Tall", required: false, kind: "boolean" };
    expect(coerce(field, false)).toBe(false);
  });

  /* The select's options carry the schema's own types — `columns: 2` is the
     number two, and a form that sent "2" would fail validation. */
  it("returns a select's option in the schema's type, not the control's", () => {
    const field: Field = {
      path: "columns",
      label: "Columns",
      required: true,
      kind: "select",
      options: [
        { value: 2, label: "2" },
        { value: 3, label: "3" }
      ]
    };
    expect(coerce(field, "3")).toBe(3);
  });
});

describe("Dirty", () => {
  it("holds only what changed", () => {
    const dirty = new Dirty();
    dirty.track("hero.cue", "Enter");
    dirty.track("hero.tagline", "A line");
    expect(dirty.update("hero.cue", "Begin", "Begin")).toBe(true);
    expect(dirty.size).toBe(1);
    expect(dirty.edits()).toEqual([{ path: "hero.cue", value: "Begin" }]);
  });

  it("un-marks a field typed back to what it was", () => {
    const dirty = new Dirty();
    dirty.track("hero.cue", "Enter");
    dirty.update("hero.cue", "Begin", "Begin");
    expect(dirty.update("hero.cue", "Enter", "Enter")).toBe(false);
    expect(dirty.size).toBe(0);
    expect(dirty.has("hero.cue")).toBe(false);
  });

  /* The pilot's own test: change a word, save, then revert it — without
     reloading the page. Before settle() existed, the original stayed at the
     pre-save value, so typing the old word back read as "no change" and the
     save button never re-enabled. Reverting an edit through the editor was
     impossible. */
  it("makes a saved value the new original, so a second edit reverts it", () => {
    const dirty = new Dirty();
    dirty.track("hero.cue", "Enter");
    dirty.update("hero.cue", "Begin", "Begin");
    dirty.settle();
    expect(dirty.size).toBe(0);
    expect(dirty.update("hero.cue", "Enter", "Enter")).toBe(true);
    expect(dirty.edits()).toEqual([{ path: "hero.cue", value: "Enter" }]);
  });

  it("sends the schema's value, not the control's string", () => {
    const dirty = new Dirty();
    dirty.track("columns", "2");
    dirty.update("columns", "3", 3);
    expect(dirty.edits()).toEqual([{ path: "columns", value: 3 }]);
  });

  it("carries nothing across a different entry", () => {
    const dirty = new Dirty();
    dirty.track("hero.cue", "Enter");
    dirty.update("hero.cue", "Begin", "Begin");
    dirty.reset();
    expect(dirty.size).toBe(0);
    /* Untracked now, so any value reads as a change rather than as equal to a
       stale original from the previous file. */
    expect(dirty.update("hero.cue", "Enter", "Enter")).toBe(true);
  });

  /* `touched` is `has` plus the one case `has` cannot see, and F8's guard is
     built on the difference: a row an owner added this minute is theirs, and
     `clearUnder` has taken its scalars out of `changes` because the array
     travels whole. */
  it("counts a field inside a list the owner reshaped as touched", () => {
    const dirty = new Dirty();
    dirty.trackList("slides", [{ alt: "One" }]);
    dirty.track("slides[0].alt", "One");
    expect(dirty.touched("slides[0].alt")).toBe(false);

    dirty.updateList("slides", [{ alt: "One" }, { alt: "" }]);
    expect(dirty.has("slides[1].alt")).toBe(false);
    expect(dirty.touched("slides[1].alt")).toBe(true);
    /* And a path that merely starts with the same letters is not inside it. */
    expect(dirty.touched("slideshow.alt")).toBe(false);
  });
});

/* --- what a required field being empty means (§2.6, F8) ------------------ */

describe("emptyRequired", () => {
  const model: Field[] = [
    {
      kind: "group",
      path: "hero",
      label: "Hero",
      required: true,
      fields: [
        text("hero.tagline"),
        { ...text("hero.note"), required: false },
        { kind: "boolean", path: "hero.visible", label: "Visible", required: true },
        { kind: "number", path: "hero.columns", label: "Columns", required: true, integer: true },
        { kind: "image", path: "hero.photo", label: "Photo", required: true, altPath: "hero.photoAlt" }
      ]
    }
  ];

  it("names a required string that is empty and leaves the rest alone", () => {
    expect(
      emptyRequired(model, {
        hero: { tagline: "", note: "", visible: false, columns: 2, photo: "/a.jpg" }
      })
    ).toEqual(["hero.tagline"]);
  });

  it("reads whitespace as empty, because a schema accepts it and a page shows nothing", () => {
    expect(
      emptyRequired(model, { hero: { tagline: "  ", visible: true, columns: 1, photo: "/a.jpg" } })
    ).toContain("hero.tagline");
  });

  it("treats zero and false as answers", () => {
    const empty = emptyRequired(model, {
      hero: { tagline: "A line", visible: false, columns: 0, photo: "/a.jpg" }
    });
    expect(empty).toEqual([]);
  });

  it("says nothing about a photograph, which is the picker's question", () => {
    /* An image's value can be a staged upload the server resolves, so emptiness
       here would be a lie half the time — and `Uploads.missingAlt` already holds
       Save for the half that matters. */
    expect(
      emptyRequired(model, { hero: { tagline: "A line", visible: true, columns: 1, photo: "" } })
    ).toEqual([]);
  });

  it("misses nothing when a required number has been cleared", () => {
    expect(
      emptyRequired(model, {
        hero: { tagline: "A line", visible: true, columns: null, photo: "/a.jpg" }
      })
    ).toEqual(["hero.columns"]);
  });

  it("asks each row of a list in its own right", () => {
    const list: Field[] = [
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
          fields: [text("slides[].alt")]
        }
      }
    ];
    expect(emptyRequired(list, { slides: [{ alt: "One" }, { alt: "" }, { alt: "Three" }] })).toEqual([
      "slides[1].alt"
    ]);
    /* An empty list is a real state — a gallery with nothing in it yet. */
    expect(emptyRequired(list, { slides: [] })).toEqual([]);
    expect(emptyRequired(list, {})).toEqual([]);
  });
});

/* --- the words a conflict offers to keep (§2.6, F7) ---------------------- */

describe("draftText", () => {
  const model = [text("hero.tagline"), { ...text("hero.note"), label: "Note" }];

  it("writes each change under the field's own label, and where it was", () => {
    expect(
      draftText(model, [{ path: "hero.tagline", value: "A new line" }], "https://example.com/")
    ).toBe("hero.tagline:\nA new line\n\n— https://example.com/");
  });

  it("falls back to the path when the model has no such field", () => {
    expect(draftText(model, [{ path: "gone.away", value: "Words" }], "/")).toContain("gone.away:");
  });

  it("writes a whole reordered list rather than leaving it out", () => {
    const out = draftText(model, [{ path: "slides", value: [{ alt: "One" }] }], "/");
    expect(out).toContain('[{"alt":"One"}]');
  });
});

describe("labels and ids", () => {
  it("makes a path safe for an id", () => {
    expect(fieldId("hero.slides[0].alt")).toBe("f-hero-slides-0-alt");
  });

  it("pluralises with words it was given, so it can be translated", () => {
    expect(plural(1, "change", "changes")).toBe("1 change");
    expect(plural(2, "change", "changes")).toBe("2 changes");
  });

  it("fills a template", () => {
    expect(fill(defaultStrings.editingFile, { path: "home.yaml" })).toBe("Editing home.yaml");
  });

  it("leaves an unknown placeholder alone rather than blanking it", () => {
    expect(fill("Editing {path} in {where}", { path: "home.yaml" })).toBe(
      "Editing home.yaml in {where}"
    );
  });
});
