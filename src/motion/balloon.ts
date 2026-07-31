/* A speech balloon, as arithmetic.
   ---------------------------------------------------------------------------
   The fleet's drawings narrate themselves, and until now they did it the way
   video does: a box under the picture that different voices take turns in. A
   subtitle tells you what was said and nothing about who said it — which is
   fine for a film with faces in it and useless for a drawing whose speaker is
   a stick figure with no mouth. Comics solved this a century ago: the words go
   in a balloon, and a tail points at whoever is talking. Attribution is
   *positional*, so it costs no words and cannot be misread.

   This module is the geometry of that balloon and nothing else. It draws no
   DOM, reads no stylesheet, and holds no state — a site measures its own card,
   asks for a path, and owns every decision about ink, paper, type and when the
   thing appears. The kit holds the mathematics because the mathematics is the
   part every site would otherwise re-derive slightly wrong (PLAN §3.2).

   **Why one path rather than a box plus a triangle.** A balloon is a single
   closed outline: the tail is part of the silhouette, not a decoration stuck
   to the bottom of it, and the moment the two are separate elements the stroke
   shows a seam where they meet and the paper fill shows a lighter wedge. One
   path strokes and fills as one shape, which is what a balloon is.

   **Straight lines only, and that is not this module's taste.** The shape is a
   chamfered octagon rather than a rounded rectangle because a mitre survives
   in a design language that has no curve in it, and a site that *does* have
   curves can pass a chamfer of nought and round the corners with CSS on the
   element behind. What cannot be done afterwards is the tail, which is why the
   tail is here.

   Units are whatever the caller measures in — pixels off a `getBoundingClientRect`,
   viewBox units, `cqi`. The output is a `d` string in that same space. */

/** The pointer, and the whole of the attribution.
    ---------------------------------------------------------------------------
    Rooted on the balloon's block-end edge and reaching toward the speaker. The
    root travels along that edge as the speaker moves, and only when the root
    runs out of edge does the tip start to lean — which is what a comic artist
    does by hand, and the reason a balloon two feet from its speaker still
    reads as theirs. */
export interface Tail {
  /** Where the tail is rooted along the balloon's block-end edge: 0 at the
      inline-start corner, 1 at the inline-end one. Clamped so the root always
      lands on the flat part of the edge rather than on a chamfer. */
  base: number;
  /** How far the tip leans from the root along the inline axis, measured in
      balloon widths. Negative leans back toward the start edge. */
  lean: number;
  /** How far the tip drops past the edge, in the caller's own units. */
  drop: number;
  /** The tail's width where it meets the balloon. */
  root: number;
}

export interface BalloonOptions {
  /** How much is cut off each corner. Nought is a plain rectangle. */
  chamfer?: number;
  /** How far inside the box the outline sits. A stroke is centred on its
      path, so a path on the box edge loses half its width to the clip; half
      the stroke width is the honest value here. */
  inset?: number;
  /** Omit for a balloon with no tail — a caption box, which is the staging a
      narrator's voice wants and a speaker's voice must not have. */
  tail?: Partial<Tail>;
}

const clamp = (n: number, lo: number, hi: number): number =>
  n < lo ? lo : n > hi ? hi : n;

/* Two decimals, the same rule `poly` states in rig.ts: finer than any eye can
   see at any size these are drawn, and short enough that rebuilding the string
   every frame stays free. */
const n2 = (n: number): string => n.toFixed(2);

const DEFAULT_TAIL: Tail = { base: 0.5, lean: 0, drop: 12, root: 10 };

/** The outline of a balloon `w` by `h`, tail and all, as one closed path.

    Walked clockwise from the inline-start corner of the block-start edge — the
    direction matters only in that the tail is inserted while travelling *back*
    along the block-end edge, so its two roots come out end-first. A caller
    never sees that; it is written down because the one way to break this
    function is to add a vertex in the wrong half of the walk. */
export function balloon(w: number, h: number, options: BalloonOptions = {}): string {
  const inset = options.inset ?? 0;
  /* A chamfer larger than half the shorter side eats the edges it is cutting
     and the octagon folds inside out. Bounded rather than asserted: this runs
     every frame a card is resized, and a balloon that quietly stops being
     pointy is a better failure than one that throws inside a resize
     observer. */
  const c = clamp(options.chamfer ?? 0, 0, Math.min(w, h) / 2 - inset);

  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;

  const parts: string[] = [
    `M${n2(x0 + c)} ${n2(y0)}`,
    `L${n2(x1 - c)} ${n2(y0)}`,
    `L${n2(x1)} ${n2(y0 + c)}`,
    `L${n2(x1)} ${n2(y1 - c)}`,
    `L${n2(x1 - c)} ${n2(y1)}`
  ];

  if (options.tail) {
    const tail: Tail = { ...DEFAULT_TAIL, ...options.tail };
    /* The flat span of the block-end edge, which is the only part of it a tail
       may be rooted on: root it on a chamfer and the balloon grows a notch
       instead of a point. */
    const from = x0 + c;
    const to = x1 - c;
    const span = Math.max(0, to - from);
    const root = clamp(tail.root, 0, span);
    const mid = clamp(from + clamp(tail.base, 0, 1) * span, from + root / 2, to - root / 2);

    parts.push(
      `L${n2(mid + root / 2)} ${n2(y1)}`,
      `L${n2(mid + tail.lean * w)} ${n2(y1 + tail.drop)}`,
      `L${n2(mid - root / 2)} ${n2(y1)}`
    );
  }

  parts.push(
    `L${n2(x0 + c)} ${n2(y1)}`,
    `L${n2(x0)} ${n2(y1 - c)}`,
    `L${n2(x0)} ${n2(y0 + c)}`,
    "Z"
  );

  return parts.join(" ");
}

export interface AimOptions {
  /** Where the speaker stands along the stage's inline axis. */
  speaker: number;
  /** The balloon's inline-start edge, on that same axis and in those same
      units. */
  start: number;
  /** The balloon's width, likewise. */
  width: number;
  /** How near the balloon's own corners the tail's root may get, as a
      fraction of the width. Keeps the tail on the flat of the edge and stops
      it reading as a corner that has come loose. */
  margin?: number;
  /** How far past its own root the tip may reach, in balloon widths. This is
      the difference between a tail that points and a tail that stretches: a
      third of a width is a lean, a whole width is a rubber band. */
  slack?: number;
}

/** Where to root a tail, and how far to lean it, so that it points at the
    speaker from wherever the balloon happens to be.
    ---------------------------------------------------------------------------
    **The root moves first and the tip only afterwards.** A tail whose root is
    pinned and whose tip swings reads as a windscreen wiper; a tail that slides
    along the balloon's edge to stay under its speaker, and only starts leaning
    once it has run out of edge, reads as the balloon belonging to him. That
    ordering is the whole of this function, and it is why the two numbers come
    back together rather than a site computing one and guessing the other.

    Everything is in one set of units — whatever the caller measures the stage
    in. A site whose figure is placed by a fraction between nought and one
    passes fractions; a site measuring pixels passes pixels. The function never
    learns which, and — because the caller's axis is its *inline* axis — never
    learns which way forward is either, so a mirrored document mirrors the
    balloon and the tail with it. */
export function aim(options: AimOptions): { base: number; lean: number } {
  const margin = clamp(options.margin ?? 0.14, 0, 0.5);
  const slack = Math.max(0, options.slack ?? 0.34);
  /* Where the speaker is, expressed in balloon widths from the balloon's own
     start edge. A width of nought would be a card that has not been laid out
     yet — an unmeasured element in the frame before its resize observer
     fires — and the honest answer there is "directly underneath". */
  const want = options.width > 0 ? (options.speaker - options.start) / options.width : 0.5;

  const base = clamp(want, margin, 1 - margin);
  const lean = clamp(want - base, -slack, slack);
  return { base, lean };
}
