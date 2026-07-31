// @vitest-environment happy-dom
/* The unlock ladder — four answers, and never a blank one.
   ---------------------------------------------------------------------------
   The report this release answers was "I pressed unlock with device and
   nothing happened", and the cause was two absences compounding: a control
   offered in a state it could not work in, and a failure that returned without
   a word. This file covers the first. `account.ts`'s `reasonText` covers the
   second by construction — it is a `Record` over the reason union, so a new
   reason without a message stops the build rather than reaching a reader. */

import { describe, expect, it, vi } from "vitest";
import { createLadder } from "../src/app/unlock.js";
import type { Passkey, PasskeyResult } from "../src/app/passkey.js";

const OK: PasskeyResult = { ok: true };

function fake(over: Partial<Passkey> = {}): Passkey {
  return {
    capable: async () => true,
    state: async () => ({ mounted: true, enrolled: false }),
    enrol: async () => OK,
    unlock: async () => OK,
    forget: async () => OK,
    ...over
  };
}

describe("the rung a reader lands on", () => {
  it("is unsupported on a device with no sensor, without asking the server", async () => {
    const state = vi.fn(async () => ({ mounted: true, enrolled: true }));
    const ladder = createLadder({ passkey: fake({ capable: async () => false, state }) });

    expect(await ladder.refresh(true)).toBe("unsupported");
    /* Not merely the right answer — the right answer for free. A laptop with
       no sensor should never cost a round trip to learn there is nothing on
       offer. */
    expect(state).not.toHaveBeenCalled();
  });

  it("is unsupported on a site that has not mounted the handler yet", async () => {
    /* The rollout case, and the one that would have been worst to get wrong:
       every site in the fleet is in this state until its own bump lands, and
       conflating it with "not enrolled" would have offered all six owners a
       button that could only ever fail. */
    const ladder = createLadder({
      passkey: fake({ state: async () => ({ mounted: false, enrolled: false }) })
    });
    expect(await ladder.refresh(true)).toBe("unsupported");
    expect(await ladder.refresh(false)).toBe("unsupported");
  });

  it("is needs-session when the device could do it but nobody has signed in", async () => {
    const ladder = createLadder({ passkey: fake() });
    /* The state behind the bug report. It must be reachable and it must be
       distinct from `unsupported`, because the two get different words: one is
       a sentence telling the reader what to do, the other is silence. */
    expect(await ladder.refresh(false)).toBe("needs-session");
  });

  it("is can-enrol for the same device once there is a session", async () => {
    const ladder = createLadder({ passkey: fake() });
    expect(await ladder.refresh(true)).toBe("can-enrol");
  });

  it("is ready whether or not there is a session, because that is the point", async () => {
    const ladder = createLadder({
      passkey: fake({ state: async () => ({ mounted: true, enrolled: true }) })
    });
    expect(await ladder.refresh(false)).toBe("ready");
    expect(await ladder.refresh(true)).toBe("ready");
  });
});

describe("what changes the rung", () => {
  it("moves to ready after enrolling, so the sheet stops offering it", async () => {
    const ladder = createLadder({ passkey: fake() });
    await ladder.refresh(true);
    expect(ladder.rung()).toBe("can-enrol");

    expect((await ladder.enrol()).ok).toBe(true);
    expect(ladder.rung()).toBe("ready");
  });

  it("stays where it was when enrolling fails", async () => {
    const ladder = createLadder({
      passkey: fake({ enrol: async () => ({ ok: false, reason: "cancelled" }) })
    });
    await ladder.refresh(true);
    await ladder.enrol();
    expect(ladder.rung()).toBe("can-enrol");
  });

  it("moves back to can-enrol after forgetting the device", async () => {
    const ladder = createLadder({
      passkey: fake({ state: async () => ({ mounted: true, enrolled: true }) })
    });
    await ladder.refresh(true);
    expect(ladder.rung()).toBe("ready");

    await ladder.forget();
    expect(ladder.rung()).toBe("can-enrol");
  });
});

describe("trying the device without being asked", () => {
  it("does nothing at all when there is nothing enrolled", async () => {
    const unlock = vi.fn(async () => OK);
    const ladder = createLadder({ passkey: fake({ unlock }) });
    await ladder.refresh(false);

    /* Null rather than a failure. A caller that reported this as an error
       would put "that didn't unlock" on the screen of every reader who has
       never set it up — which is nearly all of them. */
    expect(await ladder.autoUnlock()).toBeNull();
    expect(unlock).not.toHaveBeenCalled();
  });

  it("tries once when the device is enrolled and the tab is being looked at", async () => {
    const unlock = vi.fn(async () => OK);
    const ladder = createLadder({
      passkey: fake({ state: async () => ({ mounted: true, enrolled: true }), unlock })
    });
    await ladder.refresh(false);

    expect(await ladder.autoUnlock()).toEqual(OK);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("holds off while the tab is hidden", async () => {
    const unlock = vi.fn(async () => OK);
    const ladder = createLadder({
      passkey: fake({ state: async () => ({ mounted: true, enrolled: true }), unlock })
    });
    await ladder.refresh(false);

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden" as DocumentVisibilityState);
    try {
      /* A fingerprint prompt fired at a tab nobody is looking at gets
         dismissed by accident, and a dismissal counts against the next real
         attempt. */
      expect(await ladder.autoUnlock()).toBeNull();
      expect(unlock).not.toHaveBeenCalled();
    } finally {
      visibility.mockRestore();
    }
  });
});
