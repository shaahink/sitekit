/* Inline editing's arithmetic.
   ---------------------------------------------------------------------------
   Same division as editor.test.ts: the layer that touches the DOM is verified
   in a browser, and everything that would be wrong *silently* is tested here.

   Two things qualify. Looking a field up by a concrete path decides what an
   owner is told they are editing — get it wrong and the bar says "Alt" while
   they type into a caption. And the draft rules decide whether unsaved work is
   restored, dropped, or replayed over somebody else's commit, which is the one
   place in this feature where a bug destroys content rather than annoying
   someone. */

import { describe, expect, it } from "vitest";
import type { Field } from "../src/cms/fields.js";
import { findField, templateOf } from "../src/editor/values.js";
import {
  clearDraft,
  draftKey,
  readDraft,
  saveDraft,
  type Draft,
  type DraftStore
} from "../src/editor/drafts.js";

const text = (path: string, label: string): Field => ({
  path,
  label,
  required: true,
  kind: "text",
  long: false
});

describe("templateOf", () => {
  it("turns a concrete row back into the model's template", () => {
    expect(templateOf("hero.slides[0].alt")).toBe("hero.slides[].alt");
  });

  it("handles more than one index", () => {
    expect(templateOf("rooms[2].pieces[11].title")).toBe("rooms[].pieces[].title");
  });

  it("leaves a plain path alone", () => {
    expect(templateOf("hero.tagline")).toBe("hero.tagline");
  });
});

describe("findField", () => {
  const model: Field[] = [
    {
      path: "hero",
      label: "Hero",
      required: true,
      kind: "group",
      fields: [text("hero.tagline", "Tagline"), text("hero.title", "Title")]
    },
    {
      path: "hero.slides",
      label: "Slides",
      required: false,
      kind: "array",
      item: {
        path: "hero.slides[]",
        label: "Slide",
        required: true,
        kind: "group",
        fields: [text("hero.slides[].alt", "Alt text")]
      }
    }
  ];

  it("finds a field nested in a group", () => {
    expect(findField(model, "hero.tagline")?.label).toBe("Tagline");
  });

  it("finds an array item's field from a concrete index", () => {
    expect(findField(model, "hero.slides[3].alt")?.label).toBe("Alt text");
  });

  it("returns undefined for a path the model has no field for", () => {
    /* Which is how an annotation left behind by a redesign — or pointing at
       something on the omit list — becomes visible rather than silent. */
    expect(findField(model, "hero.subtitle")).toBeUndefined();
  });

  it("does not mistake a prefix for a match", () => {
    expect(findField(model, "hero.tag")).toBeUndefined();
  });
});

/* A Map standing in for sessionStorage, plus one that throws the way private
   browsing does. */
function store(): DraftStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key)
  };
}

const hostile: DraftStore = {
  getItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("denied");
  },
  removeItem() {
    throw new Error("denied");
  }
};

const draft = (sha: string): Draft => ({
  sha,
  edits: [{ path: "hero.tagline", value: "new words" }],
  raw: { "hero.tagline": "new words" }
});

describe("drafts", () => {
  const key = draftKey("homePage", "home");

  it("names a key per collection and entry, so two pages cannot collide", () => {
    expect(draftKey("homePage", "home")).not.toBe(draftKey("homePage", "about"));
  });

  it("offers back a draft written against the same blob", () => {
    const s = store();
    saveDraft(s, key, draft("abc"));
    const verdict = readDraft(s, key, "abc");
    expect(verdict.state).toBe("usable");
  });

  it("refuses a draft the file has moved on from", () => {
    /* The whole point of keeping the sha. Replaying these edits would write
       over whatever the other commit did. */
    const s = store();
    saveDraft(s, key, draft("abc"));
    const verdict = readDraft(s, key, "def");
    expect(verdict.state).toBe("stale");
  });

  it("reports nothing when there is nothing", () => {
    expect(readDraft(store(), key, "abc").state).toBe("none");
  });

  it("removes the draft rather than storing an empty one", () => {
    const s = store();
    saveDraft(s, key, draft("abc"));
    saveDraft(s, key, { sha: "abc", edits: [], raw: {} });
    expect(s.map.has(key)).toBe(false);
  });

  it("treats corrupt storage as absent and clears it", () => {
    const s = store();
    s.map.set(key, "{not json");
    expect(readDraft(s, key, "abc").state).toBe("none");
    expect(s.map.has(key)).toBe(false);
  });

  it("treats a draft from an older shape as absent", () => {
    const s = store();
    s.map.set(key, JSON.stringify({ sha: "abc" }));
    expect(readDraft(s, key, "abc").state).toBe("none");
  });

  it("survives a storage that throws on every call", () => {
    /* Private browsing. Edit mode has to keep working without its safety net
       rather than failing to start. */
    expect(() => saveDraft(hostile, key, draft("abc"))).not.toThrow();
    expect(() => clearDraft(hostile, key)).not.toThrow();
    expect(readDraft(hostile, key, "abc").state).toBe("none");
  });
});
