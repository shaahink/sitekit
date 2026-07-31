/* Which of four things to offer, and never a fifth thing that does nothing.
   ---------------------------------------------------------------------------
   The console shipped the passkey in 0.22.0 with one rule for showing its
   buttons: `unlockButton.hidden = !isEnrolled()`. That rule is correct and it
   is not enough, because it has only two outcomes — a button, or nothing at
   all — for a question with four answers. A reader on a device that cannot do
   this, a reader who has not signed in yet, and a reader who simply has not
   set it up, all got the same blank space, and the blank space said nothing.

   Then the button that *was* shown could fail silently on its own (see the
   note in `passkey.ts`'s `unlock`), so the two halves compounded: press a
   thing, nothing happens, no explanation available anywhere on the screen.
   That is the report this file exists to answer.

   So the question is asked properly and answered with a **rung**, and every
   rung has a next step:

     unsupported    this device has no face or fingerprint to offer.
                    Say nothing. There is no step, and an explanation nobody
                    can act on is clutter.
     needs-session  it could do this, but you have to sign in once first.
                    A **sentence**, not a button — the single most important
                    line here, because it is the state the reader was in when
                    they pressed a dead button and told us about it.
     can-enrol      signed in, capable, not set up. Offer to set it up.
     ready          set up. Offer to unlock — or, when already signed in,
                    offer to forget this device.

   `needs-session` and `ready` are the only two a signed-out screen can reach,
   and `can-enrol` is the only one that needs a session to discover. That
   asymmetry is why `refresh` is told whether a session exists rather than
   guessing: the server will not answer "could you enrol" to a stranger, and it
   should not. */

import { createPasskey, type Passkey, type PasskeyOptions, type PasskeyResult } from "./passkey.js";

export type Rung =
  /** No platform authenticator here — or no passkey handler on this site at
      all, which during a fleet rollout is the common case and reads to a
      person as the same thing: there is nothing to offer you. */
  | "unsupported"
  | "needs-session"
  | "can-enrol"
  | "ready";

export interface Ladder {
  /** The last answer, synchronously. Every button that reads this is destroyed
      and rebuilt by the next paint, so nothing here holds a node — callers ask
      again after each one rather than wiring a node a repaint will discard.
      That is the console's own hard-won rule, kept. */
  rung(): Rung;
  /** Ask the device and the server. Cheap: one capability check and, only when
      that passes, one same-origin POST. */
  refresh(signedIn: boolean): Promise<Rung>;
  enrol(): Promise<PasskeyResult>;
  unlock(): Promise<PasskeyResult>;
  forget(): Promise<PasskeyResult>;
  /** On a signed-out screen, try the device straight away. Somebody who set
      this up wants the prompt, not a button that summons one — and the button
      stays anyway, because a prompt can be dismissed.

      Returns null when there was nothing to try, which a caller must not treat
      as a failure: it is the ordinary case on every device but one. */
  autoUnlock(): Promise<PasskeyResult | null>;
}

export interface LadderOptions extends PasskeyOptions {
  /** Test seam, following `home({ storage })`'s precedent. The rung logic is
      the part of this release that a bug report was actually about, and it is
      four branches over two booleans — worth testing directly rather than
      through a mocked `fetch` and a faked authenticator, which would test the
      mock. */
  passkey?: Passkey;
}

export function createLadder(options: LadderOptions = {}): Ladder {
  const passkey: Passkey = options.passkey ?? createPasskey(options);
  let held: Rung = "unsupported";

  async function refresh(signedIn: boolean): Promise<Rung> {
    /* The device is asked first because it is free and local: a laptop with no
       sensor never needs a round trip to learn there is nothing to offer. */
    if (!(await passkey.capable())) return (held = "unsupported");

    /* Then the site. `mounted` false means this site has no passkey handler —
       during a rollout, most of them — and there is nothing here to set up.
       Asked before the session is considered, because a browser that already
       holds a credential can unlock whether or not it is signed in, which is
       the entire point; asking in the other order would hide the offer from
       exactly the reader it exists for. */
    const state = await passkey.state();
    if (!state.mounted) return (held = "unsupported");
    if (state.enrolled) return (held = "ready");
    return (held = signedIn ? "can-enrol" : "needs-session");
  }

  async function autoUnlock(): Promise<PasskeyResult | null> {
    /* A prompt fired at a tab nobody is looking at is a prompt that will be
       dismissed by accident and count as a refusal on the next attempt. */
    if (held !== "ready" || document.visibilityState !== "visible") return null;
    return passkey.unlock();
  }

  return {
    rung: () => held,
    refresh,
    autoUnlock,
    async enrol() {
      const result = await passkey.enrol();
      if (result.ok) held = "ready";
      return result;
    },
    async unlock() {
      return passkey.unlock();
    },
    async forget() {
      const result = await passkey.forget();
      /* Back to whichever rung is true now. Forgetting is only ever offered to
         a reader who is signed in, so there is no case where this should land
         on `needs-session`. */
      if (result.ok) held = "can-enrol";
      return result;
    }
  };
}
