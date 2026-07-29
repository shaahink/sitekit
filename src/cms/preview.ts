/* Showing an owner the photograph they are about to replace.
   ---------------------------------------------------------------------------
   The picker put the stored `src` straight into an `<img src>`, which works
   for every site whose pictures live in `public/` and fails completely for
   nimagiti, where the content says `/src/assets/images/hero-teal.jpg` and
   `astro:assets` resolves that at build time into a hashed file under
   `/_astro/`. No server ever serves the stored path, so all five of his image
   controls drew a 2px broken-image hairline where the photograph should be —
   measured in a real browser, 09.6. The control still worked; it just could
   not show what it was about to overwrite, which is the one thing a picker is
   for.

   The fix cannot be a build-time lookup: the panel is a static page and the
   handler is a function, and neither of them can see Astro's asset manifest.
   But the handler *can* see the repository — it is already reading the YAML
   through the contents API with the App's token — and the file the content
   points at is in there. So the preview is served from the repository, behind
   the same session as everything else on this route, and a site declares
   nothing: the shape of the stored value says where to look.

   Two spellings, because the fleet has two. A leading slash is repo-root
   relative on a site using `astro:assets` (`/src/assets/...`) and
   `public/`-relative on a site that serves its pictures statically
   (`/images/uploads/x.jpg` is `public/images/uploads/x.jpg` — uploads.ts
   writes exactly that translation in the other direction). Both are tried,
   root first, because that is the one no other rule can produce. A relative
   path is relative to the content file, which is what `astro:assets` means by
   `../../assets/x.jpg` and what a `..` must therefore be allowed to do —
   though never past the top of the repository.

   Nothing here trusts a caller with a path. The handler only ever asks for the
   value of an image *field*, read out of the site's own content, so the set of
   files this can reach is exactly the set of pictures the panel is showing. */

/** What an `<img>` can be given for a stored `src`, most likely first. Empty
    when there is nothing the repository could add: an absolute URL the browser
    has already tried, a data URI, an unsaved upload token, or a path that
    climbs out of the repository. */
export function previewPaths(src: string, entryPath: string): string[] {
  const value = src.trim();
  if (!value) return [];
  /* A scheme, a protocol-relative host, or one of the panel's own tokens.
     Nothing in the repository is a better answer than what it already says. */
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return [];

  if (value.startsWith("/")) {
    const bare = normalise(value.slice(1));
    return bare ? [bare, `public/${bare}`] : [];
  }

  const dir = entryPath.includes("/") ? entryPath.slice(0, entryPath.lastIndexOf("/")) : "";
  const joined = normalise(dir ? `${dir}/${value}` : value);
  return joined ? [joined] : [];
}

/** The type to serve a repository file as, or null when the extension is not
    a picture's. This is a guard and not a convenience: it is what keeps the
    route from becoming a way to read arbitrary files out of a private
    repository as long as some image field happens to point at one. */
export function imageType(path: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  switch (match?.[1]?.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "svg":
      /* Served with its own `default-src 'none'` policy by the handler: an SVG
         is a document, and this one comes off the site's own origin. */
      return "image/svg+xml";
    default:
      return null;
  }
}

/** `a/./b`, `a/b/../c` and `//` resolved by hand — `node:path` is a Node
    built-in and this file runs at a Cloudflare edge too (PLAN §3.4). Empty
    when the path climbs above the repository root, which is a refusal rather
    than a clamp. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!out.length) return "";
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}
