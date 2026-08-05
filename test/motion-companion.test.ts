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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountCompanion, skFigure, PACE, ANCHOR_PACE } from "../src/motion/companion.js";
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

  it("anchored, the cadence is a signature's and not a character's", () => {
    /* One line, on an interval far longer than a page's own, and no landing
       aside at all — a joke about knees in a client's footer is a joke in
       somebody else's voice. */
    expect(ANCHOR_PACE.sayCap).toBe(1);
    expect(ANCHOR_PACE.aside).toBe(0);
    expect(ANCHOR_PACE.sayGap).toBeGreaterThan(PACE.sayGap);
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
