/* The round trip between a page and the panel.
   ---------------------------------------------------------------------------
   An owner on a phone has exactly one way into inline editing today: type
   `?edit=1` onto the end of their own URL. That is not a thing anybody does on
   a phone keyboard, and it is the reason the whole inline layer has been
   reachable in principle and unreachable in practice.

   Three links close the loop, and all three are built here so the two surfaces
   agree about the spelling:

     page → panel   the bar's "sign in" carries where it came from
     page → panel   the bar's "Home" carries where it came from, and stays
     panel → page   after signing in, the panel goes straight back there, in
                    edit mode

   **`from` and `back` are two names for two intents and they are not
   interchangeable.** `from` means *"I only came here to sign in, send me
   back"*, and the panel acts on it before it renders a single control — a
   `location.replace` out of `start()`. `back` means *"show me the panel, and
   remember where I was"*. Home built on `from` would bounce an owner straight
   back to the page they just left, with the panel flashing once on the way,
   which is the whole of session 17 §2.3's warning.

   Both are URLs the browser will follow, and both arrive in the query string
   where anyone can put anything. So they are validated rather than trusted: a
   site-relative path, one leading slash, no scheme, no host. Without that,
   `/edit?from=https://example.com` is an open redirect wearing the editor's
   clothes — the owner taps a link on their own site and lands somewhere else,
   which is precisely the shape a phishing link wants. */

import { LANG_PARAM } from "./strings.js";

export const RETURN_PARAM = "from";
export const BACK_PARAM = "back";
export const EDIT_PARAM = "edit";
/** Where the tab remembers the answer, so an owner can navigate their own site
    while editing without `?edit=1` riding along in every link they might then
    copy. `inline-gate.ts` spells it a second time because nothing may import
    from that file — see its header, and `editor-hint.test.ts` for the test
    that holds the two spellings together. Bug #43 was this key spelled twice
    with nothing linking them at all, so a rename would have left "leave edit
    mode" writing to a key nobody reads and edit mode surviving the exit. */
export const EDIT_MODE = "sk-edit-mode";
/** How a refused hand-off says so. The callback in `cms/auth.ts` cannot put a
    reason in a body — it is a redirect — so it puts one here and the panel says
    it in the owner's own language. Values: `denied`, `down`, `failed`. */
export const AUTH_RESULT_PARAM = "sk_auth";
/** The fourth link, added in 0.17.0 for §2.5: *"show me how"* from the panel's
    welcome notice onto the owner's own page, with the tour armed. It is a
    separate parameter from `edit` because the two are separate facts — every
    later visit to the page is `edit=1` and is not a first run. */
export const TOUR_PARAM = "tour";

/* Control characters are dropped or normalised at different points by
   different browsers, which is how a `/\tjavascript:…` gets past a check that
   only read the first character. Nothing legitimate carries them. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The path to return to, or null for absent, absolute, or anything else that
    is not a plain site-relative path. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  /* One leading slash and no second one. `//host` is protocol-relative and
     goes off-site; a backslash is the same trick on the browsers that
     normalise it, and some do. */
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (CONTROL.test(raw)) return null;
  return raw;
}

/** Where the bar sends someone who needs to sign in: the panel, remembering
    the page they were on.

    `lang` because the page an owner is standing on is the best evidence there
    is about which language they read, and the panel has none of its own — one
    `/edit` serves both halves of a bilingual site. `strings.ts` has described
    `?lang=` as "which the bar's links to the panel carry" since 0.17.0's first
    step; this is the step where that stopped being a plan. */
export function signInHref(editorPath: string, returnTo: string, lang?: string): string {
  const safe = safeReturnPath(returnTo);
  return withParams(editorPath, [
    [RETURN_PARAM, safe],
    [LANG_PARAM, lang]
  ]);
}

/** Where the bar's Home goes: the panel itself, remembering the page rather
    than being a way off it — and, where the owner tapped a particular sentence
    to get here, naming the field they were pointing at.

    The field rides in the panel's own hash rather than in a third parameter.
    It is not a place the browser goes and it is not something the panel hands
    to `location`; it is which control to open once the form is on screen, and
    a fragment is what a fragment is for. `back`'s own hash — an owner two
    thirds down a long page — survives inside the encoded value. */
export function panelHref(
  editorPath: string,
  options: { back?: string | null; lang?: string; field?: string } = {}
): string {
  const href = withParams(editorPath, [
    [BACK_PARAM, safeReturnPath(options.back)],
    [LANG_PARAM, options.lang]
  ]);
  return options.field ? `${href}#${encodeURIComponent(options.field)}` : href;
}

function withParams(base: string, pairs: [string, string | null | undefined][]): string {
  const params = new URLSearchParams();
  for (const [name, value] of pairs) if (value) params.set(name, value);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** The field the panel was asked to open, read off its own hash.

    Matched against what a field path can be rather than trusted, and that is
    not belt-and-braces: this ends up inside a `[data-path="…"]` selector, and
    `#` is also where every other anchor on the internet lives. A hash that is
    somebody's `#contact` is not a field and should quietly not be one. */
export function fieldFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  let raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* A lone `%` — not a path, and not worth a second theory about. */
    return null;
  }
  return /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(raw) ? raw : null;
}

/** The same page, in edit mode. Built by hand rather than through `URL` so it
    stays relative — the panel and the bar both hand this straight to an
    anchor or to `location`.

    `tour` arms §2.5's first run on arrival. One builder rather than a second
    one, so the spelling of both parameters lives in exactly one place; the bar
    strips them both off `herePath()` on the way back, and a URL carrying two
    `edit=1`s is not one an owner could have arrived at by hand. */
export function editHref(path: string, options: { tour?: boolean } = {}): string {
  const safe = safeReturnPath(path);
  if (!safe) return "/";
  const [before, hash] = splitHash(safe);
  const joiner = before.includes("?") ? "&" : "?";
  const tour = options.tour ? `&${TOUR_PARAM}=1` : "";
  return `${before}${joiner}${EDIT_PARAM}=1${tour}${hash ? `#${hash}` : ""}`;
}

/** Whether this page was arrived at with the tour armed.

    Read off `location.search` by the caller rather than from `location` here, so
    the rule is testable without a browser — and it is a rule rather than a
    lookup: anything other than `1` is not an arming, because a `tour=0` that
    armed a tour would be the worst kind of surprise.

    The parameter is spent on arrival — `inline.ts` takes it off the URL with
    `replaceState` the moment it has read it. Left there, a reload would re-arm
    the tour forever and "dismissed stays dismissed across reloads" would be
    true of the flag and false of the thing an owner actually experiences. */
export function tourArmed(search: string | null | undefined): boolean {
  if (!search) return false;
  return new URLSearchParams(search).get(TOUR_PARAM) === "1";
}

function splitHash(path: string): [string, string] {
  const at = path.indexOf("#");
  return at < 0 ? [path, ""] : [path.slice(0, at), path.slice(at + 1)];
}
