// @vitest-environment happy-dom
/* The companion, driven — and what is asserted here is the four promises the
   module's header makes rather than how it looks, because how it looks is
   proved by a committed contact sheet in the site that draws it.
   ---------------------------------------------------------------------------
   1. **He is entirely inside a shadow root.** The host page's CSS cannot reach
      him and his cannot reach out, which is the whole of "not breaking other
      site functionality" on somebody else's site.
   2. **He is styled through the CSSOM and never by a `<style>` element.** The
      fleet's CSP is `style-src 'self'` with no `'unsafe-inline'` — measured on
      a deployed client page, where the policy arrives as a `<meta http-equiv>`
      rather than as a header — so a runtime `<style>` is blocked and the
      failure is a character with no styling rather than an error anyone
      notices. This is the assertion that catches somebody "simplifying"
      `adoptedStyleSheets` back into an append.
   3. **Nothing in the sheet names a colour.** Every ink is `currentColor` or a
      custom property falling back to one, so he is correct on a dark site and a
      light one without the kit ever learning a palette. No hex, by
      construction.
   4. **The character is genuinely a parameter.** A second rig is mounted and
      the shadow root draws *its* marks — which is the difference between
      reusability and a hope. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountCompanion, companionAt, skFigure, PACE, ANCHOR_PACE } from "../src/motion/companion.js";
import type { CompanionRig } from "../src/motion/companion.js";
import { stance, emit, flip, PARTS, GROUND, VBH } from "../src/motion/figure.js";

let idleCallbacks: (() => void)[] = [];
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  idleCallbacks = [];
  frames = [];
  clock = 0;
  document.body.innerHTML = "";

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: () => {} }))
  );
  class FakeObserver {
    constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() {
      this.cb([{ isIntersecting: true }]);
    }
    disconnect() {}
  }
  Object.assign(window, {
    matchMedia: globalThis.matchMedia,
    requestIdleCallback: (fn: () => void) => {
      idleCallbacks.push(fn);
      return 1;
    },
    IntersectionObserver: FakeObserver,
    /* Captured rather than scheduled: a loop that runs itself in a test is a
       test that never ends, and every behavioural assertion below wants to say
       exactly which frame it is looking at. */
    requestAnimationFrame: (fn: FrameRequestCallback) => frames.push(fn),
    cancelAnimationFrame: () => {}
  });
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("requestAnimationFrame", window.requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", window.cancelAnimationFrame);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = async () => {
  idleCallbacks.splice(0).forEach((fn) => fn());
  await new Promise((r) => setTimeout(r, 0));
};

/** A host and a page to stand on. `getBoundingClientRect` is stubbed because
    happy-dom lays nothing out and the footing rule is a question about where an
    edge is: everything the loop decides follows from that one number. */
function page(stageTop = 300) {
  const stage = document.createElement("section");
  stage.setAttribute("data-mate-stage", "work");
  stage.id = "work";
  stage.getBoundingClientRect = () => ({ top: stageTop }) as DOMRect;
  document.body.appendChild(stage);

  const host = document.createElement("div");
  host.setAttribute("data-mate", "");
  document.body.appendChild(host);
  return { host, stage };
}

/** Drive the captured loop. One frame per call at `step` ms of clock. */
let clock = 0;
function run(ms: number, step = 64) {
  const until = clock + ms;
  while (clock < until) {
    clock += step;
    const fn = frames.shift();
    if (!fn) return clock;
    fn(clock);
  }
  return clock;
}

/** Drive until something is true, or give up. Time is what every one of these
    behaviours is a function of, so a test that asserts at a fixed number of
    milliseconds is a test that breaks when a cadence number moves for a good
    reason. */
function runUntil(want: () => boolean, ms = 30000, step = 64) {
  const until = clock + ms;
  while (clock < until) {
    clock += step;
    const fn = frames.shift();
    if (!fn) break;
    fn(clock);
    if (want()) return true;
  }
  return want();
}

describe("mountCompanion — the shadow root", () => {
  it("builds every part of itself inside an open shadow root", async () => {
    const { host } = page();
    mountCompanion(host, { placement: { mode: "roam", stages: "[data-mate-stage]" } });
    await flush();

    const root = host.shadowRoot;
    expect(root).toBeTruthy();
    /* The site supplies an empty element. Nothing the module draws is in the
       light DOM, which is what makes the isolation real rather than nominal. */
    expect(host.children.length).toBe(0);
    expect(root!.querySelector("svg")).toBeTruthy();
    expect(root!.querySelectorAll("svg > path").length).toBe(PARTS.length);
    expect(root!.querySelector("a.text")).toBeTruthy();
  });

  it("styles itself with adoptedStyleSheets and never a <style> element", async () => {
    const { host } = page();
    mountCompanion(host, { placement: { mode: "roam", stages: "[data-mate-stage]" } });
    await flush();

    const root = host.shadowRoot!;
    expect(root.adoptedStyleSheets.length).toBe(1);
    /* The one that catches the regression: a `<style>` here is blocked by
       `style-src 'self'` on every deployed fleet site. */
    expect(root.querySelectorAll("style").length).toBe(0);
    expect(root.innerHTML).not.toContain("<style");
  });

  it("never creates a style element at all, which is the mechanism and not the symptom", async () => {
    const { host } = page();
    const made = vi.spyOn(document, "createElement");
    mountCompanion(host, { placement: { mode: "roam", stages: "[data-mate-stage]" } });
    await flush();
    /* The assertion above proves none survived; this proves none was attempted.
       They are different failures: a `<style>` appended and then removed still
       gets a console violation on a client's page, and a future refactor that
       builds a sheet by string concatenation into an element would pass the
       first check on the frame after it. */
    expect(made.mock.calls.map(([tag]) => tag)).not.toContain("style");
    expect(host.shadowRoot!.adoptedStyleSheets.length).toBe(1);
  });

  it("names no colour anywhere in the sheet it adopts", async () => {
    const { host } = page();
    mountCompanion(host, { placement: { mode: "roam", stages: "[data-mate-stage]" } });
    await flush();

    const css = [...host.shadowRoot!.adoptedStyleSheets[0]!.cssRules]
      .map((r) => r.cssText)
      .join("\n");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    /* And no site's token names either — the whole reason the default is
       inheritance is that a client site has no `--ink` to read. */
    expect(css).not.toMatch(/var\(\s*--(ink|paper|wash|thin)\b/);
    expect(css).toContain("currentColor");
  });

  it("keeps the drawing out of the accessibility tree and out of the way of clicks", async () => {
    const { host } = page();
    mountCompanion(host, { placement: { mode: "roam", stages: "[data-mate-stage]" } });
    await flush();

    const root = host.shadowRoot!;
    expect(root.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelector("svg")!.getAttribute("focusable")).toBe("false");
    /* The sentence starts hidden too. Only the offer ever lifts it, and only
       for the seconds it is up. */
    expect(root.querySelector(".say")!.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelector(".say")!.getAttribute("aria-live")).toBe("polite");
  });
});

describe("companionAt — a character with nothing to say", () => {
  /** **The state a site is in while its owner is deciding on the words.** He
      stands on the credit and says nothing, which has to be reachable without
      first shipping a sentence into somebody else's footer — and until 0.27.0
      it was not: `Credit.astro` read an empty `say` as "no companion" and
      skipped the mount, so the only way to look at the character was to publish
      copy nobody had approved. `companion` is presence, `say` is speech, and
      these are the two assertions that keep them separable. */
  it("draws every mark, and never speaks", async () => {
    const { host } = page();
    companionAt(host, { lines: [] });
    await flush();

    const root = host.shadowRoot!;
    /* In full. The drawing comes off `rig` and `lines` has no part in it, so a
       silent companion is not a smaller or a simpler one. */
    expect(root.querySelectorAll("svg > path").length).toBe(PARTS.length);

    /* And nothing ever arrives in the one element every line and the offer
       alike are written into — driven far past `ANCHOR_PACE`'s `askAfter: 0`,
       which is the setting that would have spoken at the first opportunity if
       an empty script still had one. */
    const text = root.querySelector("a.text")!;
    run(60_000);
    expect(text.textContent).toBe("");
    expect(text.getAttribute("href")).toBeNull();
    expect(root.querySelector(".say")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("mountCompanion — the character is a parameter", () => {
  /** Not the sk figure: three marks, its own classes, its own vocabulary and no
      flip at all — which is the case that proves `rig.flip` being optional is a
      character declining to show off rather than a crash. */
  const stick: CompanionRig = {
    viewBox: [0, 0, 10, 20],
    parts: ["s-body", "s-arm", "s-leg"],
    ground: 0.95,
    face: 0.2,
    stride: 9,
    css: ".s-body { stroke-width: 1; }",
    stance: () => stance("stand"),
    create: () => ({ rest() {}, draw() {} })
  };

  it("mounts a second rig and draws that one's marks, not the default's", async () => {
    const { host } = page();
    mountCompanion(host, {
      rig: stick,
      placement: { mode: "roam", stages: "[data-mate-stage]" }
    });
    await flush();

    const paths = [...host.shadowRoot!.querySelectorAll("svg > path")];
    expect(paths.length).toBe(3);
    expect(paths.map((p) => p.getAttribute("class"))).toEqual(["s-body", "s-arm", "s-leg"]);
    expect(host.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 10 20");
    /* Its costume is in the sheet and the sk figure's is not. */
    const css = [...host.shadowRoot!.adoptedStyleSheets[0]!.cssRules]
      .map((r) => r.cssText)
      .join("\n");
    expect(css).toContain("s-body");
    expect(css).not.toContain("f-hem");
  });

  it("writes the rig's own aspect, so the box is the drawing's shape", async () => {
    const { host } = page();
    mountCompanion(host, { rig: stick, placement: { mode: "roam", stages: "[data-mate-stage]" } });
    await flush();
    expect(host.style.getPropertyValue("--sk-mate-aspect")).toBe("0.5");
  });

  it("survives a rig with no flip — the move is optional and its absence is silent", async () => {
    const { host } = page();
    mountCompanion(host, { rig: stick, placement: { mode: "roam", stages: "[data-mate-stage]" } });
    await flush();
    vi.spyOn(Math, "random").mockReturnValue(0.01); //  every coin toss says yes
    expect(() => run(4000)).not.toThrow();
  });
});

describe("mountCompanion — the document stays in the site", () => {
  it("takes the stage selector as a parameter and knows no attribute name", async () => {
    const { host } = page();
    const other = document.createElement("section");
    other.setAttribute("data-chapter", "two");
    other.getBoundingClientRect = () => ({ top: 300 }) as DOMRect;
    document.body.appendChild(other);

    mountCompanion(host, { placement: { mode: "roam", stages: "[data-chapter]" } });
    await flush();
    /* It mounted against a selector this module has never seen. If the
       attribute's name were in the module, this would find nothing. */
    expect(host.shadowRoot).toBeTruthy();
  });

  it("declines to mount when the selector finds nothing", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountCompanion(host, { placement: { mode: "roam", stages: "[data-nowhere]" } });
    await flush();
    /* A page with no stages is a page he is absent from, which is an answer
       rather than a failure — and it is the same answer as deleting a section's
       attribute. */
    expect(host.shadowRoot?.querySelector("svg") ?? null).toBeNull();
  });

  it("says one of the lines it was handed, and none of somebody else's", async () => {
    const { host } = page();
    mountCompanion(host, {
      placement: { mode: "roam", stages: "[data-mate-stage]" },
      lines: [{ at: "work", text: "That one took a while." }]
    });
    await flush();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const say = host.shadowRoot!.querySelector(".say")!;
    expect(runUntil(() => say.classList.contains("is-up"))).toBe(true);
    expect(host.shadowRoot!.querySelector(".text")!.textContent).toBe("That one took a while.");
  });

  it("arms the offer as a real link and disarms it when it comes down", async () => {
    const { host } = page();
    mountCompanion(host, {
      placement: { mode: "roam", stages: "[data-mate-stage]" },
      /* `askAfter: 0` because this is testing the mechanism and not the
         lateness; the lateness is `PACE.askAfter` and asserted below. */
      pace: { askAfter: 0, askHold: 1000 },
      lines: [{ at: "work", text: "Want one?", ask: "#contact" }]
    });
    await flush();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const say = host.shadowRoot!.querySelector(".say")!;
    const text = host.shadowRoot!.querySelector("a.text")!;
    expect(runUntil(() => say.classList.contains("is-up"))).toBe(true);
    expect(text.getAttribute("href")).toBe("#contact");
    /* Announced, which every other line deliberately is not. */
    expect(say.hasAttribute("aria-hidden")).toBe(false);
    expect(say.classList.contains("is-ask")).toBe(true);

    /* And when the hold runs out the href goes on the same frame the class
       does, because an offer left armed is an invisible anchor lying across a
       section full of links. */
    run(20000);
    expect(text.getAttribute("href")).toBeNull();
    expect(say.classList.contains("is-up")).toBe(false);
    expect(say.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps quiet while the element it is a footnote to is on the screen", async () => {
    const { host } = page();
    const film = document.createElement("div");
    film.setAttribute("data-mate-film", "");
    document.body.appendChild(film);

    mountCompanion(host, {
      placement: { mode: "roam", stages: "[data-mate-stage]", quiet: "[data-mate-film]" },
      lines: [{ at: "work", text: "Not yet." }]
    });
    await flush();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    /* The stubbed observer reports intersecting and never stops, so the latch
       never opens: he lands, he stands, and he says nothing at all. */
    run(20000);
    expect(host.shadowRoot!.querySelector(".text")!.textContent).toBe("");
  });
});

describe("mountCompanion — placement", () => {
  it("anchor mode sizes against the thing it stands on and not the viewport", async () => {
    const { host } = page();
    mountCompanion(host, { placement: { mode: "anchor" } });
    await flush();
    const css = [...host.shadowRoot!.adoptedStyleSheets[0]!.cssRules]
      .map((r) => r.cssText)
      .join("\n");
    /* §9.3's constraint: this is somebody else's footer and he is a guest in
       it, so he is proportional to the credit line rather than to the screen it
       happens to be on. */
    expect(css).toContain("3.4em");
    expect(css).not.toContain("6.4vw");
  });

  it("roam mode sizes against the viewport", async () => {
    const { host } = page();
    mountCompanion(host, { placement: { mode: "roam", stages: "[data-mate-stage]" } });
    await flush();
    const css = [...host.shadowRoot!.adoptedStyleSheets[0]!.cssRules]
      .map((r) => r.cssText)
      .join("\n");
    expect(css).toContain("6.4vw");
  });

  it("anchored, he never lets go of his footing when the reader scrolls", async () => {
    const { host } = page();
    host.getBoundingClientRect = () => ({ top: 300, bottom: 340 }) as DOMRect;
    mountCompanion(host, { placement: { mode: "anchor" } });
    await flush();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(runUntil(() => Number(host.style.getPropertyValue("--sk-mate-on")) > 0.5)).toBe(true);

    /* A page-length scroll. A roaming companion would bolt; a signature in a
       footer stays where it was put. */
    Object.defineProperty(window, "scrollY", { value: 5000, configurable: true });
    run(4000);
    expect(Number(host.style.getPropertyValue("--sk-mate-on"))).toBeGreaterThan(0.5);
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  /** The offer's anchor, once he has said it. Reached through the shadow root
      because that is the only way in — which is the point of the shadow root. */
  const offer = (host: HTMLElement) => host.shadowRoot!.querySelector(".say")!;

  /** Land him, then let him speak. Anchored, `askAfter` is 0 and the offer is
      the only line he has, so the first thing he says is it. */
  async function saidIt(host: HTMLElement, ask: unknown) {
    host.getBoundingClientRect = () => ({ top: 300, bottom: 340 }) as DOMRect;
    mountCompanion(host, {
      placement: { mode: "anchor" },
      lines: [{ at: "", text: "He made this one. Want one?", ask } as never]
    });
    await flush();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(runUntil(() => offer(host).classList.contains("is-ask"))).toBe(true);
    return offer(host).querySelector("a")!;
  }

  it("the offer opens a new tab when the destination asks for one", async () => {
    /* §9.1, and it is the whole reason `ask` grew a long form. This sentence
       lands in somebody else's footer: a visitor who taps a credit has not
       decided to leave, and navigating them off the client's site to satisfy a
       curiosity is a cost the client pays for our benefit. */
    const { host } = page();
    const a = await saidIt(host, {
      href: "https://sk-works.vercel.app",
      target: "_blank",
      rel: "author noopener"
    });
    expect(a.getAttribute("href")).toBe("https://sk-works.vercel.app");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("author noopener");
    /* Deliberately absent: the referrer is how the far end of an acquisition
       link learns which site sent somebody. */
    expect(a.getAttribute("rel")).not.toContain("noreferrer");
  });

  it("and takes all three off with the sentence, not just the href", async () => {
    /* An offer left armed is an invisible anchor lying across a footer. The
       href was always removed; `target` and `rel` went on together with it and
       come off the same way. */
    const { host } = page();
    const a = await saidIt(host, {
      href: "https://sk-works.vercel.app",
      target: "_blank",
      rel: "author noopener"
    });
    expect(runUntil(() => !offer(host).classList.contains("is-ask"), 20000)).toBe(true);
    expect(a.hasAttribute("href")).toBe(false);
    expect(a.hasAttribute("target")).toBe(false);
    expect(a.hasAttribute("rel")).toBe(false);
  });

  it("a bare href is still a bare href", async () => {
    /* The string form is what `sk-studio`'s `#contact` passes and it must not
       have quietly grown a new tab: an offer that stays on the site it was made
       on is the common case and the one the site owner wrote. */
    const { host } = page();
    const a = await saidIt(host, "#contact");
    expect(a.getAttribute("href")).toBe("#contact");
    expect(a.hasAttribute("target")).toBe(false);
    expect(a.hasAttribute("rel")).toBe(false);
  });

  it("anchored, the cadence is a signature's and not a character's", () => {
    /* One line, on an interval far longer than a page's own, and no landing
       aside at all — a joke about knees in a client's footer is a joke in
       somebody else's voice. */
    expect(ANCHOR_PACE.sayCap).toBe(1);
    expect(ANCHOR_PACE.aside).toBe(0);
    expect(ANCHOR_PACE.sayGap).toBeGreaterThan(PACE.sayGap);
  });
});

/* --- where he stands, and where the sentence goes ------------------------- */

describe("the sentence is placed off his own box", () => {
  /** **A phone, and the width is the whole reason the numbers are these.**
      A footer companion on a desktop is forgiving: the sentence has room on
      both sides of him, the clamp never bites, and the offset from *wherever
      the module thinks he is* comes out the same whether it thinks right or
      wrong — so a desktop-width fixture passes on both arithmetics and proves
      nothing. It is at 320 that the two part company, because there the
      sentence is half the screen and the clamp is doing real work: solved for a
      speaker in the middle of the page it puts the words off the left edge and
      across the drawing, and solved for the speaker who is actually there it
      puts them beside him and on the screen.

      He is at 40–80, which is where a credit's yard sits in a footer whose
      content is inline-start aligned. */
  const PAGE = 320;
  const LEFT = 40;
  const W = 40;
  const SAY_W = 160;
  const SAY_H = 40;
  const CENTRE = LEFT + W / 2;

  afterEach(() => {
    /* The override is on `documentElement` and would otherwise be the page
       width every test after this one measures against. */
    Reflect.deleteProperty(document.documentElement, "clientWidth");
  });

  async function speaks(mode: "anchor" | "roam") {
    const { host } = page();
    host.getBoundingClientRect = () =>
      ({
        top: 300,
        bottom: 340,
        left: LEFT,
        right: LEFT + W,
        width: W,
        height: 40
      }) as DOMRect;
    Object.defineProperty(document.documentElement, "clientWidth", {
      value: PAGE,
      configurable: true
    });

    mountCompanion(host, {
      placement:
        mode === "anchor" ? { mode: "anchor" } : { mode: "roam", stages: "[data-mate-stage]" },
      lines: [{ at: mode === "anchor" ? "" : "work", text: "He made this one. Want one?" }]
    });
    await flush();

    /* happy-dom lays nothing out, so the sentence measures zero and `placeSay`
       returns before it decides anything — which is why this whole path was
       uncovered. Given a box it behaves exactly as it does in a browser. */
    const say = host.shadowRoot!.querySelector<HTMLElement>(".say")!;
    Object.defineProperty(say, "offsetWidth", { value: SAY_W, configurable: true });
    Object.defineProperty(say, "offsetHeight", { value: SAY_H, configurable: true });

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(runUntil(() => say.classList.contains("is-up"))).toBe(true);
    return say;
  }

  it("anchored, it clears him instead of landing across him", async () => {
    /* **The regression this release exists for, stated as geometry.**
       `placeSay` used to take his position as `x` × the viewport. Roaming that
       is true, because a roaming host is stretched across the page; anchored it
       is not related to anything — his containing block is a yard a few em wide
       in a footer, so a fraction of it read as a fraction of the screen put the
       supposed speaker hundreds of pixels from the real one and solved every
       clamp for him. At these numbers the old arithmetic put the sentence's
       start at 728 with the character occupying 700 to 740: the sentence sat
       across the drawing, which is what a reader saw.

       Asserted as the module's own promise — the sentence clears his box on one
       side or the other — rather than as the nudge, because the nudge is an
       offset from a centre and it was the centre that was wrong. */
    const say = await speaks("anchor");
    const nudge = parseFloat(say.style.getPropertyValue("--say-nudge"));
    expect(Number.isFinite(nudge)).toBe(true);

    /* The sheet centres the sentence on him at a nudge of nought, so its start
       edge is his centre, less half a sentence, plus the nudge. */
    const start = CENTRE - SAY_W / 2 + nudge;
    const clearsEnd = start >= LEFT + W;
    const clearsStart = start + SAY_W <= LEFT;
    expect(clearsEnd || clearsStart).toBe(true);
  });

  it("and stays on the screen while it does it", async () => {
    /* The clamp is the half that was already right, and it must survive being
       given a speaker who is really near an edge. */
    const say = await speaks("anchor");
    const nudge = parseFloat(say.style.getPropertyValue("--say-nudge"));
    const start = CENTRE - SAY_W / 2 + nudge;
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start + SAY_W).toBeLessThanOrEqual(PAGE);
  });

  it("roaming, it sits level with his boots and not with his face", async () => {
    /* The other half of the owner's note. He stands on the *top edge of a
       section*, so the band level with his feet is the gutter between two of
       them — whitespace on both sides, because the section above has bottom
       padding and the one below has top padding. His face is three quarters of
       his own height up from that edge, which is three quarters of the way back
       into the previous section's content, and on a portfolio that content is
       regularly a photograph.

       `--say-face` is how far down his box the sentence is centred, so the
       whole of the change is that number becoming his full height. */
    const say = await speaks("roam");
    expect(say.style.getPropertyValue("--say-face")).toBe("40px");
  });

  it("anchored, it stays at his face, because his floor is the credit", async () => {
    /* And this is why the line above is not simply "lower it". An anchored
       companion has no seam under him: he stands on the credit's own baseline,
       and the thing level with his boots is the sentence *{sk} made this*. */
    const say = await speaks("anchor");
    const face = parseFloat(say.style.getPropertyValue("--say-face"));
    expect(face).toBeGreaterThan(0);
    expect(face).toBeLessThan(40);
  });
});

describe("the yard, and two numbers that are only correct together", () => {
  /* `fileURLToPath` rather than `new URL(…, import.meta.url)`: this file runs
     under happy-dom, whose `URL` is the DOM's and which `readFileSync` refuses
     with "the URL must be of scheme file". */
  const credit = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/astro/Credit.astro"),
    "utf8"
  );

  it("Credit.astro reserves him a yard beside the words rather than over them", () => {
    /* The three declarations that move him off the credit, each of which does
       something the other two cannot. Positioned, because `anchor` placement
       means *the host's own containing block* and until 0.28.0 that was the box
       around the sentence. Zero-height, because a box with no height has its
       block-start edge — the edge he stands on — in the same place as its
       bottom margin edge, which for an empty inline-block is the credit's text
       baseline: he stands on the same floor the words do and the line box does
       not grow. And a declared width, because a width that arrived with the
       deferred chunk would reflow somebody's footer at idle. */
    const yard = /\.sk-credit-yard\s*\{([^}]*)\}/.exec(credit)?.[1] ?? "";
    expect(yard).toMatch(/position:\s*relative/);
    expect(yard).toMatch(/block-size:\s*0/);
    expect(yard).toMatch(/inline-size:\s*calc\(/);
  });

  it("the walk band keeps his box inside that yard", () => {
    /* **The assertion the two comments promise.** He is placed by his centre
       and drawn either side of it, so his box stays inside a yard of `k` of his
       own widths only while the band starts no earlier than `1 / 2k`. The two
       numbers live in two different files — the multiplier in a stylesheet in
       `Credit.astro`, the band in `ANCHOR_PACE` — and either one moved alone
       walks him back over the credit at one end of every pace, which is the
       exact defect this release is fixing and which nothing else here would
       catch.

       The multiplier is read out of the stylesheet rather than written down
       again, because a third copy of it would be a third thing to keep in
       step. */
    const size = /\.sk-credit-yard\s*\{[^}]*inline-size:\s*calc\(([^;]*)\)\s*;/.exec(credit)?.[1];
    expect(size).toBeTruthy();
    const k = parseFloat(/\*\s*([\d.]+)\s*$/.exec(size!.trim())?.[1] ?? "");
    expect(k).toBeGreaterThan(0);

    const floor = 1 / (2 * k);
    expect(ANCHOR_PACE.walkMin!).toBeGreaterThanOrEqual(floor);
    expect(ANCHOR_PACE.walkMax!).toBeLessThanOrEqual(1 - floor);
  });

  it("centres him with one property, so both halves mirror together", async () => {
    /* **The bug this catches was invisible to every other assertion here and
       was found by measuring a right-to-left page.** His centring was two
       declarations — `inset-inline-start` placing his inline-start edge at the
       fraction, and a negative `margin-inline-start` pulling back half his
       width. On an English page they agree. On `mosleh-clinic` they did not:
       the inset mirrored and the margin did not mirror with it, so he sat half
       his own width further toward the inline-end and, at the far end of his
       walk band, stood 20px outside the yard reserved for him — measured at
       [795,836] against a yard of [815,876].

       The correction lives in the inset now and the margin is gone. Asserted as
       *both* facts, because either alone reads as a refactor: the half-width
       has to be in the inset, and there must be no margin left behind to apply
       it a second time. */
    const { host } = page();
    mountCompanion(host, { placement: { mode: "anchor" } });
    await flush();
    const css = [...host.shadowRoot!.adoptedStyleSheets[0]!.cssRules]
      .map((r) => r.cssText)
      .join("\n");
    const hostRule = /:host\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(hostRule).toMatch(/inset-inline-start:\s*calc\([^;]*--sk-mate-x[^;]*\/\s*2\s*\)/);
    expect(hostRule).not.toMatch(/margin-inline-start/);
  });

  it("and the roaming band would not have", () => {
    /* Stated so the bound above cannot be read as a formality: the default band
       is what an anchored companion inherited before this release, and it puts
       a third of him back on the words. */
    expect(PACE.walkMin).toBeLessThan(1 / (2 * 1.5));
  });
});

describe("the sk figure, as the default rig", () => {
  it("is the default when no rig is passed", async () => {
    const { host } = page();
    mountCompanion(host, { placement: { mode: "roam", stages: "[data-mate-stage]" } });
    await flush();
    const classes = [...host.shadowRoot!.querySelectorAll("svg > path")].map((p) =>
      p.getAttribute("class")
    );
    expect(classes).toEqual([...PARTS]);
    expect(skFigure.parts).toBe(PARTS);
  });

  it("stands on the floor rather than in it", () => {
    /* `emit()` solves the root down until the lowest foot is on GROUND, and
       this figure's whole placement on a page is `ground` spending that
       fraction to put his feet on a section's top edge. If he floats here he
       floats there, and there it looks like a CSS bug. */
    for (const name of ["stand", "crouch", "guard", "horse", "bow"]) {
      const ds = emit(stance(name));
      expect(ds.length).toBe(PARTS.length);
      expect(ds.every((d) => d.length > 0)).toBe(true);
    }
    expect(skFigure.ground).toBeCloseTo(GROUND / VBH, 10);
  });

  it("flips backwards, once, and lands the right way up", () => {
    /* The sign is the difference between the two words: `emit()` turns about
       the hip in screen order, so a negative angle throws the head over the
       back. The owner's note said backflip and this is the sign that word
       is. */
    expect(flip(0).spin).toBe(-0);
    expect(flip(0.5).spin).toBe(-180);
    expect(flip(1).spin).toBe(-360);
    /* A symmetric arc peaking at one, and the legs open for the floor before he
       is the right way up. */
    expect(flip(0.5).rise).toBeCloseTo(1, 10);
    expect(flip(0).rise).toBe(0);
    expect(flip(1).rise).toBe(0);
    expect(flip(0.79).pose).toBe("tuck");
    expect(flip(0.81).pose).toBe("crouch");
    /* Clamped, because a caller's clock can overshoot its own duration by a
       frame. */
    expect(flip(2).spin).toBe(-360);
    expect(flip(-1).spin).toBe(-0);
  });

  it("has a stride quoted in its own height, so the boots do not skate", () => {
    expect(skFigure.stride).toBe(15);
  });
});
