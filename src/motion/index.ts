/* Motion plumbing for the fleet: the loading contract every decorative
   sequence obeys (`boot.ts`) and the forward-kinematics figure rig
   (`rig.ts`). The kit holds the machinery; poses, choreography and costume
   are presentation and stay in each site. */

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
