/* Image downscaling.
   ---------------------------------------------------------------------------
   Phone screenshots are 3–6 MB. Squeeze to something a JSON POST can carry
   without pulling in a library. */

export interface ShrinkOptions {
  /** Longest edge after scaling. Default 1600. */
  maxSide?: number;
  /** Starting JPEG quality. Default 0.82. */
  quality?: number;
  /** Quality is stepped down by this much until the image fits. Default 0.12. */
  qualityStep?: number;
  /** Give up below this quality. Default 0.4. */
  minQuality?: number;
  /** Largest acceptable data-URL length. Default 1_400_000 — what a 3 MB
      JSON POST can carry once the rest of the payload is counted. */
  maxLength?: number;
}

/** Downscale + recompress to a JPEG data URL.

    **The type is checked rather than requested.** `canvas.toDataURL` is
    specified to fall back to `image/png` when it cannot encode what it was
    asked for, silently — so asking for WebP on an iPhone yields a PNG, and a
    200 KB upload becomes a 4 MB one on the device most likely to be used. This
    only ever asks for JPEG, which makes the fallback unreachable in theory; it
    is asserted anyway, because "in theory" is exactly what a silent fallback
    defeats.

    Rejects with Error("too big") when even minimum quality won't fit, and
    Error("not jpeg") if the browser produced something else — the caller owns
    the wording either way. */
export function shrink(file: Blob, options: ShrinkOptions = {}): Promise<string> {
  const maxSide = options.maxSide || 1600;
  const startQuality = options.quality || 0.82;
  const qualityStep = options.qualityStep || 0.12;
  const minQuality = options.minQuality || 0.4;
  const maxLength = options.maxLength || 1_400_000;

  return decode(file).then(function (bitmap) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx2d = canvas.getContext("2d")!;
    ctx2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if ("close" in bitmap) bitmap.close();

    let quality = startQuality;
    let out = canvas.toDataURL("image/jpeg", quality);
    while (out.length > maxLength && quality > minQuality) {
      quality -= qualityStep;
      out = canvas.toDataURL("image/jpeg", quality);
    }
    if (out.length > maxLength) throw new Error("too big");
    if (!/^data:image\/jpeg;base64,/.test(out)) throw new Error("not jpeg");
    return out;
  });
}

function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  /* Typed as always-present, but the browsers this widget still serves
     include ones without it — hence typeof, not truthiness. */
  if (typeof window.createImageBitmap === "function") {
    return createImageBitmap(file).catch(function () { return viaElement(file); });
  }
  return viaElement(file);
}

function viaElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}
