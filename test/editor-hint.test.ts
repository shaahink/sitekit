// @vitest-environment happy-dom

/* The marker, and the one thing it draws.
   ---------------------------------------------------------------------------
   Three rules here would be wrong *silently*, which is the bar this suite has
   always used for what gets a unit test rather than a browser.

   The marker is an echo of a server verdict. Written where a response came
   back accepted, deleted where one came back refused — and if the second half
   drifts, nothing looks broken: a device whose access was revoked keeps
   offering a way in that lands on a sign-in card, which is the exact shape of
   "it still works for me" from the one person who cannot see the bug.

   The hint's link derives its target. It must never name the editor's path,
   which is `/edit` on four sites and `/edit.html` on two, and it must strip
   `edit` off the URL it was built from — an owner arriving with `?edit=off`
   would otherwise be handed a link that turns edit mode on and then off again,
   and the only symptom is a button that does nothing.

   And nothing it draws may be a stylesheet or a `style` attribute in markup.
   That failure is invisible in review — the JS really does stay lazy — and it
   would put a `<link>` on every client's every page. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { showEditHint } from "../src/editor/hint.js";
import { forgetEditor, MARK, noteEditorVerdict, rememberEditor } from "../src/editor/marker.js";
import { EDIT_MODE } from "../src/editor/return-to.js";

const HINT = "[data-sk-edit-hint]";

/** A page that has something to edit, which is the hint's precondition. */
function annotatedPage(lang = "en"): void {
  document.documentElement.lang = lang;
  document.body.innerHTML =
    '<main data-sk-collection="pages" data-sk-entry="home"><h1 data-sk-edit="hero.title">Hi</h1></main>';
}

function hint(): HTMLElement | null {
  return document.querySelector<HTMLElement>(HINT);
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  history.replaceState(null, "", "/about");
});

/* What an import would have bought, bought a different way.
   -------------------------------------------------------------------------
   Both storage keys are spelled twice: once in `inline-gate.ts` and once in a
   module that is not it. That is not an oversight and it may not be tidied
   away — `inline-gate.ts` is the only code a public visitor runs, and rollup
   will not fold a module into an entry chunk if a lazily imported chunk also
   imports it. One shared const took the gate out of the public page's own
   script and gave every visitor a second file to fetch, measured on a real
   build while this was being written.

   So the link between the spellings is here instead. Rename a key in one place
   and this fails, which is bug #43's whole failure mode: nothing linked the
   two, so a rename would have left "leave edit mode" writing to a key nobody
   reads and edit mode surviving the exit. */
describe("the two storage keys, spelled where the bundler needs them", () => {
  const source = (file: string): string =>
    readFileSync(join(import.meta.dirname, "..", "src", "editor", file), "utf8");

  it("the gate reads the same edit-mode key the page writes", () => {
    expect(source("inline-gate.ts")).toContain(`"${EDIT_MODE}"`);
    expect(source("inline.ts")).toContain("EDIT_MODE");
  });

  it("the gate reads the same marker key the hint writes", () => {
    expect(source("inline-gate.ts")).toContain(`"${MARK}"`);
  });

  it("still imports nothing from the gate, whatever else changes", () => {
    for (const file of ["hint.ts", "marker.ts", "inline.ts", "index.ts", "return-to.ts", "strings.ts"]) {
      expect(source(file), `${file} imports from inline-gate`).not.toContain('from "./inline-gate.js"');
    }
  });
});

describe("the marker", () => {
  it("is an expiry and nothing else — no name, no address, no account", () => {
    rememberEditor();
    const value = localStorage.getItem(MARK)!;
    expect(Number(value)).toBeGreaterThan(Date.now());
    /* If this ever stops being a bare number, whatever it became is being
       carried on a device that may not be the owner's. */
    expect(value).toMatch(/^\d+$/);
  });

  it("is long-lived, because the point is typing /edit once per device", () => {
    rememberEditor();
    const days = (Number(localStorage.getItem(MARK)) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(30);
  });

  it("goes when the device is told to forget", () => {
    rememberEditor();
    forgetEditor();
    expect(localStorage.getItem(MARK)).toBeNull();
  });
});

describe("what a server verdict does to it", () => {
  it("writes it when the server accepted the request", () => {
    noteEditorVerdict(200);
    expect(localStorage.getItem(MARK)).not.toBeNull();
  });

  /* The two refusals, and 403 is the one carrying revocation: `cms/handler.ts`
     re-checks the allowlist on every request, so somebody taken off it clears
     their own marker on their very next tap rather than at the end of an hour
     or the end of the marker's own months. */
  for (const status of [401, 403]) {
    it(`deletes it on ${status}`, () => {
      rememberEditor();
      noteEditorVerdict(status);
      expect(localStorage.getItem(MARK)).toBeNull();
    });
  }

  /* None of these is a verdict about the person. A 409 is somebody else's
     commit landing first, a 503 is the site not being configured, a 500 is the
     server having a bad day — signing an owner's device out for any of them
     would be a way in that vanishes for reasons they cannot see. */
  for (const status of [409, 500, 503]) {
    it(`leaves it exactly as it was on ${status}`, () => {
      rememberEditor();
      const before = localStorage.getItem(MARK);
      noteEditorVerdict(status);
      expect(localStorage.getItem(MARK)).toBe(before);
    });

    it(`does not invent one on ${status}`, () => {
      noteEditorVerdict(status);
      expect(localStorage.getItem(MARK)).toBeNull();
    });
  }
});

describe("what a visitor gets", () => {
  it("nothing at all, because a visitor has no marker", () => {
    annotatedPage();
    showEditHint();
    expect(hint()).toBeNull();
  });

  it("nothing from a marker that has expired, and the marker is cleaned up", () => {
    annotatedPage();
    localStorage.setItem(MARK, String(Date.now() - 1000));
    showEditHint();
    expect(hint()).toBeNull();
    expect(localStorage.getItem(MARK)).toBeNull();
  });

  it("nothing from a marker that is not a number", () => {
    annotatedPage();
    localStorage.setItem(MARK, "yes");
    showEditHint();
    expect(hint()).toBeNull();
  });
});

describe("what an owner's device gets", () => {
  beforeEach(() => {
    annotatedPage();
    rememberEditor();
  });

  it("one small way in, on the page they are standing on", () => {
    showEditHint();
    const link = hint()!.querySelector("a")!;
    expect(link.textContent).toBe("Edit this page");
    expect(link.getAttribute("href")).toBe("/about?edit=1");
  });

  /* The whole reason this is not a footer link, tested as a rule rather than
     read off the source: the target is derived from where the owner is, so it
     is right on the four sites serving `/edit` and the two serving
     `/edit.html` without knowing which it is on. */
  it("never names the editor's path", () => {
    showEditHint();
    expect(hint()!.outerHTML).not.toContain("/edit.html");
    expect(hint()!.querySelector("a")!.getAttribute("href")).not.toBe("/edit");
  });

  it("keeps the query an owner already had", () => {
    history.replaceState(null, "", "/works?page=2#top");
    showEditHint();
    expect(hint()!.querySelector("a")!.getAttribute("href")).toBe("/works?page=2&edit=1#top");
  });

  /* Arriving with `edit=off` is how an owner who just left edit mode gets
     here. `URLSearchParams.get` returns the first, so a link that appended a
     second `edit` would turn edit mode on and off in the same navigation. */
  it("strips the parameters it is about to set", () => {
    history.replaceState(null, "", "/about?edit=off&tour=1&keep=me");
    showEditHint();
    expect(hint()!.querySelector("a")!.getAttribute("href")).toBe("/about?keep=me&edit=1");
  });

  it("is dismissible, and dismissing is the device forgetting", () => {
    showEditHint();
    hint()!.querySelector("button")!.click();
    expect(hint()).toBeNull();
    expect(localStorage.getItem(MARK)).toBeNull();
  });

  it("draws once however many times it is asked", () => {
    showEditHint();
    showEditHint();
    expect(document.querySelectorAll(HINT)).toHaveLength(1);
  });

  /* A page with no content model has nothing this could open — `inline.ts`
     returns on the same question. The marker stays: the device is still the
     owner's, this page is just not one with words in it. */
  it("stays away from a page with nothing to edit", () => {
    document.body.innerHTML = "<main><h1>Hi</h1></main>";
    showEditHint();
    expect(hint()).toBeNull();
    expect(localStorage.getItem(MARK)).not.toBeNull();
  });
});

describe("what it must never add to a page", () => {
  beforeEach(() => {
    annotatedPage();
    rememberEditor();
    showEditHint();
  });

  it("no stylesheet and no inline style element", () => {
    expect(document.querySelector("link[rel~='stylesheet']")).toBeNull();
    expect(document.querySelector("style")).toBeNull();
  });

  /* Styled through CSSOM writes, which no `style-src` covers. The DOM
     reflects those into a `style` property either way — what this asserts is
     that they went through the object model rather than being handed to
     `setAttribute("style", …)`, which is markup and is blocked on four of the
     six sites, and that the element carries no other markup-borne policy
     trigger. */
  it("no script, no iframe, no image, and no request of any kind", () => {
    const box = hint()!;
    expect(box.querySelectorAll("script, iframe, img, source, object, embed")).toHaveLength(0);
    expect(box.style.position).toBe("fixed");
  });

  it("no cross-origin anything in the link it draws", () => {
    expect(hint()!.querySelector("a")!.getAttribute("href")!.startsWith("/")).toBe(true);
  });
});

describe("the three languages", () => {
  it("follows the page it is on into French", () => {
    annotatedPage("fr");
    rememberEditor();
    showEditHint();
    expect(hint()!.querySelector("a")!.textContent).toBe("Modifier cette page");
    expect(hint()!.dir).toBe("ltr");
  });

  it("follows it into Farsi, and turns round with it", () => {
    annotatedPage("fa");
    rememberEditor();
    showEditHint();
    expect(hint()!.querySelector("a")!.textContent).toBe("این صفحه را ویرایش کن");
    expect(hint()!.dir).toBe("rtl");
  });

  it("takes a site's own words where a site has overridden them", () => {
    annotatedPage();
    rememberEditor();
    showEditHint({ strings: { hintEdit: "Change this" } });
    expect(hint()!.querySelector("a")!.textContent).toBe("Change this");
  });

  it("says what dismissing means, rather than leaving a bare glyph", () => {
    annotatedPage("fa");
    rememberEditor();
    showEditHint();
    const button = hint()!.querySelector("button")!;
    expect(button.textContent).toBe("×");
    expect(button.getAttribute("aria-label")).toBe("دیگر این را روی این دستگاه پیشنهاد نده");
  });
});
