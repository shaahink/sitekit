/* The first run, and it teaches by getting out of the way.
   ---------------------------------------------------------------------------
   Session 17 §1.3 measured what an owner meets the first time: two sentences
   and Google's button, with 7.7's welcome notice — the one screen that says
   what this is and that nothing is permanent — *behind* the sign-in. So the
   reassurance was shown only to people who had already committed, and the one
   thing an owner has to learn, that the words on their own page are tappable,
   was written down in a help panel rather than shown.

   Three steps, on the owner's own page, each advanced by **them doing the
   thing** rather than by a Next button:

     1  tap the highlighted words          → advances on an annotated element
                                             taking focus
     2  type over it; Save makes it real   → advances on the field going dirty
     3  Home is where the rest lives       → ends on Home being tapped, or on
                                             "Got it"

   Nothing here is modal and nothing is disabled while it runs. An owner who
   ignores the tour and taps their own text is *doing step 1*, and the tour
   notices — which is why `typed()` accepts step 1 as well as step 2. Somebody
   who never met step 1's sentence has just demonstrated they did not need it.

   The contract is 7.7's, inherited rather than reinvented (`home.ts`'s
   `SEEN_KEY` is the same idea with a different key): remembered per browser,
   dismissed stays dismissed across reloads, reopening does **not** clear the
   flag — reading something a second time does not make you a first-time user —
   and a browser that refuses storage costs a repeat, never an editor that will
   not open.

   The logic is separated from the bar it draws into so the rules above can be
   tested without a DOM: a `TourView` is three methods, and `inline.ts` supplies
   the one that draws into `.bar__tour`. The alternative was reaching into a
   shadow root from a test environment the kit does not have yet — F13's tests
   arrive with step 6 of §2.8, and these rules should not be waiting on it. */

/** Remembered per browser rather than per account, for `home.ts`'s reason: a
    field in the session cookie would bring the tour back every time the session
    key rotates, and a signed-out owner has nothing to key it by. */
export const TOUR_SEEN = "sk-editor-tour-seen";

export type TourStep = 1 | 2 | 3;

/** Storage the browser may refuse to hand over — Safari in private mode throws
    on access rather than answering null. `home.ts`'s `safeStorage` is the same
    guard for the same reason on the other surface; both exist because an editor
    that will not open because it could not remember a dismissed notice would be
    an absurd way to fail. */
export function tourStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** What a tour needs of whatever is drawing it. Three methods, because a fourth
    would be a fourth thing a test has to fake. */
export interface TourView {
  /** Draw this step. `last` is the step that ends on a word rather than on the
      owner doing something, so the view knows which button to offer. */
  show(step: TourStep, last: boolean): void;
  hide(): void;
  /** Ring the route to Home, or stop. Which control that is depends on the
      bar's shape and only the bar knows — see `Bar.spotlight`. */
  spotlight(on: boolean): void;
}

export class Tour {
  private step: TourStep | null = null;

  constructor(
    private readonly view: TourView,
    /** Null where the browser refuses it, which costs a repeat and nothing
        else. */
    private readonly store: Storage | null
  ) {}

  /** Which step is showing, or null. Read by the probe and by nothing else in
      the kit — the bar is told what to draw rather than asked. */
  get showing(): TourStep | null {
    return this.step;
  }

  /** Whether this browser has already been through it. */
  get seen(): boolean {
    try {
      return this.store?.getItem(TOUR_SEEN) === "1";
    } catch {
      /* Safari in private mode throws on access rather than answering null. */
      return false;
    }
  }

  /** Begin, unless this browser has been here before.

      `forced` is "Show me how" from the panel and the bar's own "Show me how
      again": an owner asking for it is not a first run, and refusing them
      because they have seen it once would be absurd.

      @returns whether a step is now showing, so a caller can tell an owner who
      asked from one who arrived. */
  start(forced = false): boolean {
    if (this.step) return false;
    if (!forced && this.seen) return false;
    this.to(1);
    return true;
  }

  /** An annotated element took focus. */
  focused(): void {
    if (this.step === 1) this.to(2);
  }

  /** A field went dirty. Accepted from step 1 as well, because an owner who
      typed without reading step 1 has done step 1. */
  typed(): void {
    if (this.step === 1 || this.step === 2) this.to(3);
  }

  /** Home was tapped — the last step's own ending. */
  wentHome(): void {
    if (this.step === 3) this.end();
  }

  /** Skipped, finished, or left edit mode. Marks the flag: this is the only
      thing that does, so a tour abandoned half way comes back next time
      exactly as 7.7's notice does. */
  end(): void {
    if (!this.step) return;
    this.step = null;
    this.view.spotlight(false);
    this.view.hide();
    try {
      this.store?.setItem(TOUR_SEEN, "1");
    } catch {
      /* Then it is offered again next time, which is the old behaviour. */
    }
  }

  /** Taken down without being dismissed — the page is leaving edit mode. The
      flag is deliberately untouched: an owner who tapped Done mid-tour has not
      said they understood it. */
  stop(): void {
    if (!this.step) return;
    this.step = null;
    this.view.spotlight(false);
    this.view.hide();
  }

  private to(step: TourStep): void {
    this.step = step;
    /* The ring belongs to the last step and to nothing else, so it is set from
       here rather than by the caller — one place decides, and it cannot get out
       of step with the sentence beside it. */
    this.view.spotlight(step === 3);
    this.view.show(step, step === 3);
  }
}
