/* The moves a drawing makes, written once.
   ---------------------------------------------------------------------------
   A choreography file should read as *when things happen and what for*. The
   moment it also has to spell out how a thing falls — two tweens, a rebound, a
   percentage rather than a pixel because the drawing renders at two widths —
   the timing relationships, which are the only part anybody retuning it needs
   to see, disappear among the arguments. These four are the moves that turned
   out to be the same in every sequence the fleet has: a thing falls, a row
   arrives or leaves one item at a time, a card says something, and every beat
   is written against a named time rather than a number.

   **Nothing here imports a tween engine.** A timeline is taken as a parameter
   and only ever asked to `add` — which is the surface every engine worth using
   already has, and the same bargain `rig.ts` strikes with the pose object. The
   kit owns the moves; the site owns which engine drives them, what they are
   applied to, and when (PLAN §3.2).

   **Percentages, not pixels, and that is the one rule in here with teeth.** A
   decorative drawing is rendered at whatever width its column gets — a third
   of a monitor, all of a phone — and its parts are sized against that. A fall
   of 40px is a hop at one size and a plummet at the other; a fall of 320% of
   the thing's own height is the same fall at both. Every distance in this
   module is a string percentage for that reason, and a caller who passes a
   pixel value has bought themselves a bug that only shows up on somebody
   else's screen. */

/** The one thing a timeline has to be able to do. Deliberately not anime's
    type: this module is checked against the *contract*, so a site on a
    different engine — or a fake in a test — satisfies it by having one
    method. */
export interface Track {
  add(targets: unknown, props: Record<string, unknown>, position?: number): unknown;
}

export interface FallOptions {
  /** How far above its resting place it starts, as a percentage of its own
      height. */
  from?: string;
  /** The angle it comes to rest at. Every dropped thing wants a different
      one — five labels landing at the same angle is a row, and a row is the
      opposite of dropped. */
  tilt?: number;
  /** How far it comes back up on the bounce, as a percentage of its own
      height. */
  rebound?: string;
  /** The fall. */
  duration?: number;
  /** The bounce afterwards. */
  settle?: number;
  ease?: string;
}

/** A thing falling out of somewhere and landing untidily.
    ---------------------------------------------------------------------------
    **Two tweens rather than one, and the second is what makes it a drop.** A
    single eased fall lands the way a lift arrives: decelerating smoothly to a
    stop, which is what a lift does and what nothing dropped has ever done. The
    small rebound afterwards is the entire difference between a label appearing
    at the bottom of a frame and a thing having been dropped there.

    Returns the time it is finally still, so a beat that waits for it reads as
    arithmetic on one number rather than two additions repeated at three call
    sites. */
export function fall(tl: Track, el: unknown, at: number, options: FallOptions = {}): number {
  const duration = options.duration ?? 460;
  const settle = options.settle ?? 280;

  tl.add(
    el,
    {
      opacity: [0, 1],
      y: [options.from ?? "-320%", "0%"],
      rotate: [0, options.tilt ?? 0],
      duration,
      ease: options.ease ?? "out(4)"
    },
    at
  );
  tl.add(
    el,
    { y: ["0%", options.rebound ?? "-18%", "0%"], duration: settle, ease: "out(2)" },
    at + duration
  );

  return at + duration + settle;
}

export interface RippleOptions {
  /** Between one item starting and the next. */
  gap?: number;
  /** Each item's own tween. */
  duration?: number;
  ease?: string;
  /** Last one first. An arrival played backwards is a departure, which is why
      this is a flag rather than a second function: a panel that leaves the way
      it came reads as being cleared, and a panel that leaves in the same order
      it arrived reads as a second, worse build. */
  reverse?: boolean;
}

/** A row of things arriving — or leaving — one at a time.

    Returns when the last of them has finished, for the reason `fall` does. An
    empty list is a no-op that returns `at`: a site whose owner has deleted
    every row of something should get a beat with nothing in it rather than a
    guard at each call site. */
export function ripple(
  tl: Track,
  items: ArrayLike<unknown>,
  props: Record<string, unknown>,
  at: number,
  options: RippleOptions = {}
): number {
  const count = items.length;
  if (!count) return at;

  const gap = options.gap ?? 45;
  const duration = options.duration ?? 240;
  const last = count - 1;

  tl.add(
    items,
    {
      ...props,
      duration,
      ease: options.ease ?? "out(2)",
      delay: (_: unknown, i: number) => (options.reverse ? last - i : i) * gap
    },
    at
  );

  return at + last * gap + duration;
}

export interface CueOptions {
  /** How far the card travels on the block axis as it arrives, in the
      caller's units. **Negative drops it in from above, positive raises it
      from below** — and that sign is the staging rather than a taste: a title
      card is a thing the film puts over the picture, so it comes down onto it;
      a spoken card belongs to somebody standing in the picture, so it comes up
      out of them.

      The block axis is the one axis that means the same thing in a
      right-to-left document, which is why a card may be moved on it at all.
      Anything on the inline axis belongs to a logical property in the site's
      stylesheet. */
  from?: number;
  /** Time at full opacity. **This is the number that decides whether anybody
      reads the thing.** A card up for less time than its sentence takes to
      read is a card that registers as "words happened"; about a second past
      the end of the sentence is what reads as somebody speaking. */
  hold?: number;
  enter?: number;
  leave?: number;
}

/** A card that says something and then stops.

    Returns the time it is gone. The three parts are one call because they are
    one decision — a sequence that schedules its entrances and its exits
    separately eventually holds one of them for the wrong length, and the bug
    is a sentence that vanishes mid-word. */
export function cue(tl: Track, el: unknown, at: number, options: CueOptions = {}): number {
  const from = options.from ?? 8;
  const hold = options.hold ?? 3000;
  const enter = options.enter ?? 340;
  const leave = options.leave ?? 300;

  tl.add(el, { opacity: [0, 1], y: [from, 0], duration: enter, ease: "out(3)" }, at);
  /* It leaves a little way back toward where it came from rather than all the
     way: a card that retreats the full distance reads as being sucked back in,
     and a card that leaves in the opposite direction reads as two cards. */
  tl.add(el, { opacity: 0, y: from * 0.4, duration: leave, ease: "in(2)" }, at + hold);

  return at + hold + leave;
}

/** Beats plus the two questions a choreography file asks about them. */
export type Timetable<K extends string> = { readonly [P in K]: number } & {
  /** `ms` after a named beat. Reads as what it is at the call site —
      `T.after("quake", 1050)` — where `T.quake + 1050` reads as arithmetic
      that happens to be about a beat. */
  after(name: K, ms: number): number;
  /** The gap between two beats. What a retune is checked against: the shape of
      a sequence is its intervals, and the way to break one is to move a beat
      and not notice which gap closed. */
  span(from: K, to: K): number;
};

/** A named timetable.
    ---------------------------------------------------------------------------
    Every position in a sequence written against a name rather than a number is
    the mechanism that lets a whole act be inserted at the front and everything
    after it move by arithmetic. It is also the thing that makes a sequence
    *readable a year later*: `T.quake` says what is happening at 28.8 seconds,
    and 28800 says nothing at all.

    **`after` and `span` are reserved.** A beat called either of those would
    shadow its method, and the resulting failure — a position silently becoming
    a function — is exactly the kind that survives review. Named rather than
    guarded: a runtime check here would cost every site a throw at boot for a
    mistake nobody has made, and this sentence prevents it just as well. */
export function timetable<K extends string>(beats: Record<K, number>): Timetable<K> {
  const at = (name: K): number => beats[name] ?? 0;
  return Object.freeze({
    ...beats,
    after: (name: K, ms: number) => at(name) + ms,
    span: (from: K, to: K) => at(to) - at(from)
  }) as Timetable<K>;
}
