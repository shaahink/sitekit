/* The rig's one load-bearing claim, asserted: geometry is derived, so the
   figure cannot fall apart. The morph-based figure this replaced interpolated
   *points*, and mid-tween a limb was two limbs averaged — shorter than either.
   Here the interpolation happens in angle space and lengths survive every
   frame by construction. If that invariant ever breaks, the module has been
   rewritten into the thing it exists to not be. */

import { describe, expect, it } from "vitest";
import {
  atEase,
  follow,
  gait,
  jumpArc,
  mix,
  overlay,
  poly,
  solve,
  type Pose,
  type Pt,
  type RigDims
} from "../src/motion/rig.js";

const DIMS: RigDims = {
  torso: 16,
  neck: 4,
  shoulder: 5,
  hip: 3.5,
  upperArm: 8,
  foreArm: 8,
  thigh: 12,
  shin: 12,
  foot: 4
};

const len = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

const GUARD: Pose = {
  ...atEase(),
  lean: 8,
  head: -4,
  armLa: -30,
  armLb: 70,
  armRa: 40,
  armRb: 50,
  legLa: -14,
  legLb: 10,
  legRa: 18,
  legRb: 12,
  y: 2
};

const STRIKE: Pose = {
  ...atEase(),
  lean: 22,
  armLa: -50,
  armLb: 30,
  armRa: 95,
  armRb: 5,
  legLa: -30,
  legLb: 6,
  legRa: 35,
  legRb: 30,
  y: 3
};

describe("solve", () => {
  it("keeps every segment at its authored length, in any pose", () => {
    for (const pose of [atEase(), GUARD, STRIKE]) {
      const j = solve(pose, DIMS, 24, 69);
      expect(len(j.hip, j.neck)).toBeCloseTo(DIMS.torso, 6);
      expect(len(j.neck, j.head)).toBeCloseTo(DIMS.neck, 6);
      expect(len(j.shoulderL, j.elbowL)).toBeCloseTo(DIMS.upperArm, 6);
      expect(len(j.elbowL, j.handL)).toBeCloseTo(DIMS.foreArm, 6);
      expect(len(j.shoulderR, j.elbowR)).toBeCloseTo(DIMS.upperArm, 6);
      expect(len(j.elbowR, j.handR)).toBeCloseTo(DIMS.foreArm, 6);
      expect(len(j.hipL, j.kneeL)).toBeCloseTo(DIMS.thigh, 6);
      expect(len(j.kneeL, j.ankleL)).toBeCloseTo(DIMS.shin, 6);
      expect(len(j.hipR, j.kneeR)).toBeCloseTo(DIMS.thigh, 6);
      expect(len(j.kneeR, j.ankleR)).toBeCloseTo(DIMS.shin, 6);
      expect(len(j.ankleL, j.toeL)).toBeCloseTo(DIMS.foot, 6);
      expect(len(j.ankleR, j.toeR)).toBeCloseTo(DIMS.foot, 6);
    }
  });

  it("keeps limb lengths through interpolation — the anti-slideshow claim", () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const j = solve(mix(GUARD, STRIKE, t), DIMS, 24, 69);
      expect(len(j.shoulderR, j.elbowR)).toBeCloseTo(DIMS.upperArm, 6);
      expect(len(j.elbowR, j.handR)).toBeCloseTo(DIMS.foreArm, 6);
      expect(len(j.hipL, j.kneeL)).toBeCloseTo(DIMS.thigh, 6);
      expect(len(j.kneeL, j.ankleL)).toBeCloseTo(DIMS.shin, 6);
    }
  });

  it("stands at ease with feet on the ground and hips over the anchor", () => {
    const j = solve(atEase(), DIMS, 24, 69);
    expect(j.hip.x).toBeCloseTo(24, 6);
    expect(j.ankleL.y).toBeCloseTo(69, 6);
    expect(j.ankleR.y).toBeCloseTo(69, 6);
    /* Feet point forward, flat: toes level with ankles. */
    expect(j.toeL.y).toBeCloseTo(j.ankleL.y, 6);
    expect(j.toeL.x).toBeGreaterThan(j.ankleL.x);
  });

  it("leans limbs with the torso: a hanging arm follows the lean", () => {
    const leaned = solve({ ...atEase(), lean: 30 }, DIMS, 24, 69);
    /* Shoulder→hand should run parallel to the torso's down direction. */
    const arm = { x: leaned.handR.x - leaned.shoulderR.x, y: leaned.handR.y - leaned.shoulderR.y };
    const torsoDown = { x: leaned.hip.x - leaned.neck.x, y: leaned.hip.y - leaned.neck.y };
    const cross = arm.x * torsoDown.y - arm.y * torsoDown.x;
    expect(cross).toBeCloseTo(0, 6);
  });
});

describe("gait", () => {
  it("is periodic: a whole stride returns every channel to its start", () => {
    const a = gait(0.2);
    const b = gait(1.2);
    for (const key of Object.keys(a) as (keyof Pose)[]) {
      expect(b[key]).toBeCloseTo(a[key] ?? 0, 6);
    }
  });

  it("opposes the legs and counter-swings the arms", () => {
    const g = gait(0.25);
    expect(g.legLa).toBeCloseTo(-(g.legRa ?? 0), 6);
    expect(Math.sign(g.armLa ?? 0)).toBe(-Math.sign(g.legLa ?? 0));
  });

  it("only folds a knee on its recovery half — a planted leg stays long", () => {
    for (const p of [0, 0.1, 0.3, 0.5, 0.7, 0.9]) {
      const g = gait(p);
      expect(g.legLb).toBeGreaterThanOrEqual(0);
      expect(g.legRb).toBeGreaterThanOrEqual(0);
    }
    /* And the two knees never fold in unison. */
    const folded = gait(0.35);
    expect(Math.min(folded.legLb ?? 0, folded.legRb ?? 0)).toBeCloseTo(0, 6);
  });

  it("returns pure offsets: zero weight leaves the base pose untouched", () => {
    const base = { ...GUARD };
    const out = overlay(base, gait(0.4), 0);
    expect(out).toEqual(GUARD);
  });
});

describe("jumpArc", () => {
  it("is grounded at both ends and peaks at the apex", () => {
    expect(jumpArc(0, 10)).toBe(0);
    expect(jumpArc(1, 10)).toBe(0);
    expect(jumpArc(0.5, 10)).toBe(10);
    /* Constant downward curvature — the parabola, sampled. */
    const h = (t: number) => jumpArc(t, 10);
    const secondDiff = h(0.4) - 2 * h(0.5) + h(0.6);
    expect(secondDiff).toBeLessThan(0);
  });
});

describe("poly", () => {
  it("spells a polyline and closes on request", () => {
    const pts = [
      { x: 1, y: 2 },
      { x: 3.14159, y: 4 }
    ];
    expect(poly(pts)).toBe("M1.00 2.00 L3.14 4.00");
    expect(poly(pts, true)).toBe("M1.00 2.00 L3.14 4.00 Z");
  });
});

describe("follow", () => {
  it("chases the target without overshooting", () => {
    let v = 0;
    for (let i = 0; i < 50; i++) v = follow(v, 10, 0.3);
    expect(v).toBeGreaterThan(9.9);
    expect(v).toBeLessThanOrEqual(10);
  });
});
