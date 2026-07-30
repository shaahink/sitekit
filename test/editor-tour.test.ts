/* The first run's rules.
   ---------------------------------------------------------------------------
   Same division the rest of the editor's tests follow: what touches the DOM is
   verified in a real browser at a real width, and what would be wrong *silently*
   is tested here. §2.5's steps are the second kind. Every one of them advances on
   something the owner did rather than on a button, so a rule that fires on the
   wrong event, or a flag written at the wrong moment, does not look broken — it
   looks like a tour that never appears, or one that appears forever.

   `tour.ts` takes a view of three methods rather than a bar precisely so this
   file can exist before the kit has a DOM test environment (F13, §2.8 step 6). */

import { describe, expect, it } from "vitest";
import { Tour, TOUR_SEEN, type TourStep, type TourView } from "../src/editor/tour.js";

/** What the bar would have been told, in order. */
function spy(): { calls: string[]; view: TourView } {
  const calls: string[] = [];
  return {
    calls,
    view: {
      show: (step: TourStep, last: boolean) => calls.push(`show:${step}${last ? ":last" : ""}`),
      hide: () => calls.push("hide"),
      spotlight: (on: boolean) => calls.push(`spotlight:${on}`)
    }
  };
}

/** localStorage, small enough to assert against. Cast rather than implemented:
    the DOM's `Storage` carries an index signature a class cannot satisfy without
    one of its own. */
function fakeStore(seen = false): Storage {
  const map = new Map<string, string>();
  if (seen) map.set(TOUR_SEEN, "1");
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value)
  } as Storage;
}

/** The browser that refuses storage rather than returning null — Safari in
    private mode, which is a phone this editor is actually used on. */
const hostile = {
  get length(): number {
    throw new Error("private mode");
  },
  clear: () => {
    throw new Error("private mode");
  },
  getItem: () => {
    throw new Error("private mode");
  },
  key: () => {
    throw new Error("private mode");
  },
  removeItem: () => {
    throw new Error("private mode");
  },
  setItem: () => {
    throw new Error("private mode");
  }
} as unknown as Storage;

describe("the first run's own arrival", () => {
  it("shows step one to a browser that has never seen it", () => {
    const { calls, view } = spy();
    const tour = new Tour(view, fakeStore());
    expect(tour.start()).toBe(true);
    expect(tour.showing).toBe(1);
    /* The ring belongs to the last step and to nothing before it. */
    expect(calls).toEqual(["spotlight:false", "show:1"]);
  });

  it("shows nothing to a browser that has been through it", () => {
    const { calls, view } = spy();
    const tour = new Tour(view, fakeStore(true));
    expect(tour.start()).toBe(false);
    expect(tour.showing).toBeNull();
    expect(calls).toEqual([]);
  });

  it("shows it anyway when the owner asked", () => {
    /* "Show me how" from the panel, and "Show me how again" in the bar's help.
       Refusing somebody who asked because they once dismissed it would be the
       opposite of what both controls say. */
    const tour = new Tour(spy().view, fakeStore(true));
    expect(tour.start(true)).toBe(true);
    expect(tour.showing).toBe(1);
  });

  it("does not restart over itself", () => {
    const tour = new Tour(spy().view, fakeStore());
    tour.start();
    tour.focused();
    expect(tour.start(true)).toBe(false);
    expect(tour.showing).toBe(2);
  });

  it("runs when the browser refuses storage, rather than not running", () => {
    const tour = new Tour(spy().view, hostile);
    expect(tour.start()).toBe(true);
    /* And dismissing it must not throw either — it costs a repeat next time. */
    expect(() => tour.end()).not.toThrow();
  });

  it("runs with no storage at all", () => {
    const tour = new Tour(spy().view, null);
    expect(tour.start()).toBe(true);
    expect(tour.seen).toBe(false);
  });
});

describe("each step advances on the owner doing the thing", () => {
  it("goes to step two when an annotated element takes focus", () => {
    const { calls, view } = spy();
    const tour = new Tour(view, fakeStore());
    tour.start();
    calls.length = 0;
    tour.focused();
    expect(tour.showing).toBe(2);
    expect(calls).toEqual(["spotlight:false", "show:2"]);
  });

  it("goes to step three when the field goes dirty, and rings the way home", () => {
    const { calls, view } = spy();
    const tour = new Tour(view, fakeStore());
    tour.start();
    tour.focused();
    calls.length = 0;
    tour.typed();
    expect(tour.showing).toBe(3);
    /* `last`, so the view offers "Got it" rather than "Skip". */
    expect(calls).toEqual(["spotlight:true", "show:3:last"]);
  });

  it("takes typing as having done step one", () => {
    /* §2.5: an owner who ignores the tour and taps their own text is doing step
       one, and the tour notices. Somebody who typed without reading step one has
       just demonstrated they did not need it — leaving them on it would be the
       tour teaching the thing they have already done. */
    const tour = new Tour(spy().view, fakeStore());
    tour.start();
    tour.typed();
    expect(tour.showing).toBe(3);
  });

  it("ignores focus and typing once it is on the last step", () => {
    const { calls, view } = spy();
    const tour = new Tour(view, fakeStore());
    tour.start();
    tour.typed();
    calls.length = 0;
    tour.focused();
    tour.typed();
    expect(tour.showing).toBe(3);
    expect(calls).toEqual([]);
  });

  it("ignores every event when it is not running", () => {
    const { calls, view } = spy();
    const tour = new Tour(view, fakeStore(true));
    tour.start();
    tour.focused();
    tour.typed();
    tour.wentHome();
    expect(tour.showing).toBeNull();
    expect(calls).toEqual([]);
  });

  it("ends on Home, and only from the step that is about Home", () => {
    const { calls, view } = spy();
    const tour = new Tour(view, fakeStore());
    tour.start();
    tour.wentHome();
    expect(tour.showing).toBe(1);
    tour.typed();
    calls.length = 0;
    tour.wentHome();
    expect(tour.showing).toBeNull();
    expect(calls).toEqual(["spotlight:false", "hide"]);
  });
});

describe("7.7's contract, inherited", () => {
  it("remembers a dismissal", () => {
    const store = fakeStore();
    const tour = new Tour(spy().view, store);
    tour.start();
    tour.end();
    expect(store.getItem(TOUR_SEEN)).toBe("1");
    /* Which is the whole of "dismissed stays dismissed across reloads": a reload
       is a new Tour reading the same flag. */
    expect(new Tour(spy().view, store).start()).toBe(false);
  });

  it("counts finishing as a dismissal", () => {
    const store = fakeStore();
    const tour = new Tour(spy().view, store);
    tour.start();
    tour.typed();
    tour.wentHome();
    expect(store.getItem(TOUR_SEEN)).toBe("1");
  });

  it("does not clear the flag when it is reopened", () => {
    /* home.ts has said this about its own notice since 7.7: someone reading it a
       second time has not become a first-time user again. */
    const store = fakeStore(true);
    const tour = new Tour(spy().view, store);
    tour.start(true);
    expect(store.getItem(TOUR_SEEN)).toBe("1");
    tour.end();
    expect(store.getItem(TOUR_SEEN)).toBe("1");
  });

  it("does not remember a tour that was merely taken off the page", () => {
    /* Leaving edit mode mid-tour. An owner who tapped Done half way through has
       not told us they understood it, so the next visit offers it again — which
       is exactly how 7.7's notice behaves when it is never closed. */
    const store = fakeStore();
    const tour = new Tour(spy().view, store);
    tour.start();
    tour.focused();
    tour.stop();
    expect(tour.showing).toBeNull();
    expect(store.getItem(TOUR_SEEN)).toBeNull();
    expect(new Tour(spy().view, store).start()).toBe(true);
  });

  it("takes the ring down whichever way it is taken off", () => {
    for (const finish of [(t: Tour) => t.end(), (t: Tour) => t.stop()]) {
      const { calls, view } = spy();
      const tour = new Tour(view, fakeStore());
      tour.start();
      tour.typed();
      calls.length = 0;
      finish(tour);
      expect(calls).toEqual(["spotlight:false", "hide"]);
    }
  });

  it("says nothing twice when it is already down", () => {
    const { calls, view } = spy();
    const tour = new Tour(view, fakeStore());
    tour.start();
    tour.end();
    calls.length = 0;
    tour.end();
    tour.stop();
    expect(calls).toEqual([]);
  });
});
