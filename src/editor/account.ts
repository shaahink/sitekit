/* Settings — who you are, this device, and the way out.
   ---------------------------------------------------------------------------
   Until 0.23.0 the editor's chrome was a name and a "Sign out" link, and
   everything else an owner might want to know about their own session did not
   exist anywhere. The console had grown the same things a month earlier and
   grown them as footer buttons, which works when there is one operator and one
   console; it does not survive being the fifth control on a bar that already
   lost a quarter of a phone screen once (session 17).

   So it is a sheet. One button on the bar, one screen with everything on it,
   and nothing added to the surface an owner uses to actually edit.

   ── The rule this file exists to keep ──────────────────────────────────────
   **Every row says something.** The report that started this work was somebody
   pressing "Unlock with this device" and watching nothing happen, and the two
   causes were both absences: a button shown in a state it could not work in,
   and a failure path that returned without a word. So there is no branch here
   that renders an empty space. A device that cannot do this says so; a device
   that could once you have signed in says *that*, as a sentence and not as a
   disabled button; and every refusal from `app/passkey.ts` maps to a line of
   text before it reaches a reader.

   The one deliberate silence is `cancelled`. Somebody who dismissed their own
   phone's fingerprint prompt knows they dismissed it, and telling them so
   reads as an accusation. */

import type { Ladder, PasskeyReason, PasskeyResult, Rung } from "../app/index.js";
import type { Pwa } from "../app/index.js";
import { el } from "./dom.js";
import { fill, type EditorStrings } from "./strings.js";

export interface AccountOptions {
  strings: EditorStrings;
  /** The owner's own name, as the session reports it. */
  who: string | undefined;
  /** Which language the panel is speaking, so the current one can be marked. */
  lang: string;
  /** Every language the kit ships, in its own script. Not translated: a reader
      looking for their own language is looking for the word they call it, and
      "Persian" helps nobody who reads only Persian. */
  languages: { code: string; label: string }[];
  version: string;
  /** Absent on a site that passed `app: false`, which takes the install and
      unlock rows away rather than showing offers nothing can keep. */
  ladder: Ladder | null;
  pwa: Pwa | null;
  onSignOut: () => void;
  onLanguage: (lang: string) => void;
  onHelp: () => void;
  onAsk: () => void;
  /** Fires after an unlock or a forget changes what the panel should show. */
  onSessionChange: () => void;
}

/** Every refusal, in the reader's own language. `cancelled` is absent on
    purpose — see the header. A reason with no entry here would be a silent
    failure, which is the whole bug, so the map is total over the union and
    TypeScript is what keeps it that way: adding a `PasskeyReason` without
    adding a string stops the build. */
function reasonText(reason: PasskeyReason, strings: EditorStrings): string | null {
  const table: Record<PasskeyReason, string | null> = {
    "not-configured": strings.deviceFailedNotConfigured,
    unauthorized: strings.deviceFailedUnauthorized,
    "not-enrolled": strings.deviceFailedNotEnrolled,
    cancelled: null,
    "device-refused": strings.deviceFailedRefused,
    "browser-too-old": strings.deviceFailedTooOld,
    unverified: strings.deviceFailedUnverified,
    revoked: strings.deviceFailedRevoked,
    offline: strings.deviceFailedOffline,
    unknown: strings.deviceFailedUnknown
  };
  return table[reason];
}

/** How a surface is told what happened. Deliberately a callback rather than a
    toast system the kit does not have: the sign-in card already has a place
    for an error and the sheet has its own line, and a floating notification
    that outlives the control that caused it would have been a third mechanism
    to keep honest. */
export type Say = (message: string, kind: "ok" | "bad") => void;

/** Say what happened, unless what happened was the reader changing their mind.
    Returns whether it succeeded, so callers can read as a sentence. */
export function reportPasskey(
  result: PasskeyResult,
  strings: EditorStrings,
  say: Say,
  success?: string
): boolean {
  if (result.ok) {
    if (success) say(success, "ok");
    return true;
  }
  const text = reasonText(result.reason ?? "unknown", strings);
  if (text) say(text, "bad");
  /* The server's own words go to the console rather than to the reader: they
     are English from a handler, and the reader may not be reading English. */
  if (result.detail) console.warn("passkey:", result.reason, result.detail);
  return false;
}

/* --- the sheet ---------------------------------------------------------- */

export interface Account {
  /** The bar's button. */
  button: HTMLButtonElement;
  /** The sheet itself, appended once and hidden until asked for. */
  element: HTMLElement;
  open(): void;
  close(): void;
  /** Repaint, but only if the reader is already looking at it. The install
      offer can arrive at any moment after load, and a sheet that opened itself
      to announce that would be a browser feature interrupting somebody
      mid-sentence. */
  refresh(): void;
}

export function account(options: AccountOptions): Account {
  const { strings } = options;

  const button = el("button", "sk-editor__link sk-editor__account", strings.accountOpen);
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");

  const element = el("div", "sk-editor__sheet");
  element.hidden = true;
  const card = el("div", "sk-editor__sheetcard");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  element.append(card);

  const heading = el("h2", "sk-editor__sheettitle", strings.accountTitle);
  heading.id = "sk-editor-sheet-title";
  card.setAttribute("aria-labelledby", heading.id);

  const close = el("button", "sk-editor__sheetclose", strings.accountClose);
  close.type = "button";
  close.setAttribute("aria-label", strings.accountClose);

  const head = el("div", "sk-editor__sheethead");
  head.append(heading, close);

  /* One line, above the rows, for whatever the last action had to say. A live
     region because the thing it reports on — a fingerprint prompt — takes the
     reader's eyes off the screen entirely, and a message that painted while
     they were looking at their own thumb is a message nobody read. */
  const message = el("p", "sk-editor__sheetmessage");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.hidden = true;

  const say: Say = (text, kind) => {
    message.textContent = text;
    message.hidden = false;
    message.classList.toggle("sk-editor__sheetmessage--bad", kind === "bad");
  };

  const rows = el("div", "sk-editor__sheetrows");
  card.append(head, message, rows);

  /* Where focus was before the sheet took it. Returning it is not a polish
     detail on a surface reached by keyboard: focus left on a hidden node is
     focus nobody can see. */
  let restoreFocus: HTMLElement | null = null;

  function open(): void {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.hidden = false;
    void paint();
    close.focus();
  }

  function shut(): void {
    element.hidden = true;
    restoreFocus?.focus();
    restoreFocus = null;
  }

  button.addEventListener("click", open);
  close.addEventListener("click", shut);
  /* The backdrop, but only the backdrop: a click that started inside the card
     and drifted out while selecting text must not close it. */
  element.addEventListener("click", (event) => {
    if (event.target === element) shut();
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      shut();
    }
  });

  /* --- rows ------------------------------------------------------------- */

  function section(title: string): HTMLElement {
    const wrap = el("section", "sk-editor__sheetsection");
    wrap.append(el("h3", "sk-editor__sheetlabel", title));
    return wrap;
  }

  function note(text: string): HTMLElement {
    return el("p", "sk-editor__note", text);
  }

  function action(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const node = el(
      "button",
      primary ? "sk-editor__save sk-editor__sheetaction" : "sk-editor__sheetbutton",
      label
    );
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  /** This device — the four rungs, each with something to read.

      The signed-out screen has its own, smaller version of this in index.ts;
      what is here is the signed-in half, where `can-enrol` is reachable and
      `needs-session` is not. */
  function deviceSection(rung: Rung): HTMLElement {
    const wrap = section(strings.deviceTitle);
    const ladder = options.ladder;
    if (!ladder) return wrap;

    if (rung === "unsupported") {
      wrap.append(note(strings.deviceUnsupported));
      return wrap;
    }

    if (rung === "ready") {
      wrap.append(note(strings.deviceReady));
      wrap.append(
        action(strings.deviceForget, () => {
          void ladder.forget().then((result) => {
            if (reportPasskey(result, strings, say, strings.deviceForgotten)) void paint();
          });
        })
      );
      return wrap;
    }

    /* `can-enrol`. `needs-session` cannot occur here — the sheet is only
       reachable from a signed-in panel — and if it somehow did, the offer
       below is still the right one: it would fail with `unauthorized`, which
       has words. */
    wrap.append(note(strings.deviceOffer));
    wrap.append(
      action(
        strings.deviceEnrol,
        () => {
          void ladder.enrol().then((result) => {
            if (reportPasskey(result, strings, say, strings.deviceEnrolled)) void paint();
          });
        },
        true
      )
    );
    return wrap;
  }

  /** Installing. Three states and never a dead button, which on this row means
      resisting the obvious shortcut: `canInstall()` is false on every iPhone
      ever made, because Safari has no such API and never fires the event. A
      row that read "this device cannot install apps" would be wrong about the
      most popular phone in the fleet's client base. */
  function installSection(): HTMLElement {
    const wrap = section(strings.installTitle);
    const pwa = options.pwa;
    if (!pwa) return wrap;

    if (pwa.installed()) {
      wrap.append(note(strings.installDone));
      return wrap;
    }
    if (pwa.canInstall()) {
      wrap.append(note(strings.installNote));
      wrap.append(action(strings.installButton, () => void pwa.prompt().then(() => paint()), true));
      return wrap;
    }
    /* `navigator.standalone` is Safari's own non-standard flag and exists
       nowhere else, which makes it a feature detect rather than a UA sniff:
       the browsers that have it are exactly the browsers that will never fire
       `beforeinstallprompt`. */
    const isSafariMobile = "standalone" in navigator;
    wrap.append(note(isSafariMobile ? strings.installIos : strings.installLater));
    return wrap;
  }

  function languageSection(): HTMLElement {
    const wrap = section(strings.languageTitle);
    const list = el("div", "sk-editor__langrow");
    for (const language of options.languages) {
      const node = el("button", "sk-editor__sheetbutton", language.label);
      node.type = "button";
      node.lang = language.code;
      if (language.code === options.lang) {
        node.setAttribute("aria-current", "true");
        node.disabled = true;
      }
      node.addEventListener("click", () => options.onLanguage(language.code));
      list.append(node);
    }
    wrap.append(list);
    return wrap;
  }

  function helpSection(): HTMLElement {
    const wrap = section(strings.helpTitle);
    wrap.append(
      action(strings.helpTour, () => {
        shut();
        options.onHelp();
      })
    );
    wrap.append(
      action(strings.helpAsk, () => {
        shut();
        options.onAsk();
      })
    );
    return wrap;
  }

  function footer(): HTMLElement {
    const wrap = el("div", "sk-editor__sheetfoot");
    wrap.append(action(strings.signOut, options.onSignOut));
    wrap.append(el("p", "sk-editor__version", fill(strings.versionLabel, { version: options.version })));
    return wrap;
  }

  async function paint(): Promise<void> {
    rows.textContent = "";
    if (options.who) rows.append(note(fill(strings.accountWho, { who: options.who })));

    /* Asked fresh on every paint rather than cached across opens: an owner can
       enrol on this device in another tab, and a sheet that remembered the old
       answer would offer to set up something already set up. */
    const rung = options.ladder ? await options.ladder.refresh(true) : "unsupported";
    if (options.ladder) rows.append(deviceSection(rung));
    if (options.pwa) rows.append(installSection());
    rows.append(languageSection(), helpSection(), footer());
  }

  return {
    button,
    element,
    open,
    close: shut,
    refresh: () => {
      if (!element.hidden) void paint();
    }
  };
}
