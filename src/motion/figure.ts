/* The sk figure — the fleet's default character, and the only one it ships.
   ===========================================================================
   `rig.ts` is the mathematics: a pose is twelve numbers, `solve` turns them
   into joints, and a limb keeps its length through every tween by
   construction. Nothing in it knows what a gi is. **This file is the person** —
   the proportions, the costume, the stance library, the way he crosses ground
   and the one move he shows off with.

   It is here because `companion.ts` takes the character as a parameter and a
   parameter needs a default. The owner's note asked for *"not the same
   character, but it can start with the same character"*, and the only way a
   client site can start with him is if he is in the package. Pass your own
   `rig` and none of this is loaded into the drawing; it is a default value and
   not a house style.

   **Ported from `sk-studio/src/scripts/figure.js`, and the numbers are the
   point of the port.** Every constant, every angle in `POSE`, every coefficient
   in `glide`, `idle`, `flip` and `emit` is byte-for-byte what that file has,
   because `sk-studio` proves this drawing with a committed contact sheet —
   `scripts/mate-check.mjs` renders sixteen breaths, a landing, a pace and a
   backflip and diffs the picture as pixels. That sheet is drawn through *this*
   module now, and it comes back identical or the port is wrong. A refactor
   that alters a pose has altered behaviour, and there it is a diff rather than
   an opinion. **So do not tidy an arithmetic expression in here.**

   What deliberately did *not* come with it is colour. The site's stylesheet
   paints these nineteen marks out of `--ink`, `--paper`, `--wash` and
   `--ink-faint`, which are `sk-studio`'s token names and no fleet contract at
   all. The kit's copy of that sheet lives in `companion.ts` and is written in
   `currentColor` and `Canvas`, which every document has. See the note there.

   Conventions inherited from the rig: viewBox units, +x forward, +y down;
   angles in degrees from hanging straight down; the root is the hip. Facing is
   a **reflection at emission** rather than a CSS transform, so nothing
   directional leaks into a stylesheet that has to mirror for a right-to-left
   locale. */

import { atEase, solve, poly, overlay, follow } from "./rig.js";
import type { Pose, Pt, RigDims } from "./rig.js";

/* --- the drawing he is drawn in ------------------------------------------ */

/** The viewBox, as the four numbers an `<svg>` wants. `VBX` is negative
    because the box grew asymmetrically to hold his reach — which is exactly
    why `ANCHOR` below is not the middle of it. */
export const VBX = -6;
export const VBW = 60;
export const VBH = 72;

/** The vertical line he is reflected about when he turns round, and the floor
    his feet are planted on. Both in viewBox units. */
export const ANCHOR = 24;
export const GROUND = 69;

/** Segment lengths. A person is about seven heads tall and this one is forty
    five units of figure, which is what makes the limbs long against the torso
    and the whole thing read at the size a page draws him. */
export const DIMS: RigDims = {
  torso: 15,
  neck: 2.8,
  shoulder: 5.2,
  hip: 3.8,
  upperArm: 7.6,
  foreArm: 7.6,
  thigh: 10.4,
  shin: 10.4,
  foot: 3.4
};

/** The head and what is drawn on it, in the head's own frame: `[sideways,
    up]`, so the whole cluster leans with the neck for free. */
export const HEAD: readonly (readonly [number, number])[] = [
  [2.2, -2.5],
  [2.5, 0.5],
  [1.4, 2.8],
  [-0.9, 3.1],
  [-2.4, 0.9],
  [-1.8, -2.2]
];
export const HEAD_WASH: readonly (readonly [number, number])[] = [
  [-1.8, -2.2],
  [-2.4, 0.9],
  [-0.9, 3.1],
  [0.2, 2.98],
  [0.35, -2.36]
];
export const BAND: readonly (readonly [number, number])[] = [
  [-2.5, 0.7],
  [2.6, 0.3]
];
export const KNOT: readonly [number, number] = [-2.3, 0.9];
export const EYE: readonly (readonly [number, number])[] = [
  [1, -0.4],
  [2.1, -0.6]
];

/** The hem, as two panels rather than one bell. `HEM` is how far each falls,
    `FLARE` how far it stands off the leg, `SPLIT` how much shorter the inner
    corner is than the outer — which is what makes the centre read as an
    opening rather than as a seam. Two narrow panels that follow their own legs
    read as trousers; one wide one hanging off both hips reads as a dress. */
export const HEM = 8;
export const FLARE = 1;
export const SPLIT = 0.55;

/** **The whole stance library, and they are the only drawn poses there are** —
    everything between them is computed by `solve`, so this is a vocabulary
    rather than a flip-book. `y` is absent from all but `tuck` because the floor
    decides the hip height; see `plant()`. */
export const POSE: Record<string, Partial<Pose>> = {
  stand: {
    armLa: -13, armLb: 10, armRa: 13, armRb: 10,
    legLa: -6, legLb: 9, legRa: 7, legRb: 7
  },
  ready: {
    lean: 2, head: 1,
    armLa: -20, armLb: 34, armRa: 26, armRb: 30,
    legLa: -9, legLb: 6, legRa: 11, legRb: 8
  },
  guard: {
    lean: 6, head: 2,
    armLa: -32, armLb: 74, armRa: 46, armRb: 58,
    legLa: -16, legLb: 8, legRa: 20, legRb: 14
  },
  horse: {
    armLa: -24, armLb: 92, armRa: 24, armRb: 92,
    legLa: -38, legLb: 2, legRa: 38, legRb: 12
  },
  strike: {
    lean: 20, head: -2,
    armLa: -38, armLb: 82, armRa: 94, armRb: 4,
    legLa: -30, legLb: 4, legRa: 32, legRb: 26
  },
  sweep: {
    lean: -6, head: 5,
    armLa: 104, armLb: 16, armRa: -64, armRb: 38,
    legLa: -22, legLb: 16, legRa: 26, legRb: 12
  },
  crane: {
    lean: -4, head: 4,
    armLa: -86, armLb: -6, armRa: 86, armRb: 6,
    legLa: 26, legLb: 96, legRa: 6, legRb: 2
  },
  windup: {
    lean: -12, head: 8, x: -2,
    armLa: 42, armLb: 28, armRa: -118, armRb: -26,
    legLa: -18, legLb: 6, legRa: 14, legRb: 10
  },
  release: {
    lean: 26, head: -2, x: 3,
    armLa: -44, armLb: 48, armRa: 96, armRb: -4,
    legLa: -36, legLb: 4, legRa: 30, legRb: 22
  },
  /* The one pose that is airborne rather than planted, and the negative `y` is
     the only surviving hand-set root height in the library. Folded is what
     keeps the wheel inside the viewBox: laid out straight he is fifty-one units
     fingertip to toe and the disc that sweeps would not fit in any frame this
     drawing can afford. */
  tuck: {
    lean: 16, head: -6, y: -3,
    armLa: 34, armLb: 66, armRa: 52, armRb: 74,
    legLa: 54, legLb: 108, legRa: 38, legRb: 96
  },
  crouch: {
    lean: 22, head: -8,
    armLa: 18, armLb: 34, armRa: 58, armRb: 42,
    legLa: -36, legLb: 50, legRa: 40, legRb: 58
  },
  kneel: {
    lean: 10, head: 10,
    armLa: 12, armLb: 48, armRa: 66, armRb: 38,
    legLa: -14, legLb: 68, legRa: 34, legRb: 64
  },
  raise: {
    lean: -2, head: 6,
    armLa: -142, armLb: -8, armRa: 142, armRb: 8,
    legLa: -10, legLb: 2, legRa: 10, legRb: 2
  },
  smash: {
    lean: 30, head: -10,
    armLa: -26, armLb: 34, armRa: 14, armRb: 6,
    legLa: -32, legLb: 22, legRa: 30, legRb: 36
  },
  kick: {
    lean: -16, head: 4,
    armLa: -52, armLb: 44, armRa: 30, armRb: 52,
    legLa: -10, legLb: 4, legRa: 102, legRb: 6
  },
  brace: {
    lean: -7, head: -5,
    armLa: -78, armLb: 48, armRa: 54, armRb: 66,
    legLa: -28, legLb: 26, legRa: 30, legRb: 18
  },
  point: {
    lean: 5, head: 3,
    armLa: -18, armLb: 24, armRa: 88, armRb: -8,
    legLa: -12, legLb: 4, legRa: 15, legRb: 8
  },
  bow: {
    lean: 36, head: 12,
    armLa: 8, armLb: 14, armRa: 12, armRb: 12,
    legLa: -6, legRa: 6
  }
};

/** A stance as a complete twelve-channel pose. Complete rather than partial on
    purpose: a tween that sends every channel means no stance can inherit a
    stray limb from the one before it, which is the bug that produces a figure
    holding one arm out for no reason four beats later. */
export function stance(name: string): Pose {
  return { ...atEase(), ...(POSE[name] ?? {}) };
}

/* --- locomotion ---------------------------------------------------------- */

const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface GlideOptions {
  reach?: number;
  bend?: number;
  lean?: number;
}

/** One frame of a **slide**, which is what this character does instead of
    running. The feet stay on the floor, the stance opens and closes, and the
    head travels in a straight line — a head that rises and falls twice a stride
    is what a gait cycle does by design and it reads as goofy at this size.

    Nothing here decides how high the hips are, and that is the point: a leg
    swung `a` from vertical with its knee folded `b` reaches less than its own
    length below the hip, so a figure that opens its stance at a fixed hip
    height is a figure whose feet leave the floor. `plant()` solves that once
    for every stance there will ever be, which is what frees the legs here to be
    angles. Returned as offsets from zero, so the caller overlays it on whatever
    stance is held and scales it by an envelope. */
export function glide(phase: number, options: GlideOptions = {}): Partial<Pose> {
  const reach = options.reach ?? 15;
  const bend = options.bend ?? 12;
  const lean = options.lean ?? 0;

  const open = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);

  /* The rear leg trails a little less than the lead one reaches: a slide is
     driven from the back foot, so the front of the stance is what travels. */
  const lead = reach * open;
  const rear = -reach * open * 0.92;

  const kneeLead = bend * (0.35 + 0.65 * open);
  const kneeRear = bend * (0.9 - 0.5 * open);

  return {
    legRa: lead,
    legRb: kneeLead,
    legLa: rear,
    legLb: kneeRear,
    lean,
    /* The arms drift rather than swing. A counter-swinging arm is a walk cue
       and this is not a walk. */
    armLa: -4 * open,
    armLb: 7 * open,
    armRa: 6 * open,
    armRb: 11 * open
  };
}

export interface IdleOptions {
  bend?: number;
  sway?: number;
}

/** One frame of **standing**, which is nearly all of what a companion does.
    A figure holding an exact pose for three seconds is not calm, it is a
    photograph somebody forgot to take down.

    **Two rates that do not divide, because a loop you can count is a tell.**
    Breath is the fast one and the weight shift is a little under a third of it,
    and 0.31 is deliberately not 1/3: at a third the two agree every third
    breath and the eye finds that in about ten seconds. At this ratio the pose
    does not repeat for something over a minute.

    The bob is derived rather than tuned — nothing here writes a hip height, it
    bends the knees and `plant()` puts the hips where a bent leg leaves them.
    That amount is a third of one per cent of his height, so do not go looking
    for it: what carries the breath is the knee angle and the sway, which are
    degrees of silhouette and read at any size. */
export function idle(phase: number, options: IdleOptions = {}): Partial<Pose> {
  const bend = options.bend ?? 4;
  const swayAmp = options.sway ?? 1;

  const breath = Math.sin(phase * 2 * Math.PI);
  const sway = Math.sin(phase * 2 * Math.PI * 0.31);

  const fold = bend * (0.5 + 0.5 * breath);
  const shift = swayAmp * sway;

  return {
    legLa: -shift * 0.9,
    legRa: shift * 0.9,
    legLb: fold + shift * 1.6,
    legRb: fold - shift * 1.6,

    /* The torso answers the breath a beat late and the head answers the torso,
       which is the whole of why a nodding figure does not read as a
       bobblehead: the chain lags rather than moves together. */
    lean: 0.9 * Math.sin(phase * 2 * Math.PI - 0.5),
    head: -1.1 * Math.sin(phase * 2 * Math.PI - 1),

    armLa: -1.4 * breath - shift,
    armLb: 2.2 * breath,
    armRa: 1.4 * breath + shift,
    armRb: 2.6 * breath
  };
}

/** What one frame of a flip is: the two channels `emit()` already has, plus
    the name of the stance the tuck breaks into. */
export interface FlipFrame {
  /** Degrees about the hip. Negative, which is what makes it a *back* flip. */
  spin: number;
  /** Nought to one to nought. Only shortens and fades the contact shadow here
      — the actual lift is the caller's, because the caller is the only one who
      knows what the character is standing on. */
  rise: number;
  /** A name rather than a pose, so a browser can hand it to its own tween and
      a frame sheet can hand it to `stance()`. */
  pose: string;
}

/** One frame of the **backflip**, as a pure curve of its own progress.

    **The sign is the whole of the word.** `emit()` turns about the hip in
    screen order, so a positive angle throws the head over the *front* of a
    figure facing `+1` and a negative one throws it over the back. Measured
    rather than reasoned about: the eye sits 6.1 units in front of the hip at
    rest and 15.9 in front a fifth of a turn later at `+360`, and behind it by
    the same amount at `−360`. The owner's note said backflip and this is the
    sign that word is.

    `pose` breaks at four fifths so the legs are already opening for the floor
    before he is the right way up, which is the difference between landing and
    being put down. */
export function flip(u: number): FlipFrame {
  const t = clamp(u, 0, 1);
  return {
    spin: -360 * t,
    rise: t < 0.5 ? 1 - (1 - 2 * t) ** 2 : 1 - (2 * t - 1) ** 2,
    pose: t < 0.8 ? "tuck" : "crouch"
  };
}

/* --- the costume --------------------------------------------------------- */

/** Painting order, which is a contract the drawing states and the whole reason
    a flat figure has a near side and a far side: the hem covers the top of its
    leg, the jacket covers the far arm, the head covers the roots of the
    ribbons, and the near arm goes over all of it. One class per path, in order,
    so nothing counts to nineteen. */
export const PARTS: readonly string[] = [
  "f-cast",
  "f-rib",
  "f-rib",
  "f-far",
  "f-far",
  "f-far f-boot",
  "f-hem f-hem-far",
  "f-limb",
  "f-boot",
  "f-hem",
  "f-coat",
  "f-wash",
  "f-lapel",
  "f-belt",
  "f-head",
  "f-wash",
  "f-band",
  "f-eye",
  "f-limb"
];

const seg = (from: Pt, deg: number, len: number): Pt => ({
  x: from.x + Math.sin(deg * RAD) * len,
  y: from.y + Math.cos(deg * RAD) * len
});
const between = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});
const towards = (a: Pt, b: Pt): Pt => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
};

/** **Put him on the floor.** The rig has no inverse kinematics and should not
    have any: it places joints from angles, which is what makes a limb keep its
    length. But it also means the hip height is whatever the pose says it is, so
    the two are reconciled here — solve the pose, find whichever of the four
    foot points reaches deepest, and move the root so that point is exactly on
    the ground. The floor sets the hip height, poses become pure angles, and a
    stance authored in five minutes plants itself. */
function plant(pose: Pose): Pose {
  const j = solve(pose, DIMS, ANCHOR, GROUND);
  const deep = Math.max(j.ankleL.y, j.ankleR.y, j.toeL.y, j.toeR.y);
  return deep === GROUND ? pose : { ...pose, y: pose.y + (GROUND - deep) };
}

/** The follow-through memory: three lagged chains at three rates — two ribbons
    and the hem — which is the whole of why they do not read as one rigid shape
    flapping. Handed in and mutated rather than closed over, so `emit` stays a
    function of its arguments and a harness can draw a hundred frames without a
    hundred figures. */
export interface Memo {
  ribA: number;
  ribB: number;
  swing: number;
  tick: number;
}
export const restMemo = (): Memo => ({ ribA: -52, ribB: -64, swing: 0, tick: 0 });

export interface EmitOptions {
  face?: number;
  spin?: number;
  rise?: number;
  dx?: number;
  memo?: Memo;
  plant?: boolean;
}

/** **One frame: a pose in, nineteen path strings out.**

    Pure, apart from the memo it advances. That is what lets the same code draw
    a sequence at sixty frames a second in a browser and draw a contact sheet in
    Node with no window anywhere near it.

    `dx` is travel since the previous frame in *viewBox units per frame* — it
    drives the ribbons and the hem's sideways lag, so it wants to be
    proportional rather than exact. `spin` is the wheel, in degrees, applied as
    a rotation about the hip; `rise` only shortens the contact shadow. */
export function emit(pose: Pose, options: EmitOptions = {}): string[] {
  const face = options.face ?? 1;
  const spin = options.spin ?? 0;
  const rise = options.rise ?? 0;
  const dx = options.dx ?? 0;
  const memo = options.memo ?? restMemo();

  /* Grounded unless somebody says otherwise, and the wheel says otherwise on
     its own: a figure mid-rotation has no lowest foot worth standing on. */
  const j = solve(options.plant === false || spin ? pose : plant(pose), DIMS, ANCHOR, GROUND);

  /* The head's frame, for the skull, the band, the eye and the ribbons. */
  const a = (pose.lean + pose.head) * RAD;
  const up = { x: Math.sin(a), y: -Math.cos(a) };
  const side = { x: Math.cos(a), y: Math.sin(a) };
  const local = (p: readonly [number, number]): Pt => ({
    x: j.head.x + side.x * p[0] + up.x * p[1],
    y: j.head.y + side.y * p[0] + up.y * p[1]
  });

  /* Three chases at three rates: the ribbons streamed back by his own velocity
     in his own frame plus a slow ambient sway, and the hem lagging sideways
     behind the hips. A different `k` per chain is what stops them reading as
     one flag. */
  memo.tick += 1;
  const sway = 6 * Math.sin(memo.tick / 14);
  const stream = clamp(-52 - dx * face * 48, -104, 34);
  memo.ribA = follow(memo.ribA, stream + sway * 0.4, 0.17);
  memo.ribB = follow(memo.ribB, stream - 12 + sway, 0.12);
  memo.swing = follow(memo.swing, clamp(-dx * face * 20, -3.4, 3.4), 0.15);

  const knot = local(KNOT);
  const a1 = seg(knot, memo.ribA, 5.6);
  const a2 = seg(a1, memo.ribA + sway * 0.5, 4.4);
  const b1 = seg(knot, memo.ribB, 4.6);
  const b2 = seg(b1, memo.ribB + sway, 3.6);

  /* The hem, as two panels: each hangs from its own hip and is carried by its
     own thigh — 58% of the fall is gravity and 42% follows the leg, which is
     roughly what cloth does and is exactly what makes the two panels separate
     the moment the legs do. */
  const waist = between(j.hipL, j.hipR, 0.5);
  const panel = (hip: Pt, thigh: Pt): Pt[] => {
    const t = towards(hip, thigh);
    const fx = 0.42 * t.x;
    const fy = 0.58 + 0.42 * t.y;
    const len = Math.hypot(fx, fy) || 1;
    const dir = { x: fx / len, y: fy / len };
    const out = Math.sign(hip.x - waist.x) || 1;
    return [
      hip,
      {
        x: hip.x + dir.x * HEM + out * FLARE + memo.swing,
        y: hip.y + dir.y * HEM
      },
      {
        x: waist.x + dir.x * HEM * SPLIT + memo.swing * 0.6,
        y: waist.y + dir.y * HEM * SPLIT
      },
      waist
    ];
  };

  /* Boots: a shaft and a foot in one mark, drawn heavier than the leg it hangs
     off. A foot that is the last segment of the leg, at the leg's own weight,
     is a line with a kink in it rather than a shoe. */
  const boot = (ankle: Pt, knee: Pt, toe: Pt): Pt[] => [between(ankle, knee, 0.24), ankle, toe];

  /* The jacket's opening, and the wash on its far half. The wash is the whole
     of "painted rather than drawn": one light polygon over the far 42% of the
     torso, no stroke on it, and the figure stops being a wireframe. */
  const chest = between(j.neck, j.hip, 0.44);
  const lapL = between(j.shoulderL, j.neck, 0.34);
  const lapR = between(j.shoulderR, j.neck, 0.34);
  const wash = [
    j.shoulderL,
    between(j.shoulderL, j.shoulderR, 0.42),
    between(j.hipL, j.hipR, 0.42),
    j.hipL
  ];

  /* Where he meets the floor. It shortens as he leaves it and it does not
     rotate with the wheel, because a shadow is cast by a figure rather than
     worn by one. */
  const feet = [j.toeL.x, j.toeR.x, j.ankleL.x, j.ankleR.x];
  const lo = Math.min(...feet) - 1.4;
  const hi = Math.max(...feet) + 1.4;
  const mid = (lo + hi) / 2;
  const half = ((hi - lo) / 2) * (1 - 0.72 * rise);
  const shadow = [
    { x: mid - half, y: GROUND + 1.4 },
    { x: mid + half, y: GROUND + 1.4 }
  ];

  /* **Two reflections and a rotation, all at emission.** Facing turns the
     mathematics around rather than the element, so no transform fights an
     entrance tween's scale and nothing directional leaks into CSS that has to
     mirror. The mirror is about the anchor and not about the middle of the box:
     they were the same number until the box grew asymmetrically to hold his
     reach, and reflecting about the box teleports him six units sideways every
     time he turns round. */
  const c = Math.cos(spin * RAD);
  const s = Math.sin(spin * RAD);
  const turn = spin
    ? (p: Pt): Pt => ({
        x: j.hip.x + (p.x - j.hip.x) * c - (p.y - j.hip.y) * s,
        y: j.hip.y + (p.x - j.hip.x) * s + (p.y - j.hip.y) * c
      })
    : (p: Pt): Pt => p;
  const mirror = face < 0 ? (p: Pt): Pt => ({ x: 2 * ANCHOR - p.x, y: p.y }) : (p: Pt): Pt => p;
  const put = (pts: readonly Pt[], close = false): string =>
    poly(pts.map((p) => mirror(turn(p))), close);

  return [
    poly(shadow.map(mirror)),
    put([knot, a1, a2]),
    put([knot, b1, b2]),
    put([j.shoulderL, j.elbowL, j.handL]),
    put([j.hipL, j.kneeL, j.ankleL]),
    put(boot(j.ankleL, j.kneeL, j.toeL)),
    put(panel(j.hipL, j.kneeL), true),
    put([j.hipR, j.kneeR, j.ankleR]),
    put(boot(j.ankleR, j.kneeR, j.toeR)),
    put(panel(j.hipR, j.kneeR), true),
    put([j.shoulderL, j.shoulderR, j.hipR, j.hipL], true),
    put(wash, true),
    put([lapL, chest, lapR]),
    put([j.hipL, j.hipR]),
    put(HEAD.map(local), true),
    put(HEAD_WASH.map(local), true),
    put(BAND.map(local)),
    put(EYE.map(local)),
    put([j.shoulderR, j.elbowR, j.handR])
  ];
}

/* --- the character, mounted ---------------------------------------------- */

/** What one frame is told. `dx` is travel since the last frame in the caller's
    units and `t` is a clock in milliseconds — the breath is read off the clock
    and never off a frame count, which is a bug that only shows up on somebody
    else's monitor. */
export interface DrawOptions extends EmitOptions {
  t?: number;
  idle?: IdleOptions;
}

/** What a bound character hands back. **This is the interface a custom `rig`
    implements** — `companion.ts` calls exactly these two methods and knows
    nothing else about what is being drawn. */
export interface Drawn {
  /** Reset everything a second pass of a loop must not inherit. */
  rest(): void;
  /** One frame. */
  draw(pose: Pose, options?: DrawOptions): void;
}

export interface FigureOptions {
  /** The travel distance, in whatever units the caller measures travel in,
      that one slide step covers at a walk. The one number that has to be told
      about the scale of the drawing the character is standing in. */
  stride?: number;
  reach?: number;
  /** The breath's period in milliseconds. */
  breath?: number;
}

/** Bind an `<svg>`'s paths and hand back something a loop can drive one frame
    at a time.

    The figure owns its own locomotion state — stride phase, the eased weight of
    the slide, the follow-through memory — because none of it belongs on a
    timeline: it is arithmetic a clock drives, and a tween engine that owned it
    would have to unwind it at the loop seam. */
export function createFigure(svg: SVGElement | null, options: FigureOptions = {}): Drawn {
  const paths = svg ? [...svg.querySelectorAll(":scope > path")] : [];
  const stride = options.stride ?? 5;
  const reach = options.reach ?? 15;

  const memo = restMemo();
  let phase = 0;
  let weight = 0;

  const BREATH = options.breath ?? 3400;

  return {
    /** The stride phase is deliberately *not* reset: it is periodic, and
        continuity across the seam is what keeps the legs from stuttering
        there. */
    rest() {
      weight = 0;
      Object.assign(memo, restMemo());
    },

    draw(pose: Pose, opts: DrawOptions = {}) {
      if (!paths.length) return;
      const dx = opts.dx ?? 0;
      const speed = Math.abs(dx);

      /* Distance decides phase, so the legs turn exactly as fast as the ground
         goes by; speed lengthens the step, so hurrying reads as longer slides
         rather than as faster little ones. */
      phase += speed / (stride + speed * 3);
      weight = follow(weight, speed > 0.02 ? 1 : 0, 0.22);

      let posed =
        weight > 0.004
          ? overlay(
              pose,
              glide(phase, {
                reach: clamp(reach + speed * 7, reach, reach + 11),
                lean: clamp(speed * 7, 0, 7)
              }),
              weight
            )
          : pose;

      /* The breath is the complement of the slide's weight — it fades in
         exactly as the travel fades out, so the two never argue over the same
         knee — and it is off entirely while he is in the air, because a figure
         mid-cartwheel has nothing to shift its weight onto. */
      const settled = 1 - weight;
      if (opts.t != null && settled > 0.004 && !opts.spin && (opts.rise ?? 0) < 0.02) {
        posed = overlay(posed, idle(opts.t / BREATH, opts.idle), settled);
      }

      const ds = emit(posed, { ...opts, dx, memo });
      for (let i = 0; i < paths.length && i < ds.length; i++) {
        paths[i]?.setAttribute("d", ds[i] ?? "");
      }
      /* The one attribute rather than path data: the contact shadow fades out
         as he leaves the floor instead of shrinking to a dot on it. Set as an
         attribute and not a style, because the fleet ships no `'unsafe-inline'`
         and a presentation attribute is not covered by `style-src` anyway. */
      paths[0]?.setAttribute("opacity", String(clamp(1 - (opts.rise ?? 0) * 1.6, 0, 1)));
    }
  };
}
