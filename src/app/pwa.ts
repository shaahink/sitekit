/* Installing an admin surface to a home screen.
   ---------------------------------------------------------------------------
   Lifted from the fleet console in 0.23.0. The console's own argument for a
   root-scope service worker was that no visitor ever reaches /admin, so a
   worker registered only from there is a worker only the operator has. That
   argument survives the move — the editor's bundle is in the editor's page and
   nothing on a public page registers anything — but it stops being the whole
   argument, because a client site's origin also serves the client's actual
   site, and the owner is a visitor to it.

   So the scope stays root and the **rule about what may be cached is what
   changed**: see `serviceWorkerSource` below. An owner who saves a sentence
   and then opens their own page to look at it must see the new sentence. A
   stale public page served out of a cache the owner cannot see would be the
   single worst failure this system could have — worse than no offline mode at
   all, which is what it would be traded for.

   `beforeinstallprompt` is Chromium-only. On iOS there is no event, no
   deferred prompt and no programmatic install: Safari offers "Add to Home
   Screen" in its own share sheet and nothing a page does can summon it. That
   is why `canInstall()` returning false must never be rendered as "this device
   cannot install" — it means "this browser will not let a page ask", and the
   editor says so with instructions instead. Getting that wrong would tell
   every iPhone owner in the fleet that the feature does not exist. */

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

export interface PwaOptions {
  /** The worker to register. Root scope by default and by design. */
  worker?: string;
  scope?: string;
}

export interface Pwa {
  /** True once the browser has offered a prompt we can replay. The buttons
      that read this are re-created by every render, so nothing here touches a
      node — callers ask again after each paint. Wiring a node that a repaint
      will discard is how an offer appears once and then stops. */
  canInstall(): boolean;
  /** True when the surface is already running as an installed app, so the
      offer can be withheld rather than inviting somebody to install the thing
      they are looking at. */
  installed(): boolean;
  prompt(): Promise<void>;
  /** Register the worker and start watching for the install offer. `onChange`
      fires whenever the answer to `canInstall()` changes. */
  start(onChange: () => void): void;
}

export function createPwa(options: PwaOptions = {}): Pwa {
  let deferred: InstallEvent | null = null;

  const installed = (): boolean =>
    globalThis.matchMedia?.("(display-mode: standalone)").matches === true ||
    /* Safari's own spelling, which is the only signal an iPhone gives. */
    (navigator as { standalone?: boolean }).standalone === true;

  function start(onChange: () => void): void {
    if ("serviceWorker" in navigator) {
      /* A registration failure costs the reader nothing — the surface works
         exactly as it did before, it just does not open offline — so it is not
         worth a banner. It is worth a line in the log, which is the half the
         console got wrong first time round: a bolded path in the worker's own
         header comment put a star immediately before a slash, closing the
         comment; the script threw at the next word; and an empty catch meant
         nothing anywhere said so. Registration failed on production for a
         deploy and only Chrome's `ServiceWorker.workerErrorReported` knew.

         The general rule that came out of it is worth more than the fix: a
         silent catch around something optional is a feature that can be false
         for a deploy and leave no trace. Log it even when nobody needs to
         act. */
      navigator.serviceWorker
        .register(options.worker ?? "/sk-editor-sw.js", { scope: options.scope ?? "/" })
        .catch((cause: unknown) => {
          console.warn("The editor's service worker did not register:", cause);
        });
    }

    globalThis.addEventListener("beforeinstallprompt", (event) => {
      /* The browser's own banner is suppressed so the offer can sit where the
         rest of the settings are rather than over the content. */
      event.preventDefault();
      deferred = event as InstallEvent;
      onChange();
    });
    globalThis.addEventListener("appinstalled", () => {
      deferred = null;
      onChange();
    });
  }

  return {
    canInstall: () => deferred !== null,
    installed,
    start,
    async prompt() {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice.catch(() => undefined);
      /* Spent either way. A prompt that was dismissed cannot be replayed —
         Chrome fires a fresh `beforeinstallprompt` when it is willing to be
         asked again, and that is the only honest signal about whether it is. */
      deferred = null;
    }
  };
}
