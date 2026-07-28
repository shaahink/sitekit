/* Rows moving, and what that does to what gets saved.
   ---------------------------------------------------------------------------
   This is the arithmetic under the gallery controls, and it is the part with a
   way to be silently wrong: once a row moves, `slides[1].alt` names a different
   photograph's caption, so a set of per-path edits describes the file the owner
   *had*, not the one they are looking at. The array goes whole instead, and
   everything here is about that rule holding at the edges. */

import { describe, expect, it } from "vitest";
import type { Field } from "../src/cms/fields.js";
import { Dirty } from "../src/editor/dirty.js";
import { retarget, valueAt, writeAt } from "../src/editor/values.js";

describe("a list that has been reordered", () => {
  const rows = (): unknown[] => [{ alt: "one" }, { alt: "two" }, { alt: "three" }];

  it("is not a change until something moves", () => {
    const dirty = new Dirty();
    const list = rows();
    dirty.trackList("slides", list);
    expect(dirty.updateList("slides", list)).toBe(false);
    expect(dirty.size).toBe(0);
    expect(dirty.edits()).toEqual([]);
  });

  it("sends the whole array, once", () => {
    const dirty = new Dirty();
    const list = rows();
    dirty.trackList("slides", list);
    list.reverse();
    expect(dirty.updateList("slides", list)).toBe(true);
    expect(dirty.edits()).toEqual([
      { path: "slides", value: [{ alt: "three" }, { alt: "two" }, { alt: "one" }] }
    ]);
  });

  /* Moving a row down and back up is not an edit. Safe to un-record precisely
     because an array identical to its original has identical scalars in it. */
  it("stops being a change when the rows come back", () => {
    const dirty = new Dirty();
    const list = rows();
    dirty.trackList("slides", list);
    list.reverse();
    expect(dirty.updateList("slides", list)).toBe(true);
    list.reverse();
    expect(dirty.updateList("slides", list)).toBe(false);
    expect(dirty.edits()).toEqual([]);
  });

  /* The one that would corrupt content: two edits that disagree about what
     `slides[0]` is, applied in whatever order a Map happens to iterate. */
  it("swallows the scalar edits inside it rather than sending both", () => {
    const dirty = new Dirty();
    const list = rows();
    dirty.trackList("slides", list);
    dirty.track("slides[0].alt", "one");
    dirty.track("title", "Gallery");

    dirty.update("slides[0].alt", "ONE", "ONE");
    dirty.update("title", "Pictures", "Pictures");
    expect(dirty.size).toBe(2);

    list.reverse();
    dirty.updateList("slides", list);

    /* The array and the untouched field beside it — never `slides[0].alt`. */
    expect(dirty.edits().map((edit) => edit.path)).toEqual(["slides", "title"]);
    expect(dirty.size).toBe(2);
  });

  it("counts a reorder as one change, not one per row", () => {
    const dirty = new Dirty();
    const list = rows();
    dirty.trackList("slides", list);
    for (const [index, row] of list.entries()) dirty.track(`slides[${index}].alt`, String(row));
    list.unshift(list.pop());
    dirty.updateList("slides", list);
    expect(dirty.size).toBe(1);
  });

  it("forgets scalar changes under a list that is being redrawn", () => {
    const dirty = new Dirty();
    dirty.track("slides[0].alt", "one");
    dirty.track("slides[1].alt", "two");
    dirty.track("hero.alt", "keep me");
    dirty.update("slides[0].alt", "ONE", "ONE");
    dirty.update("hero.alt", "kept", "kept");

    dirty.clearUnder("slides");
    expect(dirty.edits().map((edit) => edit.path)).toEqual(["hero.alt"]);
  });

  it("takes the saved shape as the new original", () => {
    const dirty = new Dirty();
    const list = rows();
    dirty.trackList("slides", list);
    list.reverse();
    dirty.updateList("slides", list);
    dirty.settle();

    expect(dirty.edits()).toEqual([]);
    expect(dirty.updateList("slides", list)).toBe(false);
    list.reverse();
    expect(dirty.updateList("slides", list)).toBe(true);
  });

  it("carries nothing across into a different entry", () => {
    const dirty = new Dirty();
    const list = rows();
    dirty.trackList("slides", list);
    list.pop();
    dirty.updateList("slides", list);
    dirty.reset();
    expect(dirty.size).toBe(0);
    expect(dirty.edits()).toEqual([]);
  });
});

/* The model describes one row as a template — `pieces[].alt` — and the panel
   points it at each index in turn. Two things hang off a field rather than
   being fields themselves, and both were missed the first time: a group's
   lifted `visible` switch, and a picture's sibling paths. Left as templates
   they send `pieces[].w` as an edit, which is a path no document has. */
describe("retarget reaches what is not a field", () => {
  it("points a row's own switch at the row", () => {
    const row: Field = {
      kind: "group",
      path: "rooms[]",
      label: "Room",
      required: true,
      fields: [{ kind: "text", path: "rooms[].title", label: "Title", required: true, long: false }],
      toggle: { kind: "boolean", path: "rooms[].visible", label: "Visible", required: false, default: true }
    };
    const first = retarget(row, "rooms[]", "rooms[0]");
    if (first.kind !== "group") throw new Error("expected a group");
    expect(first.toggle?.path).toBe("rooms[0].visible");
    expect(first.fields[0]?.path).toBe("rooms[0].title");
  });

  it("points a picture's sizes and description at the row", () => {
    const picture: Field = {
      kind: "image",
      path: "pieces[].src",
      label: "Src",
      required: true,
      widthPath: "pieces[].w",
      heightPath: "pieces[].h",
      altPath: "pieces[].alt"
    };
    expect(retarget(picture, "pieces[]", "pieces[2]")).toMatchObject({
      path: "pieces[2].src",
      widthPath: "pieces[2].w",
      heightPath: "pieces[2].h",
      altPath: "pieces[2].alt"
    });
  });
});

describe("writeAt", () => {
  it("writes where valueAt reads", () => {
    const doc = { hero: { slides: [{ alt: "one" }] } };
    expect(writeAt(doc, "hero.slides[0].alt", "changed")).toBe(true);
    expect(valueAt(doc, "hero.slides[0].alt")).toBe("changed");
  });

  /* Adding the first row of a list the file never had. */
  it("creates the steps that are missing", () => {
    const doc: Record<string, unknown> = {};
    expect(writeAt(doc, "gallery.images[0].src", "a.jpg")).toBe(true);
    expect(doc).toEqual({ gallery: { images: [{ src: "a.jpg" }] } });
  });

  /* A numeric step means a list. Reading this off the wrong key is how
     `images` ends up an object with a property called "0". */
  it("creates a list for a numeric step, not an object", () => {
    const doc: Record<string, unknown> = {};
    writeAt(doc, "images[0]", "a.jpg");
    expect(Array.isArray(doc.images)).toBe(true);
  });

  /* A path that disagrees with the document is a fault in the caller.
     Overwriting a string with an object to satisfy it turns that into lost
     content, so it refuses instead. */
  it("refuses to walk through a value of the wrong shape", () => {
    const doc = { hero: "a string" };
    expect(writeAt(doc, "hero.tagline", "x")).toBe(false);
    expect(doc.hero).toBe("a string");
  });

  it("refuses an empty path", () => {
    expect(writeAt({}, "", "x")).toBe(false);
  });
});
