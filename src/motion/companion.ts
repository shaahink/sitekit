/* A character who follows the reader, for any site in the fleet.
   ===========================================================================
   This is `sk-studio/src/scripts/sidekick.js` with the site taken out of it.
   That file was six hundred lines of behaviour and about thirty of document —
   which stage elements to find, which prose to say, which film to keep quiet
   for — and the whole of this module is that split made real. The behaviour is
   here and it is one copy for the whole fleet; the document stays in the site,
   because `data-mate-stage` is `sk-studio`'s structure and `home.yaml` is
   `sk-studio`'s prose.

   The design problem the original solved, and this one inherits whole: **a
   character who is always doing something is an animated GIF in the corner of
   a website**, and the internet settled that argument in about 1998. A
   character who does nothing is a sticker. The way out is that he answers the
   reader rather than the clock — nothing here is on a timeline. While the page
   is moving he is not; he waits off the page entirely and decides only once
   the scrolling settles, which reads as attention instead of as a pop-up. He
   does not draw the path between sections either: he crouches, jumps out of
   frame and drops into the next one, because there is nothing between two
   sections of a page for him to run along. The landing is the trick and the
   standing is the performance.

   **Four things are parameters and the fifth is the point of them:**

   - `rig` — the character. Defaults to the sk figure (`figure.ts`), which is
     what *"not the same character, but it can start with the same character"*
     asks for. Pass your own and none of the default is drawn.
   - `lines` — what he may say, with the stage each belongs to. Data, so it can
     be prose in whatever the adopting site edits its content in.
   - `placement` — `"roam"` down a document, or `"anchor"` around one element.
   - `pace` — the cadence numbers, every one of them overridable and every one
     of them argued for at `PACE` below.

   **Everything he is is inside a shadow root, and that is not decoration.**
   The host page's own CSS cannot select into him and his rules cannot select
   out, which is the whole of *"not breaking other site functionality"* on
   somebody else's site. `pointer-events: none` on the host is the other half:
   he stands on the top edge of sections full of links and a decoration that
   can eat a click is the difference between a character and a defect.

   **And the shadow root is styled through the CSSOM rather than by a `<style>`
   element, which is a CSP fact and was measured rather than assumed.** A
   deployed fleet site serves
   `style-src 'self' 'sha256-…' 'sha256-…'` — no `'unsafe-inline'`, only
   build-time hashes of that site's own inline styles — as a
   `<meta http-equiv>` rather than as a header, which is why a header check
   reports no policy at all and is wrong. A `<style>` element created at
   runtime has a hash on nobody's list and is **blocked**, and the failure is a
   character with no styling rather than an error anybody notices. A
   constructed `CSSStyleSheet` handed to `adoptedStyleSheets` is scripted style
   and is not a style element, so `style-src` does not gate it; per-frame
   custom properties go through `element.style.setProperty`, which is what
   `setVar()` in `boot.ts` already relies on for the same reason.

   **Colour is `currentColor` and nothing else.** The version of this that ran
   on one site read `--ink`, `--paper`, `--wash` and `--ink-faint` with
   `cssToken()`, and those are that site's names. A client site need not have
   them, and a kit that learns a token name has learned a palette. Strokes
   inherit the host's own text colour instead, so he is correct on a dark site
   and a light one without the package ever knowing either — and it satisfies
   the fleet's no-hex rule by construction rather than by discipline. Each ink
   is still a custom property with `currentColor` as its *fallback*
   (`--sk-mate-ink` and friends), so a site that does have a palette can hand
   him one from outside the shadow root: custom properties inherit through the
   boundary and an outer-tree declaration wins over `:host`. */

import { mountMotion } from "./boot.js";
import { follow } from "./rig.js";
import type { Pose } from "./rig.js";
import { createFigure, stance, flip, DIMS, GROUND, VBH, VBX, VBW, PARTS } from "./figure.js";
import type { Drawn, DrawOptions, FlipFrame } from "./figure.js";

/* --- what a character is ------------------------------------------------- */

/** **The whole of what this module knows about what it is drawing.** A rig is
    a viewBox, a list of marks, a stance vocabulary, three fractions and a way
    to bind an `<svg>`. Nothing here is specific to a martial artist, which is
    the test of whether the character is genuinely a parameter. */
export interface CompanionRig {
  /** The four viewBox numbers. */
  viewBox: readonly [number, number, number, number];
  /** One class per `<path>`, in painting order. Its length is how many paths
      the shadow root gets, so a rig with six marks draws six. */
  parts: readonly string[];
  /** Where the feet are, as a fraction of the box's own height. It is what
      puts him *on* an edge rather than near one, and reading it off the rig
      rather than writing it down is why re-cropping a drawing cannot sink
      him. */
  ground: number;
  /** Where the face is, as a fraction of the box's height. The sentence stands
      beside it. */
  face: number;
  /** What one step is worth, in percent of his own height. Measured in his own
      height rather than in pixels so the number survives him being drawn at
      any size on any screen. Get it wrong and the boots skate. */
  stride: number;
  /** The costume: the rules for this rig's own marks, scoped by the shadow
      root. Every colour in it must be `currentColor` or a custom property that
      falls back to one — see this file's header. */
  css: string;
  /** A complete pose by name. `"stand"`, `"crouch"` and `"tuck"` are the three
      the state machine asks for; a rig that does not have them gets whatever
      its own fallback is. */
  stance(name: string): Pose;
  /** The move, as a pure curve of its own progress. **Optional, and its
      absence is how a character declines to show off** — no flip, no
      scheduling, no cost. */
  flip?: ((u: number) => FlipFrame) | undefined;
  /** Bind the paths and hand back a per-frame drawer. */
  create(svg: SVGElement, options: { stride: number }): Drawn;
}

/** The sk figure, as a rig. **This is the default value of `rig` and the only
    character the kit ships**; everything about it lives in `figure.ts`.

    `face` is arithmetic on the rig's own segment lengths rather than a fraction
    typed in: the skeleton is a chain from the ground up — two leg segments, the
    torso, the neck — and the far end of it is the joint the head is drawn
    about. It comes out at 30.4 of 72 against a head polygon spanning 27.3 to
    32.9, which is the middle of his face. Re-proportion him and the sentence
    follows. */
export const skFigure: CompanionRig = {
  viewBox: [VBX, 0, VBW, VBH],
  parts: PARTS,
  ground: GROUND / VBH,
  face: (GROUND - DIMS.shin - DIMS.thigh - DIMS.torso - DIMS.neck) / VBH,
  /** A stride, derived rather than picked. `createFigure` compares travel
      against `stride` in whatever units the caller measures travel in, and this
      module measures travel in percent of his own height — so the number is
      15.5 at the proportions the film uses, and 15 is that rounded to something
      a person can read. */
  stride: 15,
  stance,
  flip,
  create: (svg, options) => createFigure(svg, { stride: options.stride, reach: 15 }),
  /* 2px held by `vector-effect`, because the property does not inherit and
     because a non-scaling stroke is 2px at every size the drawing is rendered
     at — which is the property the rest of a responsive drawing has and stroke
     width otherwise cannot. Three weights on top of the flat rule, each doing a
     job: the belt is heavier because it is the one mark that says what kind of
     figure this is; the ribbons and the eye are lighter because at this size
     they would otherwise read as limbs; and the far arm and leg are a softer
     ink, which is the oldest trick there is for giving a flat figure a near
     side and a far side. */
  css: `
    path {
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .f-far { stroke: var(--sk-mate-faint, color-mix(in srgb, currentColor 55%, transparent)); }
    .f-belt { stroke-width: 3.4; }
    .f-rib,
    .f-eye { stroke-width: 1.5; }
    /* Nearly twice the leg's weight. One thick short stroke at the end of a
       thin long one is a boot, in any drawing, at any size; a foot drawn at the
       leg's own width is a kink in a line. */
    .f-boot { stroke-width: 3.6; }
    /* Where he meets the floor. Not a CSS shadow — a drawn one, re-lengthed
       every frame to the width of his stance and faded out as he leaves the
       ground. The single cheapest thing that stops a figure floating in front
       of a picture. */
    .f-cast {
      stroke: var(--sk-mate-thin, color-mix(in srgb, currentColor 32%, transparent));
      stroke-width: 2.6;
    }
    /* Paper fill on the closed paths, so limbs pass behind the body instead of
       through it and everything he stands in front of is properly covered. */
    .f-hem,
    .f-coat,
    .f-head { fill: var(--sk-mate-paper, Canvas); }
    /* The painting: three washes, filled and unstroked, one flat value. No
       gradient and no blur — what a flat figure lacks is a far side, not a
       lighting rig. The far panel keeps a faint outline because it is a garment
       with an edge. */
    .f-wash {
      fill: var(--sk-mate-wash, color-mix(in srgb, currentColor 10%, transparent));
      stroke: none;
    }
    .f-hem-far {
      fill: var(--sk-mate-wash, color-mix(in srgb, currentColor 10%, transparent));
      stroke: var(--sk-mate-faint, color-mix(in srgb, currentColor 55%, transparent));
    }
  `
};

/* --- what he says, and where he stands ----------------------------------- */

/** Where the offer goes, when an href is not the whole of the destination.

    **A credit in somebody else's footer is the case that needs the long form.**
    On the site that owns the offer it is `#contact` and staying in the tab is
    the entire point. On a client's footer the same mechanism has to open a new
    tab, for the reason `credits/index.ts` has been giving since 0.23.0: a
    visitor who taps a footer credit has not decided to leave, and navigating
    them off the client's site to satisfy a curiosity is a cost the client pays
    for somebody else's benefit.

    The string form is the common one and means exactly what it always meant. */
export interface CompanionAsk {
  href: string;
  /** `"_blank"`, or absent to leave the anchor's target alone. */
  target?: string | null | undefined;
  /** The destination's relationship — `"author noopener"` for a studio credit.
      **`noreferrer` is not in that list and adding it is not an improvement**:
      the referrer is how the far end of an acquisition link learns which site
      sent somebody, and its absence is deliberate in the emitter this
      mirrors. */
  rel?: string | null | undefined;
}

export interface CompanionLine {
  /** Which stage this belongs to, or `"landing"` — the pool of asides any
      landing can draw from. */
  at: string;
  text: string;
  /** **The one line that is not a joke.** A destination makes this line the
      offer: it is announced, it is clickable, and it happens once. Every other
      line is `aria-hidden` decoration. Null or absent on all of them. */
  ask?: string | CompanionAsk | null | undefined;
}

/** A line after the offer has been read into one shape. The public form takes a
    bare href because that is what nine lines in ten want; everything below this
    point deals with one type and never with the two. */
type Line = { at: string; text: string; ask: CompanionAsk | null };

function readAsk(ask: CompanionLine["ask"]): CompanionAsk | null {
  if (!ask) return null;
  return typeof ask === "string" ? { href: ask } : ask.href ? ask : null;
}

/** Down a document, standing on the top edges of whatever the selector finds.
    **The selector is the parameter and the attribute's name is not.** This
    module does not know that one site calls its sections `data-mate-stage`;
    a section that stops matching is a section he stops visiting, which is the
    same contract in the kit that it was in the site. */
export interface RoamPlacement {
  mode: "roam";
  /** What counts as a stage. Document order decides which stages are "after"
      which, because `querySelectorAll` returns it. */
  stages: string;
  /** Something he should keep his mouth shut for while it is on the screen —
      a film, a hero, an intro. Absent means there is nothing to be quiet for
      and he behaves as though it had already finished. */
  quiet?: string | null | undefined;
}

/** Around one element: a credit, a signature, a byline. He stands on its top
    edge, is sized against **its** font size rather than the viewport, and does
    not give up his footing when the reader scrolls — the element he is standing
    on is the whole of where he lives. The host's own containing block is what
    he paces along, so a site places him by placing his mount. */
export interface AnchorPlacement {
  mode: "anchor";
  /** Optional; only used to answer *is there anything to stand on*. The host
      itself is the fallback and is usually the right answer. */
  target?: string | Element | null | undefined;
}

export type CompanionPlacement = RoamPlacement | AnchorPlacement;

/* --- the numbers, in one place ------------------------------------------- */

/** **Every cadence number, and each one is somebody's argument rather than a
    taste.** They are one object so a site can override the two it disagrees
    with and inherit the rest.

    The two that matter most are `sayGap` and `sayCap`: they are the whole of
    *not irritating* and they are deliberately severe. A line every forty
    seconds at the very most, eight in a visit, and then quiet for good — which
    means the shortest visit that could hear all eight is nearly five minutes
    long. A pool and a cap are different quantities: the pool is how much
    variety exists and the cap is how much of it any one reader gets, so a
    bigger pool raises the cap not at all.

    `askAfter` and `askHold` are the offer's, and everything about it is late on
    purpose: an offer made in the first ten seconds is an interstitial and the
    thing that separates the two is not the wording. Two other lines first,
    because a reader who has heard two of his asides has met him. `askHold` is
    twice the ordinary hold because every other line is a joke that is over when
    you have read it and this one asks for a decision. */
export interface CompanionPace {
  /** How still the page has to be, in ms, before he decides anything. About
      the length of the pause between flicking and reading — short enough that
      he is already there when the reader's eyes settle, long enough that a
      flick through four sections is one decision rather than four. */
  settle: number;
  /** Below this many pixels a frame the page counts as still. Not zero,
      because trackpads and phones coast for a long time at one or two pixels
      and a character who waits for a true stop never arrives at all. */
  creep: number;
  /** How far the page must travel, as a fraction of a viewport, before he
      gives up his footing. A reader nudging a paragraph into view has not gone
      anywhere; a character who ejects himself on a forty-pixel adjustment
      spends the whole page jumping in and out. */
  bolt: number;
  /** The band he paces inside, as fractions of the inline axis. Kept well
      inside both edges because the band is where his *anchor* goes and he is
      drawn either side of it. */
  walkMin: number;
  walkMax: number;
  /** Where a stage's top edge has to be before he will stand on it, as
      fractions of the viewport, and where he would rather it were. The band is
      almost the whole screen on purpose: a scroll position with no edge inside
      it is a reader looking at a page he is absent from. `footEye` is the
      tie-break — with two edges in the band he takes whichever is nearer the
      upper third, which is where a reader's eye is. */
  footMin: number;
  footMax: number;
  footEye: number;
  sayGap: number;
  sayCap: number;
  sayHold: number;
  askAfter: number;
  askHold: number;
  /** The gutter the sentence is clamped inside and the daylight between his
      box and it, both in px of the inline axis. The gutter is non-zero because
      the halo blurs seven pixels out from the words. The daylight is measured
      off his *box* rather than his silhouette, so it clears the drawing at
      every pose he has including the one with an arm out. */
  sayEdge: number;
  sayBeside: number;
  /** How likely a landing is to be commented on. Most landings are silent —
      a knee joke that fires every time he lands is a knee joke that is over the
      second time you scroll past. */
  aside: number;
  /** **How likely a landing is to be shown off on, and the floor under it.**
      The odds alone are not enough and that is the part a single number hides:
      a reader can put four landings inside a minute, and at these odds two of
      them back to back is a one-in-twenty event — which over a page's worth of
      scrolling is not rare, it is due. So the gap is the floor and the odds
      only decide what happens above it. */
  flipOdds: number;
  flipGap: number;
  /** The move's length in ms, and how far off his own standing line it carries
      him as a fraction of his own height. A lift written in pixels is generous
      on a phone and a hop on a desktop. */
  flipMs: number;
  flipLift: number;
  /** How much of a pace he takes while the thing he is a footnote to is still
      on the screen. A third of one, which is a person shifting their weight
      rather than a person walking: nought would be a statue and one would be
      the rule not being followed. */
  quietPace: number;
}

export const PACE: CompanionPace = {
  settle: 380,
  creep: 1.4,
  bolt: 0.34,
  walkMin: 0.14,
  walkMax: 0.8,
  footMin: 0.06,
  footMax: 0.9,
  footEye: 0.42,
  sayGap: 40000,
  sayCap: 8,
  sayHold: 3400,
  askAfter: 2,
  askHold: 7000,
  sayEdge: 10,
  sayBeside: 8,
  aside: 0.28,
  flipOdds: 0.22,
  flipGap: 20000,
  flipMs: 900,
  flipLift: 0.55,
  quietPace: 0.34
};

/** **Anchored is a different job and the cadence says so.** He is not a
    character on somebody's footer, he is a signature that moved: one line, on
    an interval far longer than a page's own, and then quiet. The landing aside
    is off entirely — a joke about knees in a client's footer is a joke in
    somebody else's voice. */
export const ANCHOR_PACE: Partial<CompanionPace> = {
  sayCap: 1,
  sayGap: 120000,
  aside: 0,
  askAfter: 0,
  flipGap: 60000,
  /* **A third and two thirds, and the number is a bound rather than a taste.**
     Anchored, his containing block is a yard the site reserved for him beside
     whatever he is a footnote to, and the whole point of the yard is that he
     never paces back over it. He is placed by his *centre* and drawn either
     side of it, so his box stays inside a yard of `k` of his own widths only
     while the band starts no earlier than `1 / 2k`. `Credit.astro` reserves
     1.5, which makes the earliest honest walkMin exactly a third — and the
     roaming default of 0.14 would have put a third of him back on the words at
     the near end of every pace.

     Both halves of that arithmetic are commented in both files on purpose: they
     are two numbers in two repositories' worth of distance from each other that
     are only correct together. */
  walkMin: 1 / 3,
  walkMax: 2 / 3
};

export interface CompanionOptions {
  rig?: CompanionRig | undefined;
  lines?: readonly CompanionLine[] | undefined;
  placement?: CompanionPlacement | undefined;
  pace?: Partial<CompanionPace> | undefined;
  /** Extra rules for the shadow root, last in the sheet. For a site that wants
      to size or colour him without reaching in from outside. */
  css?: string | undefined;
}

/* --- the sheet ----------------------------------------------------------- */

/** **Larger than any document, which is this mount declining to be watched.**
    `mountMotion`'s fourth rule is that a sequence off screen is a sequence
    paused, and it enforces it by observing the box it was mounted on. For every
    other sequence that is exactly right, because their boxes stay where the
    server rendered them: *is the box on screen* and *is anybody watching this*
    are the same question.

    They are not the same question for a roaming companion, and the difference
    is a deadlock. This box has no home: it is parked at document coordinate
    zero until he first lands and it moves the length of the page after that, so
    it is off screen precisely when he is between sections, which is precisely
    when the loop has to be running to work out where he goes next. He could not
    arrive because he was not visible and he was not visible because he had not
    arrived — measured at 36 frames in 600 ms with the page at the top and 0
    with the page anywhere else.

    So the observer is given a margin no document will ever exceed. The concern
    it was raising is real and is answered in the one place that can answer it
    honestly: **the frame skips the drawing entirely while he is not on a
    stage.** The observer was asking whether the box is on screen; the loop
    knows whether there is anything in it.

    An *anchored* companion has none of this. His box is the credit's box, which
    is exactly where he lives, so the default margin is the right question and
    he gets it. */
const NEVER_OFFSCREEN = "100000px";

/** The host's own box, and where the sentence goes.

    Three custom properties and nothing else, and every one of them is spent by
    the sheet on a *logical* inset. `--sk-mate-x` is a fraction of the inline
    axis, so his pacing mirrors for a right-to-left locale and this module never
    learns which way forward is; `--sk-mate-top` is a length in document
    coordinates, because a roaming host is positioned against the page rather
    than any section — which is what lets him scroll with the thing he is
    standing on without a single scroll handler touching a style; `--sk-mate-on`
    is the fade, driven per frame rather than by a class because he arrives and
    leaves continuously.

    The sentence is centred on his anchor by two equal inline insets and
    `margin-inline: auto`, which centres a definite width in its containing
    block in *both* directions where a `translateX(-50%)` centres it in one and
    offsets it by half a sentence in the other. The insets are half a sentence
    wide because auto margins only split the leftover when there is leftover to
    split: at nought the space to share is his own box, he is 68 px wide and a
    sentence is closer to 170, so the margins resolve negative, the
    over-constrained rule drops one of them, and the sentence left-aligns to his
    box and hangs 49 px out to one side — which is exactly (166 − 68) / 2 and
    was measured rather than guessed.

    **`--say-face`, `--say-h` and `--say-over` are absent whenever the sentence
    is over him instead**, which the loop decides per frame and which a narrow
    screen forces. With nothing written the declaration is `calc(100% + 0.4rem)`
    — the rule this had before it could stand beside him, unchanged and still
    here. A fallback that is the absence of an override cannot drift from the
    thing it falls back to, and the same absence covers the script not having
    run at all. */
const SHEET = (mode: "roam" | "anchor"): string => `
  :host {
    --sk-mate-h: ${
      mode === "anchor"
        ? /* Against the credit's own font size and never the viewport: this is
             somebody else's footer and he is a guest in it, so he is
             proportional to the line he is standing beside rather than to the
             screen it happens to be on. */
          "3.4em"
        : "clamp(3.2rem, 6.4vw, 5.6rem)"
    };
    --sk-mate-say-max: ${mode === "anchor" ? "min(14rem, 60cqi, 46vw)" : "min(16rem, 46vw)"};
    position: absolute;
    display: block;
    z-index: 4;
    block-size: var(--sk-mate-h);
    inline-size: calc(var(--sk-mate-h) * var(--sk-mate-aspect));
    ${
      mode === "anchor"
        ? /* On the top edge of whatever the site made his containing block, so
             the credit is his floor. `--sk-mate-top` is his own lift off it
             rather than a document coordinate. */
          "inset-block-end: calc(100% - var(--sk-mate-top, 0px));"
        : "inset-block-start: var(--sk-mate-top, 0px);"
    }
    /* The fraction places his *centre*, which is the number the loop reasons
       about; the box is drawn either side of it, so half his width comes back
       off the inset.

       **The half-width is subtracted here rather than spent as a negative
       margin-inline-start, and that is an RTL fix rather than a tidy-up.**
       (No backticks anywhere in this block: the sheet is a template literal and
       one of them ends it, which cost a red suite to find out.)
       Measured on mosleh-clinic, which is the fleet's right-to-left site: with
       the correction in the margin he sat half his own width further toward the
       inline-end than the same code put him on an English page, and at the far
       end of his walk band he stood 20px outside the yard reserved for him. The
       inset mirrors; the negative margin did not mirror with it, so the two
       halves of one centring disagreed about which way forward was. One
       property cannot contradict itself. */
    inset-inline-start: calc(
      var(--sk-mate-x, 0.3) * 100% - var(--sk-mate-h) * var(--sk-mate-aspect) / 2
    );
    opacity: var(--sk-mate-on, 0);
    /* **Not a detail.** He stands on the top edge of sections that contain
       links, and a decorative figure that can eat a click is the difference
       between a character and a defect. */
    pointer-events: none;
    color: inherit;
  }

  svg {
    display: block;
    block-size: 100%;
    inline-size: 100%;
    fill: none;
    stroke: var(--sk-mate-ink, currentColor);
    stroke-linejoin: miter;
  }

  .say {
    position: absolute;
    inset-block-end: calc(100% + var(--say-over, 0.4rem) - var(--say-face, 0px) - var(--say-h, 0px) / 2);
    inset-inline-start: calc(var(--sk-mate-say-max) / -2 + var(--say-nudge, 0px));
    inset-inline-end: calc(var(--sk-mate-say-max) / -2 - var(--say-nudge, 0px));
    margin-inline: auto;
    inline-size: max-content;
    max-inline-size: var(--sk-mate-say-max);
    padding: 0.42rem 0.62rem;
    opacity: 0;
    transition: opacity 200ms ease;
  }
  .say.is-up { opacity: 1; }

  /* **The halo, which is what is left when the box goes.** This was a real
     balloon — a filled path with a 2px stroke, cut to the sentence every time
     it opened — and the owner's note on it was *no border, no nothing*. Taking
     that at its word leaves a sentence floating over whatever section he is
     standing on, and on a portfolio page that is regularly a photograph. So the
     box is replaced by something with no edge: three stacked shadows at nought
     offset are a halo rather than an outline — no side, no corner, nothing to
     catch the eye as a shape — and stacked because one pass of a blur at this
     radius is too faint to lift text off mid-grey.

     **The size comes off --sk-mate-h, because the two used to drift.** It was
     a constant while the character beside it scaled with the screen, so on a
     large display the sentence was a footnote standing next to a man. A fifth
     of his height ties them and the clamp stops that being a headline. */
  .text {
    position: relative;
    display: block;
    margin: 0;
    color: var(--sk-mate-ink, currentColor);
    font: inherit;
    font-size: clamp(0.72rem, var(--sk-mate-h) * 0.2, 1.05rem);
    line-height: 1.35;
    text-decoration: none;
    text-wrap: pretty;
    text-align: center;
    text-shadow:
      0 0 2px var(--sk-mate-paper, Canvas),
      0 0 4px var(--sk-mate-paper, Canvas),
      0 0 7px var(--sk-mate-paper, Canvas);
  }

  /* **The one sentence that can be clicked, and the selector is the whole of
     the safety.** pointer-events:auto on a descendant of a pointer-events:none
     ancestor makes exactly that descendant a hit target and nothing else, so
     what becomes clickable is the sentence's own box and never the figure or
     the gap beside him. The is-up class is in the selector and that is not
     decoration: --say-nudge survives the sentence coming down and the box keeps
     travelling with him, so between lines this element would otherwise sit
     invisibly across the top of a section full of links. Removing is-up ends
     every line and takes the hit target with it on the same frame rather than
     at the end of the fade.

     The pointer cursor is deliberately not written: every UA rule for it keys
     off :any-link, and an anchor is only that when it has an href — so the one
     attribute that makes this a link is also what makes it look like one, and
     neither can drift from the other. */
  .say.is-ask.is-up .text {
    pointer-events: auto;
    text-decoration: underline;
    /* Clear of the descenders, because the halo behind them is stacked blur and
       an underline sitting in it reads as a smudge rather than as a link. */
    text-underline-offset: 0.22em;
  }
`;

/* --- the mount ----------------------------------------------------------- */

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Mount a companion on `host`. Deferred, interruptible and reduced-motion
    respecting, because it goes through `mountMotion` — nothing below the idle
    callback costs the first paint anything, and a visitor who asked for less
    motion never runs a frame of it.

    Idempotence is the caller's concern: call once per element. */
export function mountCompanion(host: HTMLElement | null, options: CompanionOptions = {}): void {
  if (!host) return;
  mountMotion(
    host,
    async () => companionAt(host, options),
    options.placement?.mode === "roam" ? { rootMargin: NEVER_OFFSCREEN } : {}
  );
}

/** The same companion, for a caller that has **already** paid the deferral.

    `mountCompanion` is the whole answer for a site that imports this module
    directly: it is the mount and the waiting in one call. But an importer whose
    point is that this module is *not on the critical path* has to do the
    waiting first and the importing second —

    ```js
    import { mountMotion } from "@shaahink/sitekit/motion";
    mountMotion(host, async () => {
      const { companionAt } = await import("@shaahink/sitekit/companion");
      return companionAt(host, options);
    });
    ```

    — because a static import of this file is this file's bytes on the page's
    critical path whatever `mountMotion` does with them afterwards. That is
    `boot.ts`'s rule 1 read exactly: *`start` is not called, and therefore
    whatever it dynamically imports is not fetched*. Calling `mountCompanion`
    from inside that callback would work and would wait through a second idle
    callback and hand `mountMotion` a `void` where it wants controls, so the
    intersection observer that pauses him off screen would never be attached.

    Exported rather than left as the private `start` so the deferring caller
    gets the placement defaults, `ANCHOR_PACE` and the option merge instead of
    a second copy of them. Idempotence is still the caller's concern. */
export function companionAt(host: HTMLElement, options: CompanionOptions = {}) {
  const placement: CompanionPlacement = options.placement ?? { mode: "anchor" };
  const pace: CompanionPace = {
    ...PACE,
    ...(placement.mode === "anchor" ? ANCHOR_PACE : {}),
    ...(options.pace ?? {})
  };
  return start(host, placement, pace, options);
}

function start(
  host: HTMLElement,
  placement: CompanionPlacement,
  pace: CompanionPace,
  options: CompanionOptions
) {
  /* Shadow DOM or nothing. There is no light-DOM fallback and there must not
     be one: the whole of "not breaking other site functionality" is that the
     host page's rules cannot reach these nineteen marks, and a version that
     quietly draws into the page when the API is missing is a version that
     breaks a client's layout on exactly the browsers nobody tested. */
  if (!host.attachShadow || typeof CSSStyleSheet === "undefined") return null;

  const rig = options.rig ?? skFigure;
  const mode = placement.mode;
  const anchored = mode === "anchor";

  const stages: Element[] =
    placement.mode === "roam"
      ? [...document.querySelectorAll(placement.stages)]
      : [resolve(placement.target) ?? host];
  if (!stages.length) return null;

  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });

  /* **`replaceSync` on a constructed sheet, and never a `<style>` element.**
     See this file's header: the fleet's CSP is `style-src 'self'` with no
     `'unsafe-inline'`, measured on a deployed client page, and a runtime
     `<style>` is blocked there. */
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHEET(mode) + rig.css + (options.css ?? ""));
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];

  const [vx, vy, vw, vh] = rig.viewBox;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  svg.setAttribute("focusable", "false");
  /* Permanently, because the drawing is never anything but decoration.
     Everything he says is a joke about something the page has already said
     properly in its own words, and a decorative figure that interrupts a screen
     reader every time the reader stops scrolling is the single most irritating
     thing this module could ship. */
  svg.setAttribute("aria-hidden", "true");
  for (const part of rig.parts) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", part);
    /* Empty rather than a pose: the first frame rewrites all of them and the
       host is at nought opacity until it does, so a failed chunk leaves no
       figure rather than a figure standing in the margin doing nothing. */
    path.setAttribute("d", "");
    svg.appendChild(path);
  }
  root.appendChild(svg);

  /** **The sentence is an anchor that is usually not a link**, and that is the
      whole mechanism behind the offer. An `<a>` with no `href` is not a link:
      it is not focusable, it is not announced as one, and the browser gives it
      neither an underline nor a pointer cursor. So the difference between the
      decorative lines and the one call to action is exactly one attribute.

      `aria-live` is inert while `aria-hidden` is on the same element, which is
      what makes *announced once* achievable without a second live region: the
      loop lifts the hidden attribute and writes the words in that order, so the
      offer is spoken and none of the lines before or after it are. */
  const sayEl = document.createElement("div");
  sayEl.className = "say";
  sayEl.setAttribute("aria-hidden", "true");
  sayEl.setAttribute("aria-live", "polite");
  const sayText = document.createElement("a");
  sayText.className = "text";
  sayEl.appendChild(sayText);
  root.appendChild(sayEl);

  /* The one thing the sheet cannot work out for itself: a rig's own aspect. */
  host.style.setProperty("--sk-mate-aspect", String(vw / vh));

  const script: Line[] = (options.lines ?? [])
    .filter((l) => l && l.text)
    .map((l) => ({ at: l.at, text: l.text, ask: readAsk(l.ask) }));

  /** **One line, drawn at random from the ones he has not used, and not put
      back.** This was the *first* entry whose stage matched, which is exactly
      right for one line per section and quietly wrong for several: of thirteen
      section lines, eight would have been words nobody could ever hear.

      Without replacement, because the alternative is the failure a bigger pool
      was bought to fix. A reader who scrolls back past a section gets its other
      line rather than the one he already has, and when a section is out of
      lines he stands there in silence — which is what he does on most landings
      anyway and reads as a character who has said his piece. */
  const said = new Set<Line>();
  const draw = (at: string): Line | null => {
    const pool = script.filter((l) => l.at === at && !l.ask && !said.has(l));
    return pool.length ? pool[(Math.random() * pool.length) | 0] ?? null : null;
  };

  /** **The offer, and what "late" is measured against.** *Not before the reader
      has reached the pricing* is a fact about the order of one page's sections,
      and it is a fact this module must not be told. So the offer names a stage
      like every other line and what the mark buys it is that it fires on **that
      stage or any stage after it** — the ordering read off `stages`, which is
      document order. Move the sections around and the rule follows them; delete
      the one it names and it never fires, which is the same way a section that
      stops declaring itself deletes him from it.

      Only the first mark counts. Two of them is a mistake rather than a
      feature: the second is unreachable. */
  const order = new Map<string, number>();
  stages.forEach((el, i) => {
    const key = stageKey(el, placement);
    if (!order.has(key)) order.set(key, i);
  });
  const ask = script.find((l) => l.ask && order.has(l.at)) ?? null;
  const askFrom = ask ? order.get(ask.at) ?? Infinity : Infinity;
  let askDone = false;

  const askDue = (el: Element): boolean =>
    !!ask && !askDone && saidCount >= pace.askAfter && stages.indexOf(el) >= askFrom;

  const figure = rig.create(svg, { stride: rig.stride });

  /* --- while the thing he is a footnote to is still on the screen ---------- */

  /** **He is quiet until the reader has genuinely left it**, and this is the
      flag that says whether they have.

      A film in a hero is a minute long and the first stage is usually the
      section directly underneath it, so a reader who scrolls one notch to see
      what is below the drawing puts a stage edge in his band and he lands and
      starts performing *on top of the thing he is a footnote to*. Two loud
      characters in one viewport, and the quiet one is the film.

      **A condition and not a timer**, because there is no duration that is
      right for both readers: a timer is too long for the one who scrolls past
      in four seconds and too short for the one who watches it twice. The
      condition that means *left it* is that element's own box being off the
      screen, which an `IntersectionObserver` answers without a scroll handler,
      without a poll and without either script learning anything about the
      other.

      **It is a latch.** `disconnect()` on the first miss: leaving is a thing
      that happens once, and re-arming it would mean a reader scrolling back up
      — which puts the box back on screen while he is standing two sections down
      — silencing a character who is nowhere near it. */
  let freed = true;
  const quietFor =
    placement.mode === "roam" && placement.quiet ? document.querySelector(placement.quiet) : null;
  if (quietFor) {
    freed = false;
    const watch = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || entry.isIntersecting) return;
        freed = true;
        watch.disconnect();
      },
      { threshold: 0 }
    );
    /* The first callback is delivered on observe, so a reader who arrives on a
       deep link or a restored scroll position below it is free from the first
       frame rather than after the first scroll. */
    watch.observe(quietFor);
  }

  /* --- what he is doing ---------------------------------------------------- */

  /* The pose a tween engine would interpolate is interpolated here by hand, one
     `follow` per channel per frame. There is no timeline in this module and
     there must not be one: a tween engine owns a clock, this owns a clock, and
     two clocks in one frame is the seam that shows up six weeks later. */
  const pose = rig.stance("stand");
  let target = rig.stance("stand");

  let stage: Element | null = null; //  the section he is standing on
  let ledge = 0; //                     his standing line on it, in document coordinates
  let phase = "off"; //                 off | drop | land | flip | hold | leave
  let x = 0.3; //                       where he is along the axis, as a fraction
  let toX = 0.3;
  let prevPageX: number | null = null;
  let drop = 0; //                      how far above his standing line he is, in px
  let toDrop = 0;
  let vel = 0; //                       the fall's own speed, in px a frame
  let face = 1;
  let opacity = 0;
  let toOpacity = 0;
  let paceAt = 0; //                    when he is next allowed to think about pacing
  let holdFrom = 0;
  let flipFrom = 0; //                  when the wheel started
  let flipAt = -pace.flipGap; //        and when the last one did
  let flipPose = "";
  let spin = 0;
  let rise = 0;
  let saidAt = -pace.sayGap;
  let saidCount = 0;
  let sayUntil = 0;
  /** **One line per landing, not one per section.** What has to stay true is
      that he does not stand on a section talking; `said` above already stops
      him repeating himself, so this is only about a single stop. */
  let saidHere = false;

  const poseTo = (name: string): void => {
    target = rig.stance(name);
  };

  /* --- where a stage is ---------------------------------------------------- */

  /** The page-axis offset of a stage's top edge, in document coordinates.
      Measured per landing rather than cached: a page has rails that lay out on
      load, images that settle, and a reader who may have resized since he last
      stood anywhere. */
  const topOf = (el: Element): number => el.getBoundingClientRect().top + window.scrollY;

  /** **Where his feet go**, which is not where the element is. The rig puts its
      ground line partway down its box, so standing him *on* an edge means
      lifting the box by that fraction of its rendered height. */
  const standAt = (el: Element): number => topOf(el) - host.offsetHeight * rig.ground;

  /** **The footing, which is a question about the edge and not about the
      section.** He stands on a section's *top edge*, and on a banded page that
      edge is a real line — the boundary between two sections — which is the
      whole reason the landing reads as a landing rather than as a figure
      appearing in the middle of a paragraph.

      This used to return the section covering the middle of the viewport. That
      is the right way to ask *what is the reader reading* and the wrong way to
      ask *where can he stand*, and on a real page the two disagree by more than
      a screen: bands about 630 px tall against a viewport of 860 meant that for
      the bottom third of every one of them the edge he was standing on was two
      hundred pixels above the top of the screen. He landed, he stood, he
      breathed, and none of it was on the reader's monitor.

      **When none qualifies he has nowhere to stand and stays off the page
      entirely**, which is an answer and not a failure. */
  const stageInView = (): Element | null => {
    const h = window.innerHeight;
    /* **Anchored, the band is the wrong question and asking it strands him.**
       Roaming, the band exists because a page has many edges and only some of
       them are somewhere a reader can watch him land on. Anchored there is one
       edge and it is the whole of where he lives, so the only thing worth
       asking is whether it is on the screen at all — a credit sitting at the
       very top of the viewport is a credit he belongs on, and the band's lower
       bound would have said no. Off screen entirely is `mountMotion`'s job and
       it has the default margin here for exactly that reason. */
    if (anchored) {
      const el = stages[0];
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return box.top < h && box.bottom > 0 ? el : null;
    }
    let best: Element | null = null;
    let bestGap = Infinity;
    for (const el of stages) {
      const top = el.getBoundingClientRect().top;
      if (top < h * pace.footMin || top > h * pace.footMax) continue;
      const gap = Math.abs(top - h * pace.footEye);
      if (gap < bestGap) {
        bestGap = gap;
        best = el;
      }
    }
    return best;
  };

  /* --- what he says -------------------------------------------------------- */

  /** The sentence's box, measured once when the words go in. Held rather than
      re-read because the placement runs every frame the sentence is up and
      `offsetWidth` is a forced layout: the words do not change while it is up,
      so neither can its box. */
  let sayW = 0;
  let sayH = 0;

  /** **The sentence stands beside his face and is kept on the screen.**

      It used to sit centred directly over his head, which is where a balloon
      belongs in a comic strip drawn around it and is not where one belongs on a
      page it is a guest on — a sentence parked on top of somebody is what that
      looks like. So it moves to the side he is facing, at the height of his
      face, with the drawing left alone.

      **The side is a signed term and never a left or a right.** `face` is ±1 in
      the same coordinate the walk is measured in, so the offset is
      `face × (his half-box + a gap + half a sentence)` and it is added to the
      same nudge the clamp already spends. One number, one inset pair, and this
      module never learns which way forward is: in Arabic the sentence appears
      on the other physical side because the page mirrors, and nothing here
      changes.

      Centring it on him is also not always where it fits. He paces across most
      of the axis and a sentence can be 46% of a phone's width, so standing it
      out to one side is regularly a thing the viewport cannot hold. **The clamp
      wins**, and when the screen cannot hold it on his facing side it slides
      back across him rather than off the edge — by *deleting* the three
      properties below, so the fallback is the absence of an override and cannot
      drift from the thing it falls back to. */
  const placeSay = (): void => {
    if (sayW <= 0 || sayH <= 0) return;

    const page = document.documentElement.clientWidth;

    /* **Where he is, measured off his own box, rather than `x` × the viewport.**
       ---------------------------------------------------------------------
       `x` is a fraction of *his containing block*, and this line spent two
       releases treating it as a fraction of the document. Roaming those are the
       same number, because a roaming host is stretched across the page — which
       is exactly why the mistake survived being looked at. Anchored they are
       not related at all: his containing block is a yard a few em wide in
       somebody's footer, so `x` × the viewport put his supposed position in the
       middle of the screen, and every clamp below — which edge he is near, how
       much room the sentence has, whether the facing side survives — was solved
       for a speaker who was not there. The visible symptom is a footer sentence
       nudged a long way off the character it belongs to.

       A rect is the honest answer in both placements and it costs nothing that
       was not already being spent: `offsetWidth` on the line below was a forced
       layout every frame the sentence is up, and this replaces it rather than
       joining it.

       **A rect is physical and everything downstream is logical**, which is the
       one thing this module has to do by hand. `left` is the reader's left on
       both a French page and a Farsi one; `--say-nudge` is spent on
       `inset-inline-start`, and the clamp reasons about *near* and *far* edges
       rather than left and right ones. So the rect is converted once, here, and
       the direction is read rather than assumed — the module still never
       decides which way forward is, it only asks the page which way it already
       went. */
    const box = host.getBoundingClientRect();
    const half = box.width / 2;
    const speaker =
      getComputedStyle(host).direction === "rtl" ? page - box.right + half : box.left + half;

    /* Where the sheet puts it at a nudge of nought: centred on his anchor,
       which is the middle of his box. Everything below is measured off that,
       because the nudge is a correction to it and not a position. */
    const centred = speaker - sayW / 2;
    /* When the sentence is wider than the screen there is nothing to clamp it
       into; `max` keeps the range from inverting. */
    const near = pace.sayEdge;
    const far = Math.max(pace.sayEdge, page - sayW - pace.sayEdge);
    let startX = clamp(centred + face * (half + pace.sayBeside + sayW / 2), near, far);

    /* **Did the clamp eat the side?** The side is attempted and verified rather
       than assumed: if what survives the clamp still crosses his box, the whole
       arrangement reverts to the old one. */
    const clear = startX >= speaker + half || startX + sayW <= speaker - half;
    if (!clear) startX = clamp(centred, near, far);
    sayEl.style.setProperty("--say-nudge", `${startX - centred}px`);

    if (clear) {
      /* How far down his box the sentence is centred and how tall the sentence
         is: the two numbers that hang it beside him, both in pixels and both
         from here, because a percentage inset resolves against *his* box and
         can express neither. `--say-over` is the gap the old placement left
         above his head, switched off because there is no head underneath it any
         more.

         **Roaming, it is centred on his feet rather than on his face**, and
         that is the second half of the owner's note about the sentence being
         noisy. He stands on the *top edge of a section*, so the band level with
         his boots is the gutter between two of them — the one horizontal strip
         on a page that is whitespace on both sides of it, because the section
         above has bottom padding and the one below has top padding. His face is
         about three quarters of his own height up from that edge, which is
         three quarters of the way back into the previous section's content, and
         on a portfolio that content is regularly a photograph. Same sentence,
         same side, same clamp; a few em lower, into the seam.

         **Anchored it stays at his face**, because there is no seam under an
         anchored companion — his floor is the credit's own baseline and the
         thing level with his boots is the sentence *{sk} made this*. The one
         placement where the words are what he is standing on is the one
         placement where the sentence must not come down to them. */
      const height = box.height || host.offsetHeight;
      sayEl.style.setProperty("--say-face", `${(anchored ? rig.face : 1) * height}px`);
      sayEl.style.setProperty("--say-h", `${sayH}px`);
      sayEl.style.setProperty("--say-over", "0px");
    } else {
      sayEl.style.removeProperty("--say-face");
      sayEl.style.removeProperty("--say-h");
      sayEl.style.removeProperty("--say-over");
    }
  };

  /** **Returns whether he actually said it**, and the callers spend the line
      only on `true`. It used to return nothing and they used to mark the line
      spent before calling: a line that arrived inside the gap was swallowed
      here and struck off up there, so the reader lost a sentence to a clock and
      the pool lost it for the rest of the visit. */
  const say = (line: Line | null, now: number): boolean => {
    if (!line?.text) return false;
    /* The belt to the braces on every call site: while the film is up he has
       nothing to say, and a later caller that forgets to ask cannot make him
       talk over it. */
    if (!freed) return false;
    if (saidCount >= pace.sayCap || now - saidAt < pace.sayGap) return false;
    saidAt = now;
    saidCount += 1;

    /** **The offer's three attributes, and the order they go on in.** `askDone`
        is set here rather than at the call site for the reason this returns a
        boolean at all. The live region is the part with an order that matters:
        `aria-live` on an element carrying `aria-hidden` is inert, so the words
        are cleared first, the hidden attribute comes off second, and the
        sentence goes in third. Written the other way round the mutation happens
        to a region nobody is listening to and the offer is silent, and the
        previous line is briefly exposed on the way past. */
    if (line.ask) {
      askDone = true;
      sayText.textContent = "";
      sayEl.classList.add("is-ask");
      sayEl.removeAttribute("aria-hidden");
      sayText.setAttribute("href", line.ask.href);
      /* Written only when the destination asked for them, so the offer that
         does not leave the site is the same anchor it always was. */
      if (line.ask.target) sayText.setAttribute("target", line.ask.target);
      if (line.ask.rel) sayText.setAttribute("rel", line.ask.rel);
    }

    sayUntil = now + (line.ask ? pace.askHold : pace.sayHold);
    sayText.textContent = line.text;
    /* Measured after the words are in and before it is shown, so the box is cut
       to this sentence rather than to the one before it. */
    sayEl.classList.add("is-up");
    sayW = sayEl.offsetWidth;
    sayH = sayEl.offsetHeight;
    placeSay();
    return true;
  };

  /** **One place a sentence comes down**, because the offer has to be undone.
      For every ordinary line this is the class removal it always was. For the
      offer it is also the frame the page stops being clickable and stops being
      readable to a screen reader — the nudge survives the sentence coming down
      and the box goes on travelling with him, so an offer left armed is an
      invisible anchor lying across the top of a section full of links.

      **The blur is the least bad answer and not a good one.** A reader can
      scroll with the offer focused — space and the arrow keys do it — and he
      lets go of his footing when the page moves, which takes the offer with
      him. Focus left on an element that is now invisible, inert and hidden is
      worse than focus at the top of the document: the first is a keyboard trap
      with nothing in it, the second is a Tab away from being fixed. */
  const hush = (): void => {
    sayEl.classList.remove("is-up");
    sayUntil = 0;
    if (!sayEl.classList.contains("is-ask")) return;
    if (root.activeElement === sayText) sayText.blur();
    sayText.removeAttribute("href");
    /* All three, because they went on together. A `target` left on an anchor
       with no `href` is inert and invisible, and it is also the sort of residue
       that makes the next reader of this element wonder what it is for. */
    sayText.removeAttribute("target");
    sayText.removeAttribute("rel");
    sayEl.setAttribute("aria-hidden", "true");
    sayEl.classList.remove("is-ask");
  };

  /** Whether somebody is on the offer. Hover and focus are the same answer here
      — both mean *this reader is considering it*.

      **`root.activeElement` and not `document`'s**, which is the one line of
      this file that a shadow root changed rather than moved. With an open
      shadow root `document.activeElement` returns the *host*, so the original's
      check would have been false for every reader who ever tabbed to the offer
      and the hold would have expired under them. */
  const askHeld = (): boolean => {
    if (!sayEl.classList.contains("is-ask")) return false;
    if (root.activeElement === sayText) return true;
    try {
      return sayText.matches(":hover");
    } catch {
      return false;
    }
  };

  /* --- the decisions ------------------------------------------------------- */

  /** **Whether this landing is the one he shows off on.** Four conditions and
      only the last is a coin toss. `freed` is the quiet rule doing to a
      somersault exactly what it does to his voice — a wheel performed on top of
      a film is louder than anything he could have said over it. `sayUntil` is a
      sentence being up, and that one is geometry rather than manners: the
      sentence is placed at head height, and a head travelling through upside
      down is that number being asked a question it was not solved for.

      Read in that order on purpose — the two free booleans and the subtraction
      come before `Math.random()`, so a landing that was never eligible does not
      quietly spend a roll it could not have won. */
  const flipDue = (now: number): boolean =>
    !!rig.flip &&
    freed &&
    !sayUntil &&
    now - flipAt > pace.flipGap &&
    Math.random() < pace.flipOdds;

  /** Everything the wheel was writing, put back. Called wherever the flip can be
      cut short rather than run out — any arrival and any departure, because a
      reader who scrolls mid-turn must not find him fading out sideways or,
      worse, standing on the next section at 214°. */
  const unspin = (): void => {
    spin = 0;
    rise = 0;
    flipPose = "";
  };

  const arrive = (el: Element, now: number): void => {
    stage = el;
    /* **Measured once, here, and then held.** The standing line is a document
       coordinate, so once he has picked it the page scrolling under him moves
       him with it for free. Reading it per frame instead meant a
       `getBoundingClientRect()` inside the rAF for the entire time he was
       standing: a forced layout, sixty times a second, to re-answer a question
       whose answer had not changed. */
    ledge = anchored ? 0 : standAt(el);
    phase = "drop";
    /* He comes in from above the fold of the section rather than from a fixed
       height, so the fall is the same length whatever the section is. */
    drop = -Math.max(120, window.innerHeight * 0.34);
    toDrop = 0;
    vel = 0;
    /* Somewhere new each time, and never exactly the middle — a character who
       lands on the centre line of every section is a character who is being
       placed by a stylesheet. */
    x = clamp(0.24 + Math.random() * 0.42, pace.walkMin, pace.walkMax);
    toX = x;
    prevPageX = null;
    face = Math.random() < 0.5 ? -1 : 1;
    toOpacity = 1;
    saidHere = false;
    poseTo("tuck");
    unspin();
    figure.rest();
    paceAt = now + 2600 + Math.random() * 3000;
  };

  const leave = (): void => {
    phase = "leave";
    toDrop = -Math.max(160, window.innerHeight * 0.4);
    toOpacity = 0;
    poseTo("tuck");
    unspin();
    hush();
  };

  /* --- the page's own movement --------------------------------------------- */

  let lastY = window.scrollY;
  let stillFor = 0;
  let moving = false;
  /* How far the page has travelled since he last settled. **This is the number
     that decides whether he is patient**, and getting it wrong is the whole
     difference between a companion and a nuisance. */
  let travel = 0;

  /* --- one frame ----------------------------------------------------------- */

  let raf = 0;
  let last = 0;

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;

    /* Has the reader stopped? Read once a frame rather than on the scroll
       event: a scroll handler that does arithmetic is a scroll handler that
       shows up in a profile, and this needs the answer per frame anyway. */
    const y = window.scrollY;
    const moved = Math.abs(y - lastY);
    lastY = y;
    moving = moved > pace.creep;
    stillFor = moving ? 0 : stillFor + dt;
    if (moving) travel += moved;

    /* He lets go once the page has properly moved on — not on the first pixel.
       **An anchored companion never lets go at all**: the element he is standing
       on is the whole of where he lives, and a signature that jumps off a footer
       because the reader scrolled is a signature nobody sees twice. */
    if (
      !anchored &&
      travel > window.innerHeight * pace.bolt &&
      phase !== "off" &&
      phase !== "leave"
    ) {
      leave();
    }

    if (!moving && stillFor > pace.settle) {
      const want = stageInView();
      if (phase === "off") {
        if (want) {
          arrive(want, now);
          travel = 0;
        }
      } else if (phase !== "drop" && phase !== "leave") {
        /* Settled somewhere else, or settled off the stages entirely — either
           way the footing he has is the wrong one. */
        if (want !== stage && !anchored) leave();
        else travel = 0;
      }
    }

    /* --- the state machine ------------------------------------------------ */

    if (phase === "drop") {
      /* **A fall accelerates, and `follow` cannot do that.** Every other channel
         here eases *out* — fast then slow — which is right for a decision and
         wrong for gravity, where the last few pixels are the quickest. So the
         drop is the one thing carrying a velocity, and it is the reason the
         landing reads as weight rather than as an element arriving at its final
         value. */
      toDrop = 0;
      vel += 1.5 * (dt / 16);
      drop += vel * (dt / 16);
      if (drop >= -1) {
        drop = 0;
        vel = 0;
        phase = "land";
        holdFrom = now;
        poseTo("crouch");
        /* The landing aside, deliberately rare — and silent entirely while the
           film is up, which is the loudest of the three things a landing can
           do. */
        if (freed && Math.random() < pace.aside) {
          const aside = draw("landing");
          if (aside && say(aside, now)) said.add(aside);
        }
      }
    } else if (phase === "land") {
      /* Heavy out of the crouch and then quick to his feet, which is what
         something that has just absorbed a fall does. */
      if (now - holdFrom > 260) {
        /* **Out of the crouch is the only moment a flip can start**, and that is
           the whole of why this lives inside the absorb rather than beside it: a
           somersault is a thing you do *with* the energy of a landing, so the
           260 ms he already spends folded is the windup and nothing had to be
           written to give him one. */
        if (flipDue(now)) {
          phase = "flip";
          flipFrom = now;
          flipAt = now;
          poseTo("tuck");
          flipPose = "tuck";
        } else {
          poseTo("stand");
          phase = "hold";
          holdFrom = now;
        }
      }
    } else if (phase === "flip") {
      /* **The move, read off the rig's own curve rather than kept here.** The
         three numbers it returns go to the three places they belong: `spin` and
         `rise` straight through to the drawer, and the stance name to the same
         `poseTo` every other transition uses — so the tuck breaking into a
         crouch is tweened by the pose follow that is already running and not by
         a second easing written here. */
      const f = rig.flip?.((now - flipFrom) / pace.flipMs);
      if (f) {
        spin = f.spin;
        rise = f.rise;
        if (f.pose !== flipPose) {
          poseTo(f.pose);
          flipPose = f.pose;
        }
      }
      /* The lift is this module's half of `rise` — the rig only fades the shadow
         with it, and something has to actually move him. It is his own height
         rather than the section's, so he clears the same amount of himself at
         every width. */
      drop = -pace.flipLift * (host.offsetHeight || 0) * rise;
      if (now - flipFrom >= pace.flipMs) {
        unspin();
        drop = 0;
        /* **Back into the absorb, which he has already got.** A wheel that ends
           with him upright ends like a lift arriving; ending it in `land` spends
           the same crouch the fall does and costs nothing to write. It cannot
           roll a second flip out of that re-entry either, because `flipAt` was
           stamped at the top of this one. */
        poseTo("crouch");
        phase = "land";
        holdFrom = now;
      }
    } else if (phase === "hold") {
      if (now > paceAt) {
        /* A pace, and then a long wait. He crosses a fifth of the axis at most —
           pacing is a person shifting where they stand, not a patrol — and a
           third of that while the film is still on the screen. */
        const span = (0.1 + Math.random() * 0.12) * (freed ? 1 : pace.quietPace);
        toX = clamp(x + (Math.random() < 0.5 ? -span : span), pace.walkMin, pace.walkMax);
        paceAt = now + 5200 + Math.random() * 7000;
      }
      /* One of the stage's own lines, a beat after he has settled on it.
         **Nothing is marked used unless he was actually allowed to speak**, so a
         stage he stood on in silence keeps every one of its lines for a later
         visit rather than spending them on nobody. The condition being re-tested
         each frame rather than once is what lets the gap expiring under him
         still produce the sentence. */
      if (freed && stage && !saidHere && now - holdFrom > 1400) {
        /* **The offer takes the slot when it is due**, because he says one thing
           per stop and a joke is not worth losing the only sentence on the page
           that goes anywhere. When it is due but the gap is not up, `say()`
           refuses it and nothing is spent. */
        const line = askDue(stage) ? ask : draw(stageKey(stage, placement));
        if (line && say(line, now)) {
          said.add(line);
          saidHere = true;
        }
      }
    } else if (phase === "leave") {
      drop = follow(drop, toDrop, 0.14);
      if (opacity < 0.02) {
        phase = "off";
        stage = null;
        drop = 0;
        toDrop = 0;
      }
    }

    /* Three phases write `drop` themselves — the fall with a velocity, the wheel
       with an arc and the exit with a fade — so the settle must not also be
       chasing it. `follow` against a target of nought would flatten the flip's
       arc into about a third of its height, which is the sort of bug that looks
       like the lift being badly tuned rather than like two things writing one
       number. */
    if (phase !== "drop" && phase !== "flip" && phase !== "leave") {
      drop = follow(drop, toDrop, 0.2);
    }

    /* --- travel ------------------------------------------------------------ */

    x = follow(x, toX, 0.045);
    if (Math.abs(toX - x) > 0.002) face = toX > x ? 1 : -1;

    /* Percent of his own height, which is the unit `stride` is quoted in. */
    const h = host.offsetHeight || 1;
    const pageX = (x * document.documentElement.clientWidth * 100) / h;
    let dx = prevPageX === null ? 0 : pageX - prevPageX;
    prevPageX = pageX;
    if (Math.abs(dx) > 40) dx = 0;

    opacity = follow(opacity, toOpacity, 0.16);

    /* --- the pose ---------------------------------------------------------- */

    for (const key of Object.keys(pose) as (keyof Pose)[]) {
      pose[key] = follow(pose[key], target[key] ?? 0, 0.16);
    }

    /* --- out --------------------------------------------------------------- */

    if (stage) host.style.setProperty("--sk-mate-top", `${ledge + drop}px`);
    host.style.setProperty("--sk-mate-x", String(x));
    host.style.setProperty("--sk-mate-on", String(clamp(opacity, 0, 1)));

    if (sayUntil) {
      /* A pointer on the offer, or a keyboard on it, resets its clock — so it
         cannot expire under somebody who is reading it, and letting go gives
         them the full hold back rather than whatever was left of it. */
      if (askHeld()) sayUntil = now + pace.askHold;
      if (now > sayUntil) {
        hush();
      } else {
        /* He can pace out from under his own sentence, and the clamp was solved
           for where he was standing when he opened his mouth. Re-solving costs
           no layout, because the only thing that would have to be measured is
           the sentence and the sentence has not changed. */
        placeSay();
      }
    }

    /* **The rule the observer above was made to stop enforcing.** Off is the
       phase he spends most of a page in, and in it there is nothing to look at:
       the host is at nought opacity and the marks under it are last landing's.
       Solving and writing them again would be nineteen `setAttribute` calls a
       frame to change a drawing nobody is being shown. */
    if (phase !== "off") {
      const opts: DrawOptions = { face, dx, t: now, spin, rise };
      figure.draw(pose, opts);
    }
  };

  const play = (): void => {
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  const pause = (): void => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  play();

  /* The resting frame a mid-flight reduced-motion request lands on: gone, and
     silent. There is no still of this character that belongs on a page — he is
     a performance or he is nothing, and a figure frozen mid-crouch on the side
     of a section is a rendering artefact. */
  return {
    play,
    pause,
    rest() {
      pause();
      host.style.setProperty("--sk-mate-on", "0");
      /* Not a class removal, because the offer may be up and armed when the
         reader asks for less motion mid-page: a link nobody can see and nothing
         can hide is not a resting state. */
      hush();
    }
  };
}

/** Which key a stage answers to. In `roam` it is the attribute the selector
    named, recovered from the selector rather than hard-coded — so a site whose
    sections are `data-mate-stage` and a site whose sections are `data-chapter`
    both work and neither name is in this file. Anything the selector cannot be
    read as an attribute of falls back to the element's `id`, which is what a
    plain `section[id]` selector wants. */
function stageKey(el: Element, placement: CompanionPlacement): string {
  if (placement.mode !== "roam") return el.id;
  const attr = /\[([^\]=~^$*|]+)/.exec(placement.stages)?.[1]?.trim();
  const value = attr ? el.getAttribute(attr) : null;
  return value ?? el.id;
}

function resolve(target: string | Element | null | undefined): Element | null {
  if (!target) return null;
  return typeof target === "string" ? document.querySelector(target) : target;
}
