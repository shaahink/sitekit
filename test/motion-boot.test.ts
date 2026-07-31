// @vitest-environment happy-dom
/* The loading contract, driven. What is asserted here is the set of promises
   `mountMotion`'s header makes: nothing loads under reduced motion, nothing
   loads before load+idle, visibility drives play/pause, a mid-flight
   preference flip pauses *and* rests, and a failed start is silence rather
   than a broken drawing. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cssToken, mountMotion, setVar } from "../src/motion/boot.js";

type MediaListener = (event: { matches: boolean }) => void;

let mediaMatches = false;
let mediaListeners: MediaListener[] = [];
let idleCallbacks: (() => void)[] = [];
let observed: { el: Element; cb: (entries: { isIntersecting: boolean }[]) => void }[] = [];

beforeEach(() => {
  mediaMatches = false;
  mediaListeners = [];
  idleCallbacks = [];
  observed = [];

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: mediaMatches,
      addEventListener: (_: string, fn: MediaListener) => mediaListeners.push(fn)
    }))
  );
  Object.assign(window, {
    matchMedia: globalThis.matchMedia,
    requestIdleCallback: (fn: () => void) => {
      idleCallbacks.push(fn);
      return 1;
    }
  });

  class FakeObserver {
    private cb: (entries: { isIntersecting: boolean }[]) => void;
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      this.cb = cb;
    }
    observe(el: Element) {
      observed.push({ el, cb: this.cb });
    }
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  Object.assign(window, { IntersectionObserver: FakeObserver });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/* happy-dom reports readyState "complete", so boot is synchronous-after-idle
   in every test: drain the idle queue, then let microtasks settle. */
const runIdle = async () => {
  for (const fn of idleCallbacks.splice(0)) fn();
  await flush();
};

describe("mountMotion", () => {
  it("does nothing without a target", () => {
    const start = vi.fn();
    mountMotion(null, start);
    expect(start).not.toHaveBeenCalled();
  });

  it("never calls start — never downloads — under reduced motion", async () => {
    mediaMatches = true;
    const start = vi.fn(async () => ({}));
    mountMotion(document.createElement("div"), start);
    await runIdle();
    expect(start).not.toHaveBeenCalled();
  });

  it("defers start to the idle callback rather than calling it inline", async () => {
    const start = vi.fn(async () => ({}));
    mountMotion(document.createElement("div"), start);
    expect(start).not.toHaveBeenCalled();
    expect(idleCallbacks.length).toBe(1);
    await runIdle();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("wires visibility to play/pause", async () => {
    const controls = { play: vi.fn(), pause: vi.fn() };
    const el = document.createElement("div");
    mountMotion(el, async () => controls);
    await runIdle();

    expect(observed.length).toBe(1);
    expect(observed[0]?.el).toBe(el);
    observed[0]?.cb([{ isIntersecting: true }]);
    expect(controls.play).toHaveBeenCalledTimes(1);
    observed[0]?.cb([{ isIntersecting: false }]);
    expect(controls.pause).toHaveBeenCalledTimes(1);
  });

  it("skips the observer for controls with no play state", async () => {
    mountMotion(document.createElement("div"), async () => ({}));
    await runIdle();
    expect(observed.length).toBe(0);
  });

  it("pauses and rests when reduced motion arrives mid-flight", async () => {
    const controls = { play: vi.fn(), pause: vi.fn(), rest: vi.fn() };
    mountMotion(document.createElement("div"), async () => controls);
    await runIdle();

    expect(mediaListeners.length).toBe(1);
    /* The preference relaxing is not a request to stop. */
    mediaListeners[0]?.({ matches: false });
    expect(controls.pause).not.toHaveBeenCalled();

    mediaListeners[0]?.({ matches: true });
    expect(controls.pause).toHaveBeenCalledTimes(1);
    expect(controls.rest).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed start — the markup's still is the fallback", async () => {
    mountMotion(document.createElement("div"), async () => {
      throw new Error("chunk in a tunnel");
    });
    await expect(runIdle()).resolves.not.toThrow();
  });
});

describe("tokens and vars", () => {
  it("reads a custom property off the document", () => {
    document.documentElement.style.setProperty("--ink", " #111 ");
    expect(cssToken("--ink")).toBe("#111");
  });

  it("writes through the CSSOM, never the style attribute string", () => {
    const el = document.createElement("div");
    setVar(el, "--walk", 0.5);
    expect(el.style.getPropertyValue("--walk")).toBe("0.5");
  });
});
