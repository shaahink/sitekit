/* How a decorative sequence is allowed to arrive.
   ---------------------------------------------------------------------------
   Every rule in here was learned on sk-works' hero and written down there at
   length; this module is those rules made reusable, so the next site's
   animation file contains an animation and nothing else. The contract:

   1. **Nothing on the critical path.** `start` is not called — and therefore
      whatever it dynamically imports is not fetched — until the `load` event
      has fired *and* the browser has reported itself idle. First paint, fonts
      and every measurement anything else takes all happen before a frame of
      decoration is paid for. `requestIdleCallback`'s timeout is the backstop
      for a tab that never goes idle: the motion arrives late rather than never.

   2. **Reduced motion is this module not running.** The query is checked
      before anything is scheduled, so a visitor who asked for less motion does
      not download an animation library in order to be told not to animate. If
      the preference flips *while the page is open*, the sequence is paused and
      asked for its resting frame — `rest()` — because pausing alone strands
      the drawing on whatever frame the request landed on.

   3. **The still is the markup's job, not this module's.** A failed chunk, a
      visitor with JavaScript off and a visitor who never scrolls to the
      element all get whatever the server rendered — which is why `start`'s
      failure is swallowed: there is nothing to do and nothing worth telling a
      visitor about. Sites must render the finished state, not an empty frame.

   4. **Off screen is paused.** A loop repainting elements nobody can see is a
      phone getting warm in somebody's hand while they read the pricing. The
      observer's default margin means "nearly on screen counts as on".

   The kit owns this file because it is plumbing that must not drift into per-
   site variants; what plays, and what it looks like, stays in the site
   (PLAN §3.2 — logic in the kit, presentation in the sites). */

/** What a mounted sequence hands back so visibility and preference changes can
    reach it. Every member is optional: a scroll-driven diagram has no play
    state worth pausing and returns nothing at all. */
export interface MotionControls {
  play?: () => void;
  pause?: () => void;
  /** Jump the drawing to its designed resting frame. Called when reduced
      motion is requested mid-flight; a sequence with no safe still can omit
      it and merely stops. */
  rest?: () => void;
}

export interface MountOptions {
  /** How close to the viewport counts as visible. Default "100px". */
  rootMargin?: string;
  /** Backstop for `requestIdleCallback` (ms). Default 3000. */
  idleTimeout?: number;
}

/** Mount a deferred, interruptible, reduced-motion-respecting sequence on
    `target`. `start` does the importing and the building and resolves to the
    sequence's controls (or nothing). Idempotence is the caller's concern —
    call once per element. */
export function mountMotion(
  target: Element | null,
  start: () => Promise<MotionControls | null | undefined | void>,
  options: MountOptions = {}
): void {
  if (!target) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduced.matches) return;

  const idle = (run: () => void) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: options.idleTimeout ?? 3000 });
    } else {
      setTimeout(run, 1200);
    }
  };

  const boot = () =>
    idle(() => {
      start()
        .then((controls) => {
          if (!controls) return;

          if (controls.play && controls.pause && "IntersectionObserver" in window) {
            const watch = new IntersectionObserver(
              (entries) => {
                const entry = entries[0];
                if (!entry) return;
                if (entry.isIntersecting) controls.play?.();
                else controls.pause?.();
              },
              { rootMargin: options.rootMargin ?? "100px" }
            );
            watch.observe(target);
          }

          reduced.addEventListener("change", (event) => {
            if (!event.matches) return;
            controls.pause?.();
            controls.rest?.();
          });
        })
        /* Rule 3: the markup already renders the finished state. */
        .catch(() => {});
    });

  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot, { once: true });
}

/** A design token, read off the document rather than repeated in a script.
    Tween engines interpolate parsed colours and `var(--ink)` is not one, so
    scripts need literals — but a hex code copied into a script is a colour
    that stops matching the day the stylesheet is retuned. Read it instead. */
export function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Write a custom property through the CSSOM. The fleet ships no
    `'unsafe-inline'` in `style-src`, so `setAttribute("style", …)` is blocked
    outright; `style.setProperty` is not. Custom properties are also how a
    script stays direction-blind — it writes one number between 0 and 1 and
    the stylesheet spends it on a logical inset. */
export function setVar(el: HTMLElement | SVGElement, name: string, value: string | number): void {
  el.style.setProperty(name, String(value));
}
