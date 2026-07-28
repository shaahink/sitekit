/* Turning a photograph off a phone into something committable.
   ---------------------------------------------------------------------------
   A picture straight off a camera roll is 3–6 MB, and the owner is on a bus.
   This scales it, encodes it, and reports what came out — including the pixel
   size, because every image schema in the fleet requires `w` and `h` and the
   layouts hold their shape while a photograph loads by knowing them in
   advance. The canvas knows both already; nothing here measures anything
   twice.

   **The encoded type is checked, not requested.** `canvas.toDataURL` is
   specified to fall back to `image/png` when it cannot encode what it was
   asked for — silently. So a request for WebP on an iPhone yields a PNG, and
   a 200 KB commit becomes a 4 MB one on the device most likely to be used.
   Nothing here asks for anything but JPEG, which ought to make that
   unreachable; it is asserted anyway, because a silent fallback is precisely
   the failure that "ought to" does not catch.

   Why this is not `widget/image.ts`, which does nearly the same thing: the
   widget ships on public pages and is compiled at ES2017 to reach as many
   visitors as the sites themselves do, while the editor is one signed-in
   owner's admin tool at ES2020. They are two TypeScript programs with
   different floors and different output paths, and sharing the file would
   mean one of the two builds overwriting the other's emit. Forty lines is the
   cheaper of the two prices. */

export interface Shrunk {
  /** `data:image/jpeg;base64,…`, asserted. */
  dataUrl: string;
  width: number;
  height: number;
  /** Bytes the commit will carry, so a ceiling can be enforced in the
      interface rather than discovered by a 502. */
  bytes: number;
}

export interface ShrinkImageOptions {
  /** Longest edge after scaling. 1600 covers every layout in the fleet at
      2× on a phone and 1× on a laptop. */
  maxSide?: number;
  quality?: number;
  qualityStep?: number;
  minQuality?: number;
  /** Largest acceptable encoded size in bytes. GitHub's blob API takes far
      more than this; the limit is what a JSON POST carries comfortably over a
      phone connection. */
  maxBytes?: number;
}

export class TooBigError extends Error {}
export class NotJpegError extends Error {}
export class DecodeError extends Error {}

export async function shrinkImage(file: Blob, options: ShrinkImageOptions = {}): Promise<Shrunk> {
  const maxSide = options.maxSide ?? 1600;
  const startQuality = options.quality ?? 0.82;
  const qualityStep = options.qualityStep ?? 0.12;
  const minQuality = options.minQuality ?? 0.4;
  const maxBytes = options.maxBytes ?? 1_000_000;

  const bitmap = await decode(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new DecodeError("no 2d context");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ("close" in bitmap) bitmap.close();

  let quality = startQuality;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (byteLength(out) > maxBytes && quality > minQuality) {
    quality -= qualityStep;
    out = canvas.toDataURL("image/jpeg", quality);
  }

  if (!isJpegDataUrl(out)) throw new NotJpegError("the browser encoded something other than JPEG");
  const bytes = byteLength(out);
  if (bytes > maxBytes) throw new TooBigError("still too big at minimum quality");

  return { dataUrl: out, width: canvas.width, height: canvas.height, bytes };
}

/** What the base64 payload weighs, not what the string does. Four characters
    carry three bytes, and the padding is not data. */
export function byteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const body = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

export function isJpegDataUrl(value: string): boolean {
  return /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value);
}

/** A filename an owner would recognise in a repository, out of one they chose
    on a phone. Not unique on its own — the handler adds a hash — but the
    readable half of the name is worth keeping: `git log` on a client's site
    should say what changed, and `IMG_4032.HEIC` says nothing that
    `garden-terrace` doesn't say better. */
export function slugFrom(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  const slug = stem
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  /* Persian and Arabic filenames slug away to nothing, and half the fleet's
     owners have them. "image" beats an empty name, and the hash after it is
     what makes the file findable anyway. */
  return slug || "image";
}

function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  /* Typed as always-present, but a decode can still throw on a format the
     browser will not take — HEIC on a desktop Chrome, most often — so the
     element fallback is a real path, not insurance. */
  if (typeof window.createImageBitmap === "function") {
    return createImageBitmap(file).catch(() => viaElement(file));
  }
  return viaElement(file);
}

function viaElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new DecodeError("the browser could not read that file"));
    };
    image.src = url;
  });
}
