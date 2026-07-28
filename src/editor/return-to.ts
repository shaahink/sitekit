/* The round trip between a page and the panel.
   ---------------------------------------------------------------------------
   An owner on a phone has exactly one way into inline editing today: type
   `?edit=1` onto the end of their own URL. That is not a thing anybody does on
   a phone keyboard, and it is the reason the whole inline layer has been
   reachable in principle and unreachable in practice.

   Two links close the loop, and both are built here so the two surfaces agree
   about the spelling:

     page → panel   the bar's "sign in" carries where it came from
     panel → page   after signing in, the panel goes straight back there, in
                    edit mode

   `from` is a URL the browser will follow, and it arrives in the query string
   where anyone can put anything. So it is validated rather than trusted: a
   site-relative path, one leading slash, no scheme, no host. Without that,
   `/edit?from=https://example.com` is an open redirect wearing the editor's
   clothes — the owner taps a link on their own site and lands somewhere else,
   which is precisely the shape a phishing link wants. */

export const RETURN_PARAM = "from";
export const EDIT_PARAM = "edit";

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
    the page they were on. */
export function signInHref(editorPath: string, returnTo: string): string {
  const safe = safeReturnPath(returnTo);
  if (!safe) return editorPath;
  return `${editorPath}?${RETURN_PARAM}=${encodeURIComponent(safe)}`;
}

/** The same page, in edit mode. Built by hand rather than through `URL` so it
    stays relative — the panel and the bar both hand this straight to an
    anchor or to `location`. */
export function editHref(path: string): string {
  const safe = safeReturnPath(path);
  if (!safe) return "/";
  const [before, hash] = splitHash(safe);
  const joiner = before.includes("?") ? "&" : "?";
  return `${before}${joiner}${EDIT_PARAM}=1${hash ? `#${hash}` : ""}`;
}

function splitHash(path: string): [string, string] {
  const at = path.indexOf("#");
  return at < 0 ? [path, ""] : [path.slice(0, at), path.slice(at + 1)];
}
