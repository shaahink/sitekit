/* A figure that is computed, not photographed.
   ---------------------------------------------------------------------------
   The first hero sequence on sk-works morphed a figure between five hand-drawn
   stances, and the result taught the lesson this module exists to keep: a
   point-lerp between two drawings is a slideshow with blending. `morphTo`
   interpolates coordinates, so mid-tween an arm is not an arm rotating — it is
   two arms averaged, and it shortens through the move the way no limb does.
   Five poses over a minute read as five slides.

   This is the engineered alternative: a forward-kinematics rig. A pose is a
   flat record of numbers — joint angles in degrees, a root offset in viewBox
   units — and geometry is *derived* from it, every frame, by trigonometry.
   Interpolating angles instead of points means a limb keeps its length through
   every frame by construction (there is a test asserting exactly that), an arm
   swings through an arc rather than sliding through an average, and any tween
   engine that can animate the numbers on a plain object can drive the figure —
   the rig never imports one.

   Why flat numbers and not nested structures: a channel a tween engine can
   address is a property on an object, and `pose.armLa` is one where
   `pose.arms.left.a` is three. The flatness *is* the API.

   Pure module, deliberately. No DOM, no timers, no state — a site calls
   `solve` with a pose and gets joint coordinates, calls `poly` to spell paths,
   and owns everything about what the figure wears and when it moves. The kit
   holds the mathematics because the mathematics is the part every site would
   otherwise re-derive wrong once; the choreography and the costume are
   presentation, and presentation belongs to sites (PLAN §3.2).

   Conventions, stated once and relied on everywhere:
   - Coordinates are viewBox units, +x inline-forward, +y down — SVG's own.
     A site that mirrors for RTL does so outside the rig (the figure's *travel*
     across a page belongs to a logical CSS property, not to these numbers).
   - Limb angles are degrees from "hanging straight down"; positive swings
     toward +x. 0 is standing at ease, 90 points forward, -90 points back.
   - Bends are relative to the parent segment. An elbow bend adds to the upper
     arm's angle (forearms bend forward); a knee bend subtracts from the
     thigh's (shins bend back). Anatomy as sign convention.
   - The root sits at the hip. Standing with zero angles puts the feet on
     `ground`; the `y` channel is how a pose crouches (+) or leaves the
     floor (−), because hip height is a decision, not a derivation. */

/** The segment lengths and widths of a figure, in viewBox units. */
export interface RigDims {
  /** Hip centre to the base of the neck. */
  torso: number;
  /** Neck to the centre of the head. */
  neck: number;
  /** Half the shoulder span. */
  shoulder: number;
  /** Half the hip span. */
  hip: number;
  upperArm: number;
  foreArm: number;
  thigh: number;
  shin: number;
  /** Ankle to toe. */
  foot: number;
}

/** One frame's worth of figure, as tweenable numeric channels.
    Every channel has a meaningful zero, so a Partial<Pose> is a pose that
    leaves the rest of the body alone — which is what lets locomotion be an
    additive overlay rather than a competing owner of the same numbers. */
export interface Pose {
  /** Root offset from the anchor, viewBox units. +y is down: crouch is
      positive, a jump is negative. */
  x: number;
  y: number;
  /** Torso tilt from vertical, degrees, + leans forward. */
  lean: number;
  /** Head tilt relative to the torso. */
  head: number;
  /** Arms: `a` is the shoulder swing, `b` the elbow bend (forward). */
  armLa: number;
  armLb: number;
  armRa: number;
  armRb: number;
  /** Legs: `a` is the hip swing, `b` the knee bend (back). */
  legLa: number;
  legLb: number;
  legRa: number;
  legRb: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** Every joint `solve` places. Named, not arrayed, so a costume function reads
    `j.handR` instead of `j[8]` — the index is the kind of coupling that breaks
    silently when a joint is added. */
export interface Joints {
  hip: Pt;
  neck: Pt;
  head: Pt;
  shoulderL: Pt;
  elbowL: Pt;
  handL: Pt;
  shoulderR: Pt;
  elbowR: Pt;
  handR: Pt;
  hipL: Pt;
  kneeL: Pt;
  ankleL: Pt;
  toeL: Pt;
  hipR: Pt;
  kneeR: Pt;
  ankleR: Pt;
  toeR: Pt;
}

const RAD = Math.PI / 180;

/** Unit vector for a limb angle: 0 hangs down, positive swings toward +x. */
const limb = (deg: number): Pt => ({ x: Math.sin(deg * RAD), y: Math.cos(deg * RAD) });

const along = (from: Pt, deg: number, len: number): Pt => {
  const d = limb(deg);
  return { x: from.x + d.x * len, y: from.y + d.y * len };
};

/** A neutral pose — standing at ease, everything zero. Spread it under a
    partial to make authoring poses a diff rather than a form to fill in. */
export const atEase = (): Pose => ({
  x: 0,
  y: 0,
  lean: 0,
  head: 0,
  armLa: 0,
  armLb: 0,
  armRa: 0,
  armRb: 0,
  legLa: 0,
  legLb: 0,
  legRa: 0,
  legRb: 0
});

/** Place every joint of `pose` for a figure whose feet-at-ease rest on
    `ground` and whose hip is horizontally anchored at `anchorX`.

    The torso is solved first because everything hangs off it: the shoulders
    sit half a span either side of the neck along the torso's perpendicular,
    the hips likewise around the root, and the limbs chain outward with their
    angles measured *in the torso's frame* — lean the body and the arms lean
    with it, which is what makes a lunge read as one movement instead of a
    torso abandoning its limbs. */
export function solve(pose: Pose, dims: RigDims, anchorX: number, ground: number): Joints {
  const hip: Pt = {
    x: anchorX + pose.x,
    y: ground - (dims.thigh + dims.shin) + pose.y
  };

  /* The torso's own axes: `up` toward the neck, `side` toward +x when
     standing. Lean rotates both together. */
  const up: Pt = { x: Math.sin(pose.lean * RAD), y: -Math.cos(pose.lean * RAD) };
  const side: Pt = { x: -up.y, y: up.x };

  const neck: Pt = { x: hip.x + up.x * dims.torso, y: hip.y + up.y * dims.torso };
  const headDeg = pose.lean + pose.head;
  const head: Pt = {
    x: neck.x + Math.sin(headDeg * RAD) * dims.neck,
    y: neck.y - Math.cos(headDeg * RAD) * dims.neck
  };

  const shoulderL: Pt = { x: neck.x - side.x * dims.shoulder, y: neck.y - side.y * dims.shoulder };
  const shoulderR: Pt = { x: neck.x + side.x * dims.shoulder, y: neck.y + side.y * dims.shoulder };
  const hipL: Pt = { x: hip.x - side.x * dims.hip, y: hip.y - side.y * dims.hip };
  const hipR: Pt = { x: hip.x + side.x * dims.hip, y: hip.y + side.y * dims.hip };

  /* Arms are measured in the torso's frame — swing 0 hangs *along the torso*,
     so leaning the body carries the arms with it (the torso's down direction
     sits at limb angle −lean: its vector is (−sin l, cos l)). Legs stay in the
     world frame, because stances are authored against the ground — a horse
     stance's feet do not shuffle when the torso leans. Elbows add (forearms
     bend forward), knees subtract (shins bend back). */
  const armL1 = -pose.lean + pose.armLa;
  const armR1 = -pose.lean + pose.armRa;
  const elbowL = along(shoulderL, armL1, dims.upperArm);
  const elbowR = along(shoulderR, armR1, dims.upperArm);
  const handL = along(elbowL, armL1 + pose.armLb, dims.foreArm);
  const handR = along(elbowR, armR1 + pose.armRb, dims.foreArm);

  const legL1 = pose.legLa;
  const legR1 = pose.legRa;
  const kneeL = along(hipL, legL1, dims.thigh);
  const kneeR = along(hipR, legR1, dims.thigh);
  const shinLDeg = legL1 - pose.legLb;
  const shinRDeg = legR1 - pose.legRb;
  const ankleL = along(kneeL, shinLDeg, dims.shin);
  const ankleR = along(kneeR, shinRDeg, dims.shin);
  /* Feet perpendicular to the shin, pointing forward: standing still that is
     flat on the ground, and mid-stride it rolls with the leg for free. */
  const toeL = along(ankleL, shinLDeg + 90, dims.foot);
  const toeR = along(ankleR, shinRDeg + 90, dims.foot);

  return {
    hip,
    neck,
    head,
    shoulderL,
    elbowL,
    handL,
    shoulderR,
    elbowR,
    handR,
    hipL,
    kneeL,
    ankleL,
    toeL,
    hipR,
    kneeR,
    ankleR,
    toeR
  };
}

/** Spell points as path data. Two decimals — enough that no eye can see the
    quantisation at any size these figures are drawn, and short enough that a
    frame's worth of `d` rewrites stays cheap. */
export function poly(points: readonly Pt[], close = false): string {
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    d += (i === 0 ? "M" : " L") + p.x.toFixed(2) + " " + p.y.toFixed(2);
  }
  return close ? d + " Z" : d;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Blend two poses channel by channel. For a tween engine this is redundant —
    animating the pose object *is* the interpolation — but a site scrubbing by
    scroll, or stepping to a known frame, wants the same arithmetic without
    owning a timeline. */
export function mix(a: Pose, b: Pose, t: number): Pose {
  const out = { ...a };
  for (const key of Object.keys(out) as (keyof Pose)[]) out[key] = lerp(a[key], b[key], t);
  return out;
}

export interface GaitOptions {
  /** Hip swing amplitude, degrees. A walk is ~25, a run ~45. */
  stride?: number;
  /** Counter-swing of the arms, degrees. */
  armSwing?: number;
  /** How far a recovering knee folds, degrees. */
  lift?: number;
  /** Vertical bob of the hips, viewBox units. */
  bob?: number;
}

/** One frame of locomotion, generated rather than keyframed.
    ---------------------------------------------------------------------------
    `phase` is strides walked so far — distance ÷ stride length, decided by the
    caller, which is what keeps feet from skating: tie phase to the figure's
    actual travel and the legs turn exactly as fast as the ground goes by.

    The legs are opposed sines; the arms are the legs, negated and scaled,
    which is what everyone's arms do. Knees fold on the recovery half of the
    cycle only (a planted leg stays long) — that is the `max(0, …)`, phased a
    little ahead of the hip so the foot folds as it leaves the ground, not
    after. Hips bob twice per cycle, dipping as the legs scissor.

    Everything returned is an *offset from zero*, so the caller applies it
    additively over whatever pose the figure holds and scales it by an
    envelope: ramp the weight 0→1→0 across a walk and the figure eases out of
    its stance into the cycle and back, with no handoff pop and nothing for a
    timeline to unwind. */
export function gait(phase: number, options: GaitOptions = {}): Partial<Pose> {
  const stride = options.stride ?? 25;
  const armSwing = options.armSwing ?? 0.6 * stride;
  const lift = options.lift ?? 1.4 * stride;
  const bob = options.bob ?? 0.8;

  const w = phase * 2 * Math.PI;
  const swing = Math.sin(w);
  return {
    legLa: swing * stride,
    legRa: -swing * stride,
    legLb: lift * Math.max(0, Math.sin(w + 2.4)),
    legRb: lift * Math.max(0, Math.sin(w + Math.PI + 2.4)),
    armLa: -swing * armSwing,
    armRa: swing * armSwing,
    y: bob * (0.5 - 0.5 * Math.cos(2 * w))
  };
}

/** Overlay `add` onto `base`, scaled by `weight`. The other half of `gait`:
    base stays owned by whoever tweens it, the overlay is arithmetic on top. */
export function overlay(base: Pose, add: Partial<Pose>, weight = 1): Pose {
  const out = { ...base };
  for (const key of Object.keys(add) as (keyof Pose)[]) {
    out[key] = base[key] + (add[key] ?? 0) * weight;
  }
  return out;
}

/** Height of a ballistic jump at progress `t` ∈ [0,1]: 4ht(1−t). Zero at both
    ends, `height` at the apex, and the *shape* of real gravity — constant
    downward curvature — which is why a linear tween through it reads as a leap
    where an eased translateY reads as a lift. Returned positive; screen-space
    callers subtract it from `y`. */
export function jumpArc(t: number, height: number): number {
  return 4 * height * t * (1 - t);
}

/** One step of exponential chase: move `current` toward `target` by fraction
    `k` (0..1) per step. The whole of follow-through and secondary motion — a
    scarf, a tail, a held prop lagging its owner — is this line applied every
    frame with a small k. Frame-rate honest enough for decoration; pass a k
    derived from dt if it ever matters. */
export function follow(current: number, target: number, k: number): number {
  return current + (target - current) * k;
}
