/* Motion plumbing for the fleet: the loading contract every decorative
   sequence obeys (`boot.ts`), the forward-kinematics figure rig (`rig.ts`),
   the moves a sequence is written out of (`moves.ts`), and the speech balloon
   that attributes what it says (`balloon.ts`). The kit holds the machinery;
   poses, choreography, costume and every question of ink and paper are
   presentation and stay in each site.

   One barrel, and it is measured rather than tidy: a site imports this once
   inside its deferred chunk, and Rollup shakes one graph better than it
   dedupes four subpath chunks. The subpaths exist for a site that wants only
   the geometry — `./motion/balloon` is pure arithmetic with no DOM in it at
   all, so it can be used from a build script or a test without a window. */

export { mountMotion, cssToken, setVar } from "./boot.js";
export type { MotionControls, MountOptions } from "./boot.js";
export {
  atEase,
  solve,
  poly,
  lerp,
  mix,
  gait,
  overlay,
  jumpArc,
  follow
} from "./rig.js";
export type { RigDims, Pose, Pt, Joints, GaitOptions } from "./rig.js";
export { fall, ripple, cue, timetable } from "./moves.js";
export type { Track, FallOptions, RippleOptions, CueOptions, Timetable } from "./moves.js";
export { balloon, aim } from "./balloon.js";
export type { Tail, BalloonOptions, AimOptions } from "./balloon.js";
