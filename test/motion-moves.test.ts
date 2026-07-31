/* The moves, checked against the contract rather than against an engine.
   A fake timeline records what it was asked to do; every claim below is about
   the *shape* of that recording — how many tweens, in what order, and what
   each one is worth in milliseconds — because that is the whole of what these
   helpers decide. What the numbers look like on a screen is the site's. */

import { describe, expect, it } from "vitest";
import { cue, fall, ripple, timetable, type Track } from "../src/motion/moves.js";

interface Call {
  targets: unknown;
  props: Record<string, unknown>;
  at: number | undefined;
}

const recorder = (): Track & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    add(targets, props, position) {
      calls.push({ targets, props, at: position });
      return this;
    }
  };
};

describe("fall", () => {
  it("is a fall and then a settle, not one eased drop", () => {
    const tl = recorder();
    fall(tl, "chip", 1000, { duration: 400, settle: 200 });
    expect(tl.calls).toHaveLength(2);
    expect(tl.calls[0]!.at).toBe(1000);
    expect(tl.calls[1]!.at).toBe(1400);
  });

  it("returns the moment it is finally still", () => {
    const tl = recorder();
    expect(fall(tl, "chip", 1000, { duration: 400, settle: 200 })).toBe(1600);
  });

  it("travels in percentages, so the drop is the same at every width", () => {
    const tl = recorder();
    fall(tl, "chip", 0);
    for (const call of tl.calls) {
      for (const value of [call.props.y].flat()) {
        if (typeof value === "string") expect(value.endsWith("%")).toBe(true);
      }
    }
  });

  it("lands at the angle it was given", () => {
    const tl = recorder();
    fall(tl, "chip", 0, { tilt: -7 });
    expect(tl.calls[0]!.props.rotate).toEqual([0, -7]);
  });
});

describe("ripple", () => {
  it("staggers forward by default", () => {
    const tl = recorder();
    ripple(tl, ["a", "b", "c"], { opacity: 1 }, 500, { gap: 50 });
    const delay = tl.calls[0]!.props.delay as (el: unknown, i: number) => number;
    expect([0, 1, 2].map((i) => delay(null, i))).toEqual([0, 50, 100]);
  });

  it("plays the arrival backwards when reversed, which is what clearing is", () => {
    const tl = recorder();
    ripple(tl, ["a", "b", "c"], { opacity: 0 }, 500, { gap: 50, reverse: true });
    const delay = tl.calls[0]!.props.delay as (el: unknown, i: number) => number;
    expect([0, 1, 2].map((i) => delay(null, i))).toEqual([100, 50, 0]);
  });

  it("returns when the last one has finished, not when the first one starts", () => {
    const tl = recorder();
    expect(ripple(tl, ["a", "b", "c"], {}, 500, { gap: 50, duration: 200 })).toBe(800);
  });

  it("is a no-op on an empty row rather than something a caller has to guard", () => {
    const tl = recorder();
    expect(ripple(tl, [], { opacity: 1 }, 500)).toBe(500);
    expect(tl.calls).toHaveLength(0);
  });

  it("does not overwrite the caller's own properties", () => {
    const tl = recorder();
    ripple(tl, ["a"], { opacity: [0, 1], scaleX: [0.15, 1] }, 0);
    expect(tl.calls[0]!.props.opacity).toEqual([0, 1]);
    expect(tl.calls[0]!.props.scaleX).toEqual([0.15, 1]);
  });
});

describe("cue", () => {
  it("schedules the entrance and the exit together", () => {
    const tl = recorder();
    cue(tl, "line", 2000, { hold: 3000 });
    expect(tl.calls).toHaveLength(2);
    expect(tl.calls[0]!.at).toBe(2000);
    expect(tl.calls[1]!.at).toBe(5000);
  });

  it("returns when the card is gone", () => {
    const tl = recorder();
    expect(cue(tl, "line", 2000, { hold: 3000, leave: 300 })).toBe(5300);
  });

  it("takes its direction from the sign it was given, and leaves part of the way back", () => {
    const tl = recorder();
    cue(tl, "title", 0, { from: -10 });
    expect(tl.calls[0]!.props.y).toEqual([-10, 0]);
    expect(tl.calls[1]!.props.y).toBeCloseTo(-4, 5);
  });
});

describe("timetable", () => {
  it("keeps every beat readable as a property", () => {
    const T = timetable({ wake: 0, wipe: 1100, turn: 8200 });
    expect(T.wipe).toBe(1100);
  });

  it("answers the two questions a retune asks", () => {
    const T = timetable({ wake: 0, wipe: 1100, turn: 8200 });
    expect(T.after("wipe", 400)).toBe(1500);
    expect(T.span("wipe", "turn")).toBe(7100);
  });

  it("is frozen, because a beat moved at runtime is a sequence nobody can read", () => {
    const T = timetable({ wake: 0, wipe: 1100 });
    expect(Object.isFrozen(T)).toBe(true);
  });
});
