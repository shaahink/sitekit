/* The marker a device carries after this site's editor has accepted it.
   ---------------------------------------------------------------------------
   An owner had two ways into their own editor and both cost them something:
   type `/edit` on a phone keyboard, or type `?edit=1` onto the end of their
   own URL. A footer link would fix it and would show the door to every
   visitor on a client's public page, which is the one thing this may not do.

   So the *device* remembers instead. After the server has accepted an editor
   request on this site, `rememberEditor()` writes a marker in this origin's
   own `localStorage`. The marker **grants nothing**: it is a key and an
   expiry, no email, no `sub`, no name, and no handler anywhere in this kit
   reads it or would accept it if it were offered — `cms-handler.test.ts`
   offers it as a cookie and as a header and gets the same refusal, byte for
   byte, as a request without it. Its entire job is to let `inline-gate.ts`
   decide whether to pull `hint.ts`, whose entire job is to draw one small way
   in.

   Why storage rather than asking the sign-in origin. Third-party cookies are
   blocked in Safari and increasingly in Chrome, so an iframe or a credentialed
   fetch to the auth origin fails on the phones these owners actually use — and
   on this fleet it fails twice over, because every site's public CSP is
   `connect-src 'self'` and the request never leaves the page. A cross-site
   "is this an owner?" question has two honest forms: a redirect the person can
   see, or a first-party marker set on the site itself. This is the second.
   There is no third: `cms/session.ts` mints `sk_cms` as `HttpOnly` by design,
   so the gate's own JS cannot read the real credential to answer the question
   either. Something else has to answer it, and that something must grant
   nothing.

   **An echo of a server verdict, never a client claim.** Written only where a
   real `/api/content` response came back accepted, and deleted the moment one
   comes back refused — take somebody out of a site's `CMS_ALLOWLIST` and their
   next tap clears their own marker, because `cms/handler.ts` re-checks the
   allowlist on every request rather than at sign-in. That is the property that
   lets a thing trusted with nothing still be useful.

   **Separate from `hint.ts`, and the reason is a measurement.** The two
   started as one file. `inline.ts` and `index.ts` have to write the marker, so
   they imported it; that made the hint's module both statically and
   dynamically imported, and rollup answered by handing the public page's gate
   a namespace shim — `.then(e=>e.t)` — on every client site, for nothing.
   Splitting the state from the surface takes it back off. */

/** The marker's key, on the site's own origin.

    Spelled a second time in `inline-gate.ts` rather than imported from here,
    and that is measured rather than sloppy: rollup will not fold a module into
    an entry chunk if a lazily imported chunk also imports it, so one shared
    const took the whole gate out of the public page's own script and gave
    every visitor a second file to fetch. `editor-hint.test.ts` reads the gate
    as text and fails if the two spellings drift, which is what the import was
    for. */
export const MARK = "sk-edit-here";

/** How long a device remembers, counted from the last time the server said
    yes rather than from the first.

    Long, because the point is that an owner types `/edit` once per phone. Not
    forever, because a device that simply stops being used should stop
    offering — and that is the *only* job the expiry has: revocation reaches
    the marker through a refused request, which happens on the revoked
    person's very next tap.

    iOS Safari's ITP deletes script-writable storage after seven days of
    Safari use without the site being visited as a first party, so on an
    iPhone the real number is often seven days rather than this one. That is
    acceptable and it is the honest description of what this buys: not "never
    type `/edit` again", but "type it once per device". */
const DAYS = 90;

/** Say that the server accepted this device, so the next visit can offer a way
    in. Called where a response came back, never where the client decided it
    should be. */
export function rememberEditor(): void {
  try {
    localStorage.setItem(MARK, String(Date.now() + DAYS * 86_400_000));
  } catch {
    /* Private browsing refuses localStorage. The owner keeps the way in they
       already had — typing `/edit` — which is the same outcome as never
       having had a marker. */
  }
}

/** Forget this device. */
export function forgetEditor(): void {
  try {
    localStorage.removeItem(MARK);
  } catch {
    /* Nothing was ever stored. */
  }
}

/** Whether this device's marker is still live, and clean it up if it is not.

    Asked here rather than in the gate, and that is worth 19 bytes on every
    visitor's page in the fleet: the gate asks only whether there is a marker
    at all. What it costs is a device whose marker has gone stale pulling one
    tiny chunk that renders nothing and deletes the marker on its way out —
    self-healing, and it happens on an owner's device, never a visitor's. */
export function editorRemembered(): boolean {
  let live = false;
  try {
    live = Number(localStorage.getItem(MARK)) > Date.now();
  } catch {
    /* Storage went away between the gate reading it and this being asked.
       Nothing to offer and nothing to clean up. */
    return false;
  }
  if (!live) forgetEditor();
  return live;
}

/** What a `/api/content` response says about this device.

    One place rather than four call sites each deciding, because the rule is
    the interesting part: **401 and 403 are the two refusals and both forget.**
    401 is "not signed in here", 403 is "signed in and not allowed here", and
    the second is the one that carries revocation. Everything else leaves the
    marker exactly as it was — a 409 is somebody else's commit landing first
    and a 503 is the site not being configured, and neither is a verdict about
    the person. */
export function noteEditorVerdict(status: number): void {
  if (status === 401 || status === 403) forgetEditor();
  else if (status < 400) rememberEditor();
}
