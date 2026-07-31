// @vitest-environment happy-dom
/* The two client entry points, driven.
   ---------------------------------------------------------------------------
   §2.6's F13: nothing in 33 test files mentioned `mountEditor` or
   `startInlineEditor`. Everything about the editor that could be tested without
   a DOM already was — the tour's rules, the strings, `return-to`'s hrefs, the
   whole server half — and the surfaces an owner actually touches were verified
   only by a browser pass, which is real evidence and does not run on push.

   So this file is deliberately not a second browser pass. What it asserts is the
   set of claims that would fail *silently*: a route that exists in the design and
   not in the DOM, a control offered in a state it should not be, a sentence said
   to the wrong failure, a flag written at the wrong moment. Geometry, styling and
   anything about what a thing looks like stay where they belong, in
   `.conductor/evidence/E1/`, at a real width in real Chrome.

   Both entry points are driven against a stubbed `fetch` and the real content
   model — the descriptors `formModel()` produces, spelled by hand here so a
   failure names the editor rather than the schema compiler. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Field } from "../src/cms/fields.js";
import { mountEditor } from "../src/editor/index.js";
import { startInlineEditor } from "../src/editor/inline.js";
import { editorStrings } from "../src/editor/strings.js";
import { TOUR_SEEN } from "../src/editor/tour.js";

const EN = editorStrings("en");
const FA = editorStrings("fa");

/** A model shaped like a real site's: a hero whose tagline is required and whose
    note is not, and a section that can be turned off. */
const MODEL: Field[] = [
  {
    kind: "group",
    path: "hero",
    label: "Hero",
    required: true,
    fields: [
      { kind: "text", path: "hero.tagline", label: "Tagline", required: true, long: false },
      { kind: "text", path: "hero.note", label: "Note", required: false, long: false }
    ]
  },
  {
    kind: "group",
    path: "partners",
    label: "Partners",
    required: true,
    toggle: { kind: "boolean", path: "partners.visible", label: "Visible", required: false },
    fields: [{ kind: "text", path: "partners.heading", label: "Heading", required: true, long: false }]
  }
];

const VALUES = (): Record<string, unknown> => ({
  hero: { tagline: "Bruce Sherfield", note: "" },
  partners: { visible: true, heading: "Who I play with" }
});

/** What the content edge answers, per request, so a test can say "this save is
    a 403" without knowing the shape of any other route. */
interface Routes {
  /** GET, the session or the entry. */
  get?(url: string): Response;
  /** POST — the save. Throwing here is a dropped connection. */
  post?(body: unknown): Response;
}

function stubFetch(routes: Routes): ReturnType<typeof vi.fn> {
  const calls = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (init?.method === "POST") {
      if (!routes.post) throw new Error("no POST route in this test");
      return routes.post(JSON.parse(String(init.body)));
    }
    if (href.startsWith("/api/auth")) return json({ configured: false });
    if (routes.get) return routes.get(href);
    return json({ who: "owner@example.com", collections: [] });
  });
  vi.stubGlobal("fetch", calls);
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

/** The page an owner is standing on when the bar appears: a site's own markup
    with the annotations a site adds, and nothing else. */
function page(lang = "en"): HTMLElement {
  document.documentElement.lang = lang;
  document.body.innerHTML = `
    <div data-sk-collection="pages" data-sk-entry="home" data-sk-editor-path="/edit">
      <h1 data-sk-edit="hero.tagline">Bruce Sherfield</h1>
      <p data-sk-edit="partners.heading">Who I play with</p>
    </div>`;
  return document.querySelector<HTMLElement>("h1")!;
}

/** The bar's shadow root, which is where every control on this surface lives. */
function bar(): ShadowRoot {
  const host = document.querySelector("sk-inline-editor");
  if (!host?.shadowRoot) throw new Error("the bar did not mount");
  return host.shadowRoot;
}

function labels(root: ParentNode, selector: string): string[] {
  return [...root.querySelectorAll(selector)].map((node) => (node.textContent ?? "").trim());
}

/** Type into an annotated element the way a browser does: the text changes, then
    `input` fires. */
function type(element: HTMLElement, text: string): void {
  element.textContent = text;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find(
    (button) => (button.textContent ?? "").trim() === label
  );
  if (!found) throw new Error(`no button labelled "${label}" — found ${labels(root, "button").join(" | ")}`);
  found.click();
  return found;
}

/** The panel, mounted and settled. `?home` and the entry both land after an
    await, and the panel deliberately does not wait for the first of them. */
async function panel(options: Parameters<typeof mountEditor>[1] = {}): Promise<HTMLElement> {
  const root = document.createElement("main");
  document.body.append(root);
  await mountEditor(root, { lang: "en", ...options });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return root;
}

const SESSION = json({
  who: "owner@example.com",
  collections: [
    { name: "pages", label: "Pages", entries: [{ id: "home", label: "Home", url: "/" }] }
  ]
});

function entry(values: unknown = VALUES()): Response {
  return json({ path: "src/content/pages/home.yml", sha: "sha-1", fields: MODEL, values });
}

/** The panel's own routes: the session, then the entry. */
function panelRoutes(post?: Routes["post"], values?: unknown): Routes {
  return {
    get: (url) => (url.includes("collection=") ? entry(values) : SESSION.clone()),
    ...(post ? { post } : {})
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  /* Every inline test would otherwise meet the first-run tour, which is correct
     behaviour and not what most of them are about. The tests that *are* about it
     clear this themselves. */
  localStorage.setItem(TOUR_SEEN, "1");
  vi.stubGlobal("prompt", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* --- F13, claim 1: there is a way out of the bar ------------------------- */

describe("the route between the two surfaces", () => {
  it("gives the bar at least one link to the panel, carrying this page", async () => {
    page();
    stubFetch({ get: () => entry() });
    await startInlineEditor();

    /* §1.6 counted the links in this shadow root on three live sites and got
       zero on all three, while the help text named the place twice. */
    const links = [...bar().querySelectorAll("a")];
    expect(links.length).toBeGreaterThanOrEqual(1);

    const href = links[0]?.getAttribute("href") ?? "";
    expect(href.startsWith("/edit")).toBe(true);
    /* `back`, never `from`: the panel acts on `from` by sending the owner
       straight back, which would make Home a link to itself. */
    expect(href).toContain("back=%2F");
    expect(href).not.toContain("from=");
    expect(links[0]?.textContent).toBe(EN.inlineHome);
  });

  it("offers the panel's own route back to the page it came from", async () => {
    history.replaceState(null, "", "/edit?back=%2F");
    stubFetch(panelRoutes());
    const root = await panel();

    const footer = [...root.querySelectorAll(".sk-editor__footer a")];
    expect(footer.map((a) => a.textContent)).toEqual([EN.backToPage]);
    expect(footer[0]?.getAttribute("href")).toBe("/?edit=1");
  });

  it("says 'edit this page' instead when the owner did not come from one", async () => {
    stubFetch(panelRoutes());
    const root = await panel();
    expect(labels(root, ".sk-editor__footer a")).toEqual([EN.openPage]);
  });
});

/* --- F13, claim 2: the bar's control set per state ----------------------- */

describe("the bar's shape", () => {
  it("offers no Save at rest, and Save with a count once something changed", async () => {
    const target = page();
    stubFetch({ get: () => entry() });
    await startInlineEditor();

    /* §2.2's table, read off the row itself. `.bar__actions` is the control set;
       everything else in this shadow root is the status line, the sheet, the note
       and the help, and the sheet is deliberately full of things the row is not.

       At rest: no Save at all. A disabled one took a whole row of a 143px bar to
       offer a control that does nothing. */
    expect(labels(bar(), ".bar__actions button")).toEqual([EN.inlineHelp, EN.inlineDone]);
    expect(labels(bar(), ".bar__actions a")).toEqual([EN.inlineHome]);
    expect(bar().querySelector(".btn--primary")).toBeNull();

    type(target, "Bruce Sherfield, bassist");

    /* Editing: undo this one, Save with its count, and the way to everything
       else. Home has moved off the row and into the sheet — §2.3's compromise,
       one tap from either state — so the row gets *smaller* the moment there is
       work on it to protect. */
    expect(labels(bar(), ".bar__actions button")).toEqual([
      EN.inlineRevert,
      `${EN.save}1`,
      EN.inlineMore
    ]);
    expect(labels(bar(), ".bar__actions a")).toEqual([]);
    expect(labels(bar(), ".bar__sheet a")).toEqual([EN.inlineHome]);
  });

  it("keeps Save out of reach while a required field is empty", async () => {
    const target = page();
    stubFetch({ get: () => entry() });
    await startInlineEditor();

    type(target, "");

    const save = bar().querySelector<HTMLButtonElement>(".btn--primary");
    expect(save).not.toBeNull();
    expect(save?.disabled).toBe(true);
    /* And it says which field and why, ahead of "Changing Tagline" — the owner
       is standing in the field they just cleared. */
    expect(bar().querySelector(".bar__status")?.textContent).toBe(
      EN.fieldNeeded.replace("{what}", "Tagline")
    );

    type(target, "Something");
    expect(bar().querySelector<HTMLButtonElement>(".btn--primary")?.disabled).toBe(false);
  });
});

/* --- F13, claim 3: both surfaces speak the owner's language -------------- */

describe("the string tables reach both entry points", () => {
  it("gives the bar Farsi words and a right-to-left direction", async () => {
    page("fa");
    stubFetch({ get: () => entry() });
    await startInlineEditor();

    expect(bar().querySelector(".bar__status")?.textContent).toBe(FA.inlineIdle);
    expect(bar().querySelector<HTMLElement>(".bar")?.getAttribute("dir")).toBe("rtl");
    expect(labels(bar(), ".bar__actions button")).toEqual([FA.inlineHelp, FA.inlineDone]);
    expect(labels(bar(), ".bar__sheet button")).toContain(FA.inlineDiscard);
  });

  it("counts changes in Persian digits on the bar", async () => {
    const target = page("fa");
    stubFetch({ get: () => entry() });
    await startInlineEditor();

    type(target, "چیز دیگری");
    expect(bar().querySelector(".bar__count")?.textContent).toBe("۱");
  });

  it("gives the panel Farsi words and turns the document around", async () => {
    stubFetch(panelRoutes());
    const root = await panel({ lang: "fa" });

    expect(document.documentElement.lang).toBe("fa");
    expect(document.documentElement.dir).toBe("rtl");
    /* `accountOpen` rather than `signOut`, since 0.23.0: signing out moved
       into the settings sheet, and the sheet's rows are not built until it is
       opened. The claim this line is making is "the panel's chrome is in
       Farsi", so it has to name a word the chrome actually shows. */
    expect(root.textContent).toContain(FA.accountOpen);
    expect(root.querySelector(".sk-editor__save")?.textContent).toBe(FA.save);
  });

  it("puts signing out inside the settings sheet, in Farsi too", async () => {
    stubFetch(panelRoutes());
    const root = await panel({ lang: "fa" });

    /* The sheet is in the document from the start but empty until opened —
       painting it eagerly would mean a passkey round trip on every load of
       every editor, for a screen most readers never open. */
    const sheet = root.querySelector<HTMLElement>(".sk-editor__sheet");
    expect(sheet?.hidden).toBe(true);
    expect(sheet?.textContent).not.toContain(FA.signOut);

    root.querySelector<HTMLButtonElement>(".sk-editor__account")?.click();
    /* `paint()` is async — it asks the ladder before drawing — so the rows
       arrive a microtask later. */
    await vi.waitFor(() => expect(sheet?.textContent).toContain(FA.signOut));
    expect(sheet?.hidden).toBe(false);
  });
});

/* --- F13, claim 4: dismissed stays dismissed ---------------------------- */

describe("the first run", () => {
  beforeEach(() => {
    localStorage.removeItem(TOUR_SEEN);
  });

  it("shows step one on a browser that has never been here", async () => {
    page();
    stubFetch({ get: () => entry() });
    await startInlineEditor();
    expect(bar().querySelector(".bar__tour")?.textContent).toContain(EN.tourStep1);
  });

  it("stays dismissed once it has been", async () => {
    page();
    stubFetch({ get: () => entry() });
    await startInlineEditor();
    press(bar(), EN.tourSkip);

    expect(localStorage.getItem(TOUR_SEEN)).toBe("1");
    expect(bar().querySelector<HTMLElement>(".bar__tour")?.hidden).toBe(true);

    /* A reload, as far as this layer can tell one: the page is rebuilt and the
       editor started again on the same browser. */
    page();
    await startInlineEditor();
    expect(bar().querySelector<HTMLElement>(".bar__tour")?.hidden).toBe(true);
  });

  it("comes back when the owner asks, and asking does not un-dismiss it", async () => {
    page();
    stubFetch({ get: () => entry() });
    await startInlineEditor();
    press(bar(), EN.tourSkip);

    press(bar(), EN.inlineHelp);
    press(bar(), EN.inlineHelpTourAgain);

    expect(bar().querySelector(".bar__tour")?.textContent).toContain(EN.tourStep1);
    /* Reading something a second time does not make you a first-time user. */
    expect(localStorage.getItem(TOUR_SEEN)).toBe("1");
  });

  it("advances on the owner doing the thing rather than on a button", async () => {
    const target = page();
    stubFetch({ get: () => entry() });
    await startInlineEditor();

    target.focus();
    target.dispatchEvent(new Event("focus", { bubbles: true }));
    expect(bar().querySelector(".bar__tour")?.textContent).toContain(EN.tourStep2);

    type(target, "Bruce Sherfield, bassist");
    expect(bar().querySelector(".bar__tour")?.textContent).toContain(EN.tourStep3);
    /* Step three rings the route to Home, and while the bar is dirty that route
       is the sheet's own button rather than the link inside it. */
    expect(bar().querySelector("[data-sk-tour]")?.textContent).toBe(EN.inlineMore);
  });
});

/* --- F13, claim 5: a collapsed section opens for a held field ------------ */

describe("the collapse and a Save that will not go", () => {
  it("opens the section holding a required field the owner emptied", async () => {
    stubFetch(panelRoutes());
    const root = await panel();

    const sections = [...root.querySelectorAll("details")];
    expect(sections.length).toBe(2);
    expect(sections.map((box) => box.open)).toEqual([false, false]);

    const heading = root.querySelector<HTMLTextAreaElement>('[data-path="partners.heading"]')!;
    heading.value = "";
    heading.dispatchEvent(new Event("input", { bubbles: true }));

    const save = root.querySelector<HTMLButtonElement>(".sk-editor__save")!;
    expect(save.disabled).toBe(true);
    expect(root.querySelector(".sk-editor__note")?.textContent).toBe(
      EN.fieldNeeded.replace("{what}", "Heading")
    );
    expect(heading.classList.contains("is-wanted")).toBe(true);
    /* §2.4's first rule: a Save that will not go, for a reason shut inside a
       box, is the one way the collapse could be worse than the form it
       replaced. */
    expect(sections[1]?.open).toBe(true);

    heading.value = "Who I play with, now";
    heading.dispatchEvent(new Event("input", { bubbles: true }));
    expect(save.disabled).toBe(false);
    expect(root.querySelector(".sk-editor__note")?.textContent).toContain("src/content/pages/home.yml");
    expect(root.querySelector(".is-wanted")).toBeNull();
  });

  it("does not hold Save over a field that was already empty when it opened", async () => {
    stubFetch(panelRoutes());
    const root = await panel();

    /* `hero.note` is blank in the file and not required; `hero.tagline` is
       required and full. Nothing here is the owner's doing, so editing something
       else must be savable — a pre-existing blank is the site builder's
       oversight and locking an owner out of their own typo fix over it would be
       a worse bug than the one F8 closes. */
    const note = root.querySelector<HTMLTextAreaElement>('[data-path="hero.note"]')!;
    note.value = "A note";
    note.dispatchEvent(new Event("input", { bubbles: true }));

    expect(root.querySelector<HTMLButtonElement>(".sk-editor__save")?.disabled).toBe(false);
  });

  it("never blocks an owner over a required field that was already empty in the file", async () => {
    stubFetch(
      panelRoutes(undefined, {
        hero: { tagline: "", note: "" },
        partners: { visible: true, heading: "Who I play with" }
      })
    );
    const root = await panel();

    const tagline = root.querySelector<HTMLTextAreaElement>('[data-path="hero.tagline"]')!;
    const note = root.querySelector<HTMLTextAreaElement>('[data-path="hero.note"]')!;
    const save = root.querySelector<HTMLButtonElement>(".sk-editor__save")!;
    /* Required and blank before anybody arrived. Save is off because there is
       nothing to save, and nothing is being held. */
    expect(save.disabled).toBe(true);
    expect(root.querySelector(".is-wanted")).toBeNull();

    /* The scenario this decision exists for: an owner comes to fix one word
       somewhere else. Guarding on emptiness alone would refuse them until they
       invented content for a field they have never seen. */
    note.value = "A note";
    note.dispatchEvent(new Event("input", { bubbles: true }));
    expect(save.disabled).toBe(false);

    /* And typing into the blank field and clearing it again puts it back to what
       the file says, which is not a change and so not something to hold: the
       other edit still stands and is still savable. */
    tagline.value = "Something";
    tagline.dispatchEvent(new Event("input", { bubbles: true }));
    tagline.value = "";
    tagline.dispatchEvent(new Event("input", { bubbles: true }));
    expect(save.disabled).toBe(false);
    expect(save.textContent).toBe(EN.saveCount.replace("{count}", "1 change"));
    expect(root.querySelector(".sk-editor__note")?.textContent).not.toContain("can't be left empty");
  });
});

/* --- F6, F7 and bug #14: what each failure says -------------------------- */

describe("a save the site would not take", () => {
  it("tells the bar's owner a refusal will not heal, and keeps the server's words for the console", async () => {
    const target = page();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch({
      get: () => entry(),
      post: () => json({ ok: false, error: "That account can't edit this site." }, 403)
    });
    await startInlineEditor();
    type(target, "Bruce Sherfield, bassist");
    press(bar(), `${EN.save}1`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const note = bar().querySelector(".bar__note")?.textContent ?? "";
    expect(note).toContain(EN.saveRefused);
    /* Not the server's English, which is terse, untranslated and about a wrong
       origin rather than about what to do. */
    expect(note).not.toContain("That account");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("403"), "That account can't edit this site.");
  });

  it("tells the panel's owner the same thing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(panelRoutes(() => json({ ok: false, error: "Bad origin." }, 403)));
    const root = await panel();

    const tagline = root.querySelector<HTMLTextAreaElement>('[data-path="hero.tagline"]')!;
    tagline.value = "Bruce Sherfield, bassist";
    tagline.dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".sk-editor__save")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector(".sk-editor__note")?.textContent).toBe(EN.saveRefused);
    /* And Save is pressable again, because a note nobody can act on plus a
       button nobody can press is the worst state this panel can reach. */
    expect(root.querySelector<HTMLButtonElement>(".sk-editor__save")?.disabled).toBe(false);
  });

  it("still says 'couldn't save' to the site's own trouble, which a second press might fix", async () => {
    const target = page();
    stubFetch({
      get: () => entry(),
      post: () => json({ ok: false, error: "The editor can't reach the repository." }, 502)
    });
    await startInlineEditor();
    type(target, "Bruce Sherfield, bassist");
    press(bar(), `${EN.save}1`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bar().querySelector(".bar__note")?.textContent).toContain(
      "The editor can't reach the repository."
    );
    expect(bar().querySelector(".bar__note")?.textContent).not.toContain(EN.saveRefused);
  });

  it("tells the bar's owner their words are safe when the save never left the browser", async () => {
    const target = page();
    stubFetch({
      get: () => entry(),
      post: () => {
        throw new TypeError("Failed to fetch");
      }
    });
    await startInlineEditor();
    type(target, "Bruce Sherfield, bassist");
    press(bar(), `${EN.save}1`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    /* Bug #14: 0.16.1 gave the panel this sentence and left the bar saying
       "Couldn't save that change." to a request the server never saw. */
    expect(bar().querySelector(".bar__note")?.textContent).toContain(EN.saveUnreachable);
    expect(bar().querySelector(".bar__note")?.textContent).not.toContain(EN.saveFailed);
    /* And the draft is on disk, which is what makes that sentence true here. */
    expect(sessionStorage.length).toBeGreaterThan(0);
  });
});

describe("a conflict", () => {
  const conflicted = () =>
    json({ ok: false, error: "Someone else edited this since you opened it — reload and try again." }, 409);

  it("offers to keep the owner's words before offering to drop them, on the bar", async () => {
    const target = page();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText }, languages: ["en"] });
    stubFetch({ get: () => entry(), post: conflicted });
    await startInlineEditor();
    type(target, "Bruce Sherfield, bassist");
    press(bar(), `${EN.save}1`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const note = bar().querySelector(".bar__note")!;
    expect(note.textContent).toContain(EN.conflict);
    /* The order is the whole fix: reloading is still the only safe ending, and
       it drops everything typed since the page opened. */
    expect(labels(note, "button")).toEqual([EN.copyMine, EN.reload]);

    const copy = press(note, EN.copyMine);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledOnce();
    const copied = String(writeText.mock.calls[0]?.[0]);
    /* Under the field's own human label, because a path means nothing to the
       person pasting it back later. */
    expect(copied).toContain("Tagline:");
    expect(copied).toContain("Bruce Sherfield, bassist");
    expect(copy.textContent).toBe(EN.copiedMine);
  });

  it("offers the same two things in the same order on the panel", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText }, languages: ["en"] });
    stubFetch(panelRoutes(conflicted));
    const root = await panel();

    const tagline = root.querySelector<HTMLTextAreaElement>('[data-path="hero.tagline"]')!;
    tagline.value = "Bruce Sherfield, bassist";
    tagline.dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".sk-editor__save")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const note = root.querySelector(".sk-editor__note")!;
    expect(note.textContent).toContain(EN.conflict);
    expect(labels(note, "button")).toEqual([EN.copyMine, EN.reload]);

    press(note, EN.copyMine);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(String(writeText.mock.calls[0]?.[0])).toContain("Tagline:");
  });

  it("puts the words in front of the owner when the clipboard is refused", async () => {
    const target = page();
    const asked = vi.fn();
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        }
      },
      languages: ["en"]
    });
    vi.stubGlobal("prompt", asked);
    stubFetch({ get: () => entry(), post: conflicted });
    await startInlineEditor();
    type(target, "Bruce Sherfield, bassist");
    press(bar(), `${EN.save}1`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const copy = press(bar().querySelector(".bar__note")!, EN.copyMine);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toHaveBeenCalledWith(EN.copyMine, expect.stringContaining("Bruce Sherfield, bassist"));
    /* And the button does not claim something that did not happen. */
    expect(copy.textContent).toBe(EN.copyMine);
  });
});
