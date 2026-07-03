/**
 * Compression presets and option types, in their own dependency-free module so
 * UI code (CompressDialog) can import them statically without pulling
 * pdf-lib/fontkit into the initial chunk — the heavy compression code in
 * exportPdf.ts stays behind a dynamic import.
 */

export type CompressPreset = "lossless" | "screen" | "ebook" | "printer" | "prepress" | "custom";

export type CompressOptions = {
  preset: CompressPreset;
  /** "selective": re-encode only raster image XObjects; preserve text + vectors.
   *  "rasterize": render every page to JPEG (legacy, maximum reduction). */
  mode: "selective" | "rasterize";
  /** Maximum pixel dimension (longest edge) for downsampled images. */
  targetPx: number;
  /** JPEG re-encode quality, 0..1. */
  quality: number;
  /** Convert RGB images to grayscale before re-encoding. */
  grayscale: boolean;
  /** Strip /Metadata XMP stream and trailer /Info dict from output. */
  stripMetadata: boolean;
};

export const COMPRESS_PRESETS: Record<Exclude<CompressPreset, "custom">, CompressOptions> = {
  lossless: {
    preset: "lossless",
    mode: "selective",
    targetPx: 99_999,
    quality: 1.0,
    grayscale: false,
    stripMetadata: false,
  },
  screen: {
    preset: "screen",
    mode: "selective",
    targetPx: 1240,
    quality: 0.55,
    grayscale: false,
    stripMetadata: true,
  },
  ebook: {
    preset: "ebook",
    mode: "selective",
    targetPx: 1700,
    quality: 0.72,
    grayscale: false,
    stripMetadata: false,
  },
  printer: {
    preset: "printer",
    mode: "selective",
    targetPx: 2480,
    quality: 0.88,
    grayscale: false,
    stripMetadata: false,
  },
  prepress: {
    preset: "prepress",
    mode: "selective",
    targetPx: 3508,
    quality: 0.95,
    grayscale: false,
    stripMetadata: false,
  },
};
