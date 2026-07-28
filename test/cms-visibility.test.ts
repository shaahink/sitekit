import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formModel, type Field } from "../src/cms/form.js";
import { hiddenSections, isVisible, visibleOnly } from "../src/cms/visibility.js";

/* Bez's shape, because his is the nav the runbook called the real work:
   in-page anchors to sections that can now be turned off, plus links to other
   pages that have nothing to do with this page's visibility. */
const page = {
  hero: { tagline: "Painter" },
  works: { visible: true, title: "Works" },
  partners: { visible: false, intro: "Three of them" },
  film: { title: "Film" },
  rooms: [
    { title: "Canvases", visible: true },
    { title: "Works on paper", visible: false }
  ]
};

describe("isVisible", () => {
  it("says yes for a section that carries the flag set", () => {
    expect(isVisible(page, "works")).toBe(true);
  });

  it("says no only for a literal false", () => {
    expect(isVisible(page, "partners")).toBe(false);
  });

  /* The safe default, and the reason the flag defaults to true in the schema:
     a section without it cannot be hidden, and existing content files need no
     migration to keep working. */
  it("says yes for a section that has no flag at all", () => {
    expect(isVisible(page, "film")).toBe(true);
  });

  /* A typo in a template must not silently delete a section from the page.
     "Show it" is the wrong answer that is noticed; "drop it" is the wrong
     answer that isn't. */
  it("says yes for a path that does not resolve", () => {
    expect(isVisible(page, "nosuchthing")).toBe(true);
    expect(isVisible(page, "works.title.deeper")).toBe(true);
    expect(isVisible(undefined, "works")).toBe(true);
  });

  it("reads a row of an array by index", () => {
    expect(isVisible(page, "rooms[0]")).toBe(true);
    expect(isVisible(page, "rooms[1]")).toBe(false);
  });

  it("says yes about the document itself", () => {
    expect(isVisible(page)).toBe(true);
  });
});

describe("visibleOnly", () => {
  const links = [
    { href: "#works", label: "Works", section: "works" },
    { href: "#partners", label: "Partners", section: "partners" },
    { href: "/showcase", label: "Showcase" },
    { href: "#film", label: "Film", section: "film" }
  ];

  it("drops the link to a section that is off and keeps the order", () => {
    expect(visibleOnly(links, page).map((link) => link.label)).toEqual(["Works", "Showcase", "Film"]);
  });

  /* The failure that would be worse than the one this feature exists to fix:
     a link to another page vanishing because it names no section. */
  it("keeps an item that names no section", () => {
    expect(visibleOnly([{ label: "About" }], page)).toHaveLength(1);
  });

  it("takes an accessor when the list spells it differently", () => {
    const chapters = [{ at: "works" }, { at: "partners" }];
    expect(visibleOnly(chapters, page, (chapter) => chapter.at)).toEqual([{ at: "works" }]);
  });

  it("changes nothing when the page hides nothing", () => {
    expect(visibleOnly(links, { works: {}, partners: {}, film: {} })).toHaveLength(4);
  });
});

describe("hiddenSections", () => {
  it("names every section that is off, in edit-path spelling", () => {
    expect(hiddenSections(page)).toEqual(["partners", "rooms[1]"]);
  });

  /* A subsection of something already off is not separately hidden, and
     listing it would invite an owner to turn it "back on" to no effect. */
  it("does not walk into a section that is already off", () => {
    const nested = { outer: { visible: false, inner: { visible: false } } };
    expect(hiddenSections(nested)).toEqual(["outer"]);
  });

  it("is empty for a page with nothing hideable", () => {
    expect(hiddenSections({ hero: { tagline: "x" } })).toEqual([]);
  });
});

describe("the form model lifts a section's switch out of its fields", () => {
  const schema = z.object({
    hero: z.object({ tagline: z.string() }),
    partners: z.object({
      visible: z.boolean().default(true),
      intro: z.string()
    }),
    /* A section whose every word is generated still has an owner who may want
       it off the page — so a group left holding only its switch survives, even
       though a group left holding nothing does not. */
    ticker: z.object({ visible: z.boolean().default(true) }),
    /* Not a boolean, so not a switch: guessing wrong here would put an on/off
       control in front of an owner that turns nothing off. */
    notes: z.object({ visible: z.string(), body: z.string() }),
    rooms: z.array(z.object({ visible: z.boolean().default(true), title: z.string() }))
  });

  const fields = formModel(schema);
  const at = (path: string): Field | undefined => {
    const find = (list: Field[]): Field | undefined => {
      for (const field of list) {
        if (field.path === path) return field;
        const hit =
          field.kind === "group" ? find(field.fields) : field.kind === "array" ? find([field.item]) : undefined;
        if (hit) return hit;
      }
      return undefined;
    };
    return find(fields);
  };

  it("carries the switch as `toggle`, not among the words", () => {
    const partners = at("partners");
    expect(partners?.kind).toBe("group");
    if (partners?.kind !== "group") return;
    expect(partners.toggle?.path).toBe("partners.visible");
    expect(partners.fields.map((field) => field.path)).toEqual(["partners.intro"]);
  });

  it("keeps a group whose only field was the switch", () => {
    const ticker = at("ticker");
    expect(ticker?.kind).toBe("group");
    if (ticker?.kind !== "group") return;
    expect(ticker.toggle?.path).toBe("ticker.visible");
    expect(ticker.fields).toEqual([]);
  });

  it("leaves a non-boolean `visible` as an ordinary field", () => {
    const notes = at("notes");
    if (notes?.kind !== "group") throw new Error("expected a group");
    expect(notes.toggle).toBeUndefined();
    expect(notes.fields.map((field) => field.path)).toEqual(["notes.visible", "notes.body"]);
  });

  it("works on an array row, so one item of a list can be turned off", () => {
    const rooms = at("rooms");
    if (rooms?.kind !== "array") throw new Error("expected an array");
    if (rooms.item.kind !== "group") throw new Error("expected a group row");
    expect(rooms.item.toggle?.path).toBe("rooms[].visible");
    expect(rooms.item.fields.map((field) => field.path)).toEqual(["rooms[].title"]);
  });

  it("leaves a page-level `visible` alone — a page cannot hide itself", () => {
    const top = formModel(z.object({ visible: z.boolean().default(true), title: z.string() }));
    expect(top.map((field) => field.path)).toEqual(["visible", "title"]);
    expect(top[0]?.kind).toBe("boolean");
  });
});
