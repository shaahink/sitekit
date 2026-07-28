/* Photographs on their way into a repository.
   ---------------------------------------------------------------------------
   The panel encodes a picture in the browser and posts it as a JPEG data URL.
   Everything here is what stands between that and a commit, and the shape of
   it is deliberate in one respect above all:

   **the client never names a repository path.** It sends `{id, name, dataUrl}`
   and refers to the result from its edits as the literal string `upload:<id>`,
   which this substitutes once the destination is known. The alternative —
   letting the browser say where the file goes — is a write-anywhere primitive
   handed to whatever can reach a signed-in session, and no amount of path
   validation afterwards is as good as never accepting one.

   The name still travels, because `git log` on a client's site should say what
   changed and `IMG_4032` does not. It is slugged, capped, and followed by a
   hash of the bytes, so two owners uploading two different photographs called
   "portrait" get two files rather than one of them silently replacing the
   other. */

const JPEG = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;

export interface Upload {
  id: string;
  name?: string;
  dataUrl: string;
}

export interface PreparedUpload {
  id: string;
  /** Repository-relative. */
  path: string;
  /** What the content file holds — the path as the browser will ask for it. */
  url: string;
  base64: string;
  bytes: number;
}

export interface UploadLimits {
  /** Per file. Default 1.5 MB, comfortably above what the panel encodes to. */
  maxBytes?: number;
  /** Per save, across every file. Default 8 MB. */
  maxTotalBytes?: number;
  /** Per save. Default 12. */
  maxFiles?: number;
}

export class UploadError extends Error {}

/** Validate, name and place every upload in one save.

    `dir` is repository-relative and must sit under the site's public
    directory; the URL written into the content is that path with its first
    segment removed, which is Astro's rule for `public/`. */
export async function prepareUploads(
  uploads: unknown,
  dir: string,
  limits: UploadLimits = {}
): Promise<PreparedUpload[]> {
  if (uploads === undefined || uploads === null) return [];
  if (!Array.isArray(uploads)) throw new UploadError("Malformed request.");

  const maxBytes = limits.maxBytes ?? 1_500_000;
  const maxTotal = limits.maxTotalBytes ?? 8_000_000;
  const maxFiles = limits.maxFiles ?? 12;

  if (uploads.length > maxFiles) {
    throw new UploadError(`That's more than ${maxFiles} pictures at once — try a few at a time.`);
  }

  const out: PreparedUpload[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const raw of uploads as Upload[]) {
    const id = typeof raw?.id === "string" ? raw.id : "";
    /* The id is only ever compared against the placeholder text in an edit, so
       it is kept to characters that cannot mean anything else in one. */
    if (!/^[a-z0-9-]{1,64}$/i.test(id)) throw new UploadError("Malformed request.");
    if (seen.has(id)) throw new UploadError("Malformed request.");
    seen.add(id);

    const match = JPEG.exec(typeof raw?.dataUrl === "string" ? raw.dataUrl : "");
    /* Not a helpful message on purpose in the shape sense, but an honest one:
       the panel only ever produces JPEG, so anything else arriving here is
       either a browser that fell back to PNG behind our backs — the iOS trap —
       or something that is not the panel. */
    if (!match) throw new UploadError("That file isn't a JPEG the editor can use.");
    const base64 = match[1] as string;

    const bytes = base64Bytes(base64);
    if (bytes > maxBytes) throw new UploadError("That picture is too big, even after shrinking.");
    total += bytes;
    if (total > maxTotal) throw new UploadError("That's too much to save at once — try a few at a time.");

    const hash = await shortHash(base64);
    const file = `${slug(typeof raw?.name === "string" ? raw.name : "")}-${hash}.jpg`;
    const path = `${dir.replace(/^\/+|\/+$/g, "")}/${file}`;
    out.push({ id, path, url: publicUrl(path), base64, bytes });
  }

  return out;
}

/** Replace every `upload:<id>` in an edit's value with the path the file
    landed at. Values are walked rather than compared, because a new gallery
    row arrives as a whole array with the placeholder somewhere inside it.

    An unknown id is an error rather than a value left as it is: writing the
    literal text `upload:a1` into somebody's `src` would commit a broken image
    that looks like content. */
export function resolveUploads(value: unknown, uploads: PreparedUpload[]): unknown {
  if (typeof value === "string") {
    const match = /^upload:([a-z0-9-]{1,64})$/i.exec(value);
    if (!match) return value;
    const found = uploads.find((upload) => upload.id === match[1]);
    if (!found) throw new UploadError("Malformed request.");
    return found.url;
  }
  if (Array.isArray(value)) return value.map((item) => resolveUploads(item, uploads));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveUploads(child, uploads);
    }
    return out;
  }
  return value;
}

/** `public/images/rooms/a.jpg` → `/images/rooms/a.jpg`.

    Astro serves everything under `publicDir` from the site root, so the URL is
    the path with that first segment dropped. A `dir` that is not under a
    public directory would produce a URL for a file the site never serves,
    which is why CollectionConfig says so and CMS.md repeats it. */
function publicUrl(path: string): string {
  const parts = path.split("/");
  return `/${parts.slice(1).join("/")}`;
}

function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Eight hex characters of SHA-256 over the encoded bytes. Long enough that a
    collision in one site's image directory is not a thing that happens, short
    enough that the filename still reads as a name. Web Crypto, so §3.4 holds
    and this runs unchanged on Cloudflare. */
async function shortHash(base64: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base64));
  return [...new Uint8Array(digest).slice(0, 4)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function slug(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  const out = stem
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  /* Persian and Arabic filenames slug away to nothing, and half the fleet's
     owners have them. The hash is what makes the file findable; this is only
     the readable half. */
  return out || "image";
}
