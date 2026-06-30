/**
 * Remove the (light/paper) background from a signature image so only the ink
 * remains, on a transparent background — entirely client-side, no model download.
 *
 * A photographed or scanned signature is dark ink on a light, often uneven,
 * paper. We key out the paper by luminance: bright pixels become transparent,
 * dark pixels (the ink) stay opaque. Crucially we don't hard-threshold — that
 * would jaggedly clip the anti-aliased edges of every stroke. Instead alpha
 * ramps smoothly across a band below the threshold, so faint stroke fringes are
 * preserved as partial transparency and the signature keeps its natural shape.
 *
 * The kept ink is also re-colored to a uniform dark tone (`inkColor`) so a
 * yellowed/blue-pen photo reads as a clean signature, while its alpha (and thus
 * stroke weight) comes from how dark the original pixel was.
 */

export type RemoveBgOptions = {
  /**
   * Luminance cutoff in [0,1]. Pixels brighter than this are fully transparent;
   * the softness band sits just below it. Higher = removes more (good for dingy
   * paper); lower = keeps more (good for faint pencil). Default tuned for white
   * paper photos.
   */
  threshold?: number;
  /** Width of the soft alpha ramp below the threshold, in [0,1]. */
  softness?: number;
  /** Hex color the surviving ink is recolored to. Default near-black ink. */
  inkColor?: string;
  /**
   * Stroke contrast boost in [0,1]. 0 keeps the natural per-pixel alpha; higher
   * values pull faint/partial ink toward fully opaque so a light or scanned
   * signature reads as a clean, dark line. Applied as a gamma curve on alpha so
   * solid ink stays solid and only the faint mid-tones are darkened. Default is a
   * mild auto-boost.
   */
  contrast?: number;
};

const DEFAULTS: Required<RemoveBgOptions> = {
  threshold: 0.6,
  softness: 0.25,
  inkColor: "#111827",
  contrast: 0.35,
};

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [17, 24, 39];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Load a data URL (or any image URL) into an HTMLImageElement. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the image."));
    img.src = src;
  });
}

/**
 * Process an already-loaded ImageData in place: paper → transparent, ink kept
 * (recolored, alpha by darkness). Exported so the live preview can reuse the
 * decoded source without re-loading the image on every slider tweak.
 */
export function keyOutBackground(data: ImageData, options: RemoveBgOptions = {}): ImageData {
  const { threshold, softness, inkColor, contrast } = { ...DEFAULTS, ...options };
  const [ir, ig, ib] = hexToRgb(inkColor);
  const px = data.data;
  // Edge of the soft band; clamp so a tiny softness still yields a valid range.
  const lo = Math.max(0, threshold - Math.max(softness, 0.001));
  const hi = threshold;
  // Contrast → gamma exponent < 1, which lifts partial alpha toward 1 (darker,
  // crisper strokes) while leaving 0 and 1 fixed. contrast 0 → gamma 1 (no-op).
  const gamma = 1 / (1 + Math.max(0, Math.min(1, contrast)) * 3);

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const srcA = px[i + 3] / 255;
    // Perceptual luminance in [0,1].
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // alpha: 1 at/below lo (solid ink), 0 at/above hi (paper), ramped between.
    let alpha: number;
    if (lum <= lo) alpha = 1;
    else if (lum >= hi) alpha = 0;
    else alpha = 1 - (lum - lo) / (hi - lo);

    if (alpha > 0 && alpha < 1 && gamma !== 1) alpha = Math.pow(alpha, gamma);

    px[i] = ir;
    px[i + 1] = ig;
    px[i + 2] = ib;
    px[i + 3] = Math.round(alpha * srcA * 255);
  }
  return data;
}

/**
 * Find the tight bounding box of visible ink (alpha above a small floor) in an
 * already-keyed ImageData. Returns null when the image is effectively empty.
 * Used to auto-crop a signature to just its strokes, dropping surrounding paper.
 */
export function detectInkBounds(
  data: ImageData,
  alphaFloor = 8,
): { x: number; y: number; width: number; height: number } | null {
  const { width, height } = data;
  const px = data.data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > alphaFloor) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Crop an ImageData to a rectangle (clamped to bounds), returning a new buffer. */
export function cropImageData(
  data: ImageData,
  rect: { x: number; y: number; width: number; height: number },
): ImageData {
  const sx = Math.max(0, Math.floor(rect.x));
  const sy = Math.max(0, Math.floor(rect.y));
  const sw = Math.max(1, Math.min(data.width - sx, Math.round(rect.width)));
  const sh = Math.max(1, Math.min(data.height - sy, Math.round(rect.height)));
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const srcStart = ((sy + y) * data.width + sx) * 4;
    out.set(data.data.subarray(srcStart, srcStart + sw * 4), y * sw * 4);
  }
  return new ImageData(out, sw, sh);
}

/** Decode a data URL into ImageData (natural pixel size). */
export async function decodeToImageData(
  src: string,
): Promise<{ imageData: ImageData; width: number; height: number }> {
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { imageData: ctx.getImageData(0, 0, w, h), width: w, height: h };
}

/** Encode ImageData back to a PNG data URL. */
export function imageDataToPngDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * One-shot: take any image data URL, remove its background, return a transparent
 * PNG data URL. Cloning the source ImageData keeps the original reusable for
 * re-processing at a different threshold.
 */
export async function removeSignatureBackground(
  src: string,
  options: RemoveBgOptions = {},
): Promise<string> {
  const { imageData } = await decodeToImageData(src);
  const copy = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
  return imageDataToPngDataUrl(keyOutBackground(copy, options));
}
