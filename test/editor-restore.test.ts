// @vitest-environment happy-dom

/* The control that puts a change back, on the surface it lives on.
   ---------------------------------------------------------------------------
   The server half of this is proven in cms-restore.test.ts. What is proven
   here is the half that decides whether an owner ever presses it safely: that
   nothing is sent until they have answered a question, that a refusal reaches
   them in the server's own words, and that after one restore the rest of the
   list stops offering buttons whose only possible answer is a refusal.

   Session 23 measured `restoreControls = 0` on a live client's panel while the
   first screen of that same panel promised, in three languages, that anything
   could be put back. The first test here is that measurement, inverted. */

import { describe, expect, it, vi } from "vitest";
import { home, type HomeData } from "../src/editor/home.js";
import { defaultStrings, editorLocales } from "../src/editor/strings.js";

const CHANGES: HomeData = {
  linkable: false,
  changes: [
    {
      sha: "bbbbbbb222222222222222222222222222222222",
      subject: "Variant A — the paged book (#57)",
      at: "2026-07-30T09:00:00Z",
      who: undefined
    },
    {
      sha: "aaaaaaa111111111111111111111111111111111",
      subject: "Edit home.en.yaml: hero.title",
      summary: "Changed 1 thing on home.en",
      who: "Elfine",
      at: "2026-07-29T09:00:00Z"
    }
  ]
};

function storage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: 0
  } as Storage;
}

function panel(onRestore?: (sha: string) => Promise<{ changed: boolean; files: number }>) {
  const owner = home({
    strings: defaultStrings,
    onRequest: async () => "",
    ...(onRestore ? { onRestore } : {}),
    storage: storage()
  });
  document.body.replaceChildren(owner.element);
  owner.setData(CHANGES);
  return owner.element;
}

const controls = (root: HTMLElement) => [...root.querySelectorAll(".sk-editor__restore")];
const button = (root: HTMLElement, index = 0) =>
  controls(root)[index]?.querySelector("button") as HTMLButtonElement;
const text = (root: HTMLElement) =>
  (root.querySelector(".sk-editor__restorequestion") as HTMLElement | null)?.textContent ?? "";

describe("the change list", () => {
  it("offers a way to put every change back", () => {
    /* The inverse of A4.1's measurement. Both rows, including the merge commit
       that is the motivating case — an unpicked redesign that reached a live
       site through a tool. */
    const root = panel(async () => ({ changed: true, files: 1 }));
    expect(controls(root)).toHaveLength(2);
    expect(button(root).textContent).toBe(defaultStrings.homeRestore);
  });

  it("offers none at all when the panel was given no way to do it", () => {
    expect(controls(panel())).toHaveLength(0);
  });

  it("never says undo or revert, because those words are the unsaved case", () => {
    /* `inline-bar.ts` owns "undo" and "revert" for a field the owner has typed
       into and not saved. Two very different actions behind one word is how an
       owner learns to distrust both. */
    for (const table of Object.values(editorLocales)) {
      expect(table.homeRestore).not.toBe(table.revert);
      expect(table.homeRestore).not.toBe(table.inlineRevert);
    }
    expect(defaultStrings.homeRestore.toLowerCase()).not.toContain("undo");
    expect(defaultStrings.homeRestore.toLowerCase()).not.toContain("revert");
  });
});

describe("pressing it", () => {
  it("sends nothing until the question is answered", async () => {
    const restore = vi.fn(async () => ({ changed: true, files: 1 }));
    const root = panel(restore);

    button(root).click();
    expect(restore).not.toHaveBeenCalled();
    expect(text(root)).toBe(defaultStrings.homeRestoreConfirm);
  });

  it("takes the question back and changes nothing when the answer is no", () => {
    const restore = vi.fn(async () => ({ changed: true, files: 1 }));
    const root = panel(restore);

    button(root).click();
    const [, no] = [...(controls(root)[0] as HTMLElement).querySelectorAll("button")].slice(1);
    (no as HTMLButtonElement).click();

    expect(restore).not.toHaveBeenCalled();
    expect(root.querySelector(".sk-editor__restoreask")).toBeNull();
    expect(button(root).hidden).toBe(false);
  });

  it("sends the sha of the row it is on, not the newest one", async () => {
    const restore = vi.fn(async () => ({ changed: true, files: 1 }));
    const root = panel(restore);

    button(root, 1).click();
    const yes = (controls(root)[1] as HTMLElement).querySelector(
      ".sk-editor__restoreyes"
    ) as HTMLButtonElement;
    yes.click();
    await vi.waitFor(() => expect(restore).toHaveBeenCalled());
    expect(restore).toHaveBeenCalledWith("aaaaaaa111111111111111111111111111111111");
  });

  it("says how many pages moved, counted by the server", async () => {
    const root = panel(async () => ({ changed: true, files: 2 }));
    button(root).click();
    (root.querySelector(".sk-editor__restoreyes") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      const done = root.querySelector(".sk-editor__restoredone");
      expect(done?.textContent).toContain("2 pages");
    });
  });

  it("takes every other control away once one has fired", async () => {
    /* After a restore the remaining rows describe a site that no longer
       exists, and the server would refuse them with "put the newest change
       back first". A button whose only possible answer is a refusal is worse
       than no button. */
    const root = panel(async () => ({ changed: true, files: 1 }));
    button(root).click();
    (root.querySelector(".sk-editor__restoreyes") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(root.querySelector(".sk-editor__restoredone")).not.toBeNull());
    expect(controls(root)).toHaveLength(0);
  });

  it("promises no rebuild when nothing was written", async () => {
    /* `changed: false` is the second press, and the site is not rebuilding.
       Saying it is would be the panel spending a deploy slot in an owner's
       imagination. */
    const root = panel(async () => ({ changed: false, files: 0 }));
    button(root).click();
    (root.querySelector(".sk-editor__restoreyes") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(text(root)).toBe(defaultStrings.homeRestoreNothing));
    expect(root.querySelector(".sk-editor__restoredone")).toBeNull();
    /* And the other rows are still offered: nothing moved, so nothing about
       them has gone stale. */
    expect(controls(root)).toHaveLength(2);
  });

  it("shows the server's own refusal and lets them try again", async () => {
    const root = panel(async () => {
      throw new Error("Put the newest change back first.");
    });
    button(root).click();
    (root.querySelector(".sk-editor__restoreyes") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(text(root)).toBe("Put the newest change back first."));
    const yes = root.querySelector(".sk-editor__restoreyes") as HTMLButtonElement;
    expect(yes.disabled).toBe(false);
    expect(controls(root)).toHaveLength(2);
  });
});

describe("the promise on the first screen", () => {
  it("no longer says the only way to put something back is to ask", () => {
    /* The finding of session 23's survey: this sentence promised revert in
       three languages on every site in the fleet and the surface had no
       control that did it. It now names the control. */
    for (const [locale, table] of Object.entries(editorLocales)) {
      expect(table.homeWelcomeUndo, locale).toContain(table.homeRestore);
    }
  });
});
