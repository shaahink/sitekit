/* The balloon's load-bearing claim: the tail always points at the speaker and
   is always attached to the balloon. Those two are in tension — a tail rooted
   under a speaker who has walked off the end of the drawing is a tail that has
   come off the corner — and the resolution is the ordering `aim` encodes: the
   root slides first, the tip leans only once the root has run out of edge. If
   that inverts, balloons start growing notches instead of points. */

import { describe, expect, it } from "vitest";
import { aim, balloon } from "../src/motion/balloon.js";

/** Every vertex of a path, in order. The module emits nothing but M/L/Z, so a
    number sweep is a faithful reading of it rather than a parser. */
const points = (d: string): { x: number; y: number }[] => {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i]!, y: nums[i + 1]! });
  return out;
};

describe("balloon", () => {
  it("closes, and draws an octagon when it has nothing to point at", () => {
    const d = balloon(100, 40, { chamfer: 6 });
    expect(d.endsWith("Z")).toBe(true);
    expect(points(d)).toHaveLength(8);
  });

  it("grows exactly three vertices when it gains a tail", () => {
    const plain = points(balloon(100, 40, { chamfer: 6 }));
    const tailed = points(balloon(100, 40, { chamfer: 6, tail: { drop: 12 } }));
    expect(tailed).toHaveLength(plain.length + 3);
  });

  it("puts the tip where it was asked for", () => {
    const d = balloon(100, 40, { chamfer: 6, tail: { base: 0.5, lean: 0, drop: 14, root: 10 } });
    const tip = points(d).reduce((low, p) => (p.y > low.y ? p : low));
    expect(tip.y).toBeCloseTo(54, 5);
    expect(tip.x).toBeCloseTo(50, 5);
  });

  it("leans the tip without taking the root off the edge", () => {
    const d = balloon(100, 40, { chamfer: 6, tail: { base: 0, lean: -0.4, drop: 14, root: 10 } });
    const pts = points(d);
    const tip = pts.reduce((low, p) => (p.y > low.y ? p : low));
    /* The tip is allowed outside the box — that is what leaning means. */
    expect(tip.x).toBeLessThan(0);
    /* Its two roots are not: both sit on the flat of the block-end edge, which
       starts one chamfer in. */
    const roots = pts.filter((p) => p.y === 40);
    for (const root of roots) expect(root.x).toBeGreaterThanOrEqual(6);
  });

  it("keeps the root inside the flat edge at either extreme of base", () => {
    for (const base of [-2, 0, 0.5, 1, 3]) {
      const pts = points(balloon(80, 30, { chamfer: 5, tail: { base, root: 12, drop: 10 } }));
      for (const p of pts.filter((q) => q.y === 30)) {
        expect(p.x).toBeGreaterThanOrEqual(5);
        expect(p.x).toBeLessThanOrEqual(75);
      }
    }
  });

  it("survives a chamfer bigger than the box rather than folding inside out", () => {
    const pts = points(balloon(40, 20, { chamfer: 999 }));
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(40);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(20);
    }
  });

  it("insets the outline so a centred stroke is not clipped", () => {
    const pts = points(balloon(100, 40, { chamfer: 6, inset: 1 }));
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(1, 5);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(99, 5);
  });
});

describe("aim", () => {
  it("hangs the tail straight down when the speaker is under the balloon", () => {
    expect(aim({ speaker: 50, start: 25, width: 50 })).toEqual({ base: 0.5, lean: 0 });
  });

  it("slides the root before it leans the tip", () => {
    /* A third of the way along: still on the flat, so nothing leans yet. */
    const near = aim({ speaker: 40, start: 25, width: 50, margin: 0.14, slack: 0.34 });
    expect(near.base).toBeCloseTo(0.3, 5);
    expect(near.lean).toBe(0);
  });

  it("leans only once the root has run out of edge", () => {
    const far = aim({ speaker: 100, start: 25, width: 50, margin: 0.14, slack: 0.34 });
    expect(far.base).toBeCloseTo(0.86, 5);
    expect(far.lean).toBeCloseTo(0.34, 5);
  });

  it("mirrors: a speaker the same distance the other way is the same numbers, negated", () => {
    const end = aim({ speaker: 90, start: 25, width: 50 });
    const start = aim({ speaker: -15, start: 25, width: 50 });
    expect(start.base).toBeCloseTo(1 - end.base, 5);
    expect(start.lean).toBeCloseTo(-end.lean, 5);
  });

  it("points down the middle rather than throwing when nothing has been laid out", () => {
    expect(aim({ speaker: 12, start: 0, width: 0 })).toEqual({ base: 0.5, lean: 0 });
  });
});
