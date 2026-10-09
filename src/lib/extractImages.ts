import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import { encodePng, type RgbaImage } from "./pngEncode";

/** One image pulled out of the PDF, ready to be written to disk. */
export type ExtractedImage = {
  /** 0-based original page index the image was first seen on. */
  pageIndex: number;
  /** 1-based position among the images first seen on that page. */
  indexOnPage: number;
  ext: "jpg" | "png" | "jp2";
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type ExtractOptions = {
  /** Original page indices to scan, in output order. Default: every page. */
  pages?: number[];
  /** Skip images whose longest edge is below this many pixels (icons, rules). */
  minSize?: number;
};

export type ExtractResult = {
  images: ExtractedImage[];
  /** Images found but not exportable (CCITT/JBIG2 fax data, exotic colour spaces). */
  skipped: number;
};

const name = (s: string) => PDFName.of(s);

/** Filter names of a stream, in application order, without the leading "/". */
function filtersOf(dict: PDFDict, ctx: PDFContext): string[] {
  const entry = ctx.lookup(dict.get(name("Filter")) ?? dict.get(name("F")));
  if (entry instanceof PDFName) return [entry.decodeText()];
  if (entry instanceof PDFArray) {
    const out: string[] = [];
    for (let i = 0; i < entry.size(); i++) {
      const f = ctx.lookup(entry.get(i));
      if (f instanceof PDFName) out.push(f.decodeText());
    }
    return out;
  }
  return [];
}

function numberOf(ctx: PDFContext, obj: PDFObject | undefined, fallback: number): number {
  const v = ctx.lookup(obj);
  return v instanceof PDFNumber ? v.asNumber() : fallback;
}

// ---------------------------------------------------------------------------
// Colour spaces
// ---------------------------------------------------------------------------

type ColorSpace =
  | { kind: "gray" | "rgb" | "cmyk" }
  | {
      kind: "indexed";
      base: { kind: "gray" | "rgb" | "cmyk" };
      hival: number;
      /** `hival + 1` entries of `base` components, as raw bytes. */
      palette: Uint8Array;
    };

const COMPONENTS = { gray: 1, rgb: 3, cmyk: 4 } as const;

function resolveColorSpace(ctx: PDFContext, raw: PDFObject | undefined): ColorSpace | null {
  const cs = ctx.lookup(raw);
  if (cs instanceof PDFName) {
    switch (cs.decodeText()) {
      case "DeviceGray":
      case "G":
      case "CalGray":
        return { kind: "gray" };
      case "DeviceRGB":
      case "RGB":
      case "CalRGB":
        return { kind: "rgb" };
      case "DeviceCMYK":
      case "CMYK":
        return { kind: "cmyk" };
      default:
        return null;
    }
  }
  if (!(cs instanceof PDFArray) || cs.size() === 0) return null;

  const family = ctx.lookup(cs.get(0));
  if (!(family instanceof PDFName)) return null;
  switch (family.decodeText()) {
    case "CalGray":
      return { kind: "gray" };
    case "CalRGB":
      return { kind: "rgb" };
    case "ICCBased": {
      const profile = ctx.lookup(cs.get(1));
      const n = profile instanceof PDFRawStream ? numberOf(ctx, profile.dict.get(name("N")), 0) : 0;
      return n === 1
        ? { kind: "gray" }
        : n === 3
          ? { kind: "rgb" }
          : n === 4
            ? { kind: "cmyk" }
            : null;
    }
    case "Indexed":
    case "I": {
      const base = resolveColorSpace(ctx, cs.get(1));
      if (!base || base.kind === "indexed") return null;
      const hival = numberOf(ctx, cs.get(2), 255);
      const lookup = ctx.lookup(cs.get(3));
      let palette: Uint8Array | null = null;
      if (lookup instanceof PDFRawStream) palette = decodePDFRawStream(lookup).decode();
      else if (lookup instanceof PDFString || lookup instanceof PDFHexString) {
        palette = lookup.asBytes();
      }
      if (!palette) return null;
      const need = (hival + 1) * COMPONENTS[base.kind];
      if (palette.length < need) {
        // Short palettes happen in the wild; pad with zeros (black) rather than fail.
        const padded = new Uint8Array(need);
        padded.set(palette);
        palette = padded;
      }
      return { kind: "indexed", base, hival, palette };
    }
    default:
      return null;
  }
}

/** Convert one normalised (0–1) colour to 0–255 RGB. */
function toRgb(kind: "gray" | "rgb" | "cmyk", c: number[], out: number[]) {
  if (kind === "gray") {
    out[0] = out[1] = out[2] = c[0] * 255;
  } else if (kind === "rgb") {
    out[0] = c[0] * 255;
    out[1] = c[1] * 255;
    out[2] = c[2] * 255;
  } else {
    const k = 1 - c[3];
    out[0] = 255 * (1 - c[0]) * k;
    out[1] = 255 * (1 - c[1]) * k;
    out[2] = 255 * (1 - c[2]) * k;
  }
}

// ---------------------------------------------------------------------------
// Raster decoding
// ---------------------------------------------------------------------------

/** Read sample `index` of a row (`bpc` bits wide), as an integer. */
function readSample(row: Uint8Array, index: number, bpc: number): number {
  if (bpc === 8) return row[index];
  if (bpc === 16) return (row[index * 2] << 8) | row[index * 2 + 1];
  const bitPos = index * bpc;
  const shift = 8 - bpc - (bitPos & 7);
  return (row[bitPos >> 3] >> shift) & ((1 << bpc) - 1);
}

/** Alpha channel from an /SMask, resampled (nearest) to `w` x `h`; null if unusable. */
function decodeSoftMask(
  ctx: PDFContext,
  maskRef: PDFObject | undefined,
  w: number,
  h: number,
): Uint8Array | null {
  const mask = ctx.lookup(maskRef);
  if (!(mask instanceof PDFRawStream)) return null;
  const decoded = decodeRaster(ctx, mask, false);
  if (!decoded) return null;
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(decoded.height - 1, Math.floor((y * decoded.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(decoded.width - 1, Math.floor((x * decoded.width) / w));
      alpha[y * w + x] = decoded.rgba[(sy * decoded.width + sx) * 4]; // gray → R
    }
  }
  return alpha;
}

/**
 * Decode a flate/LZW/uncompressed image XObject to RGBA. Returns null for
 * anything unsupported (fax filters, Separation/Lab colour, malformed data).
 * Exported for tests.
 */
export function decodeRaster(
  ctx: PDFContext,
  stream: PDFRawStream,
  withSoftMask = true,
): RgbaImage | null {
  const dict = stream.dict;
  const width = numberOf(ctx, dict.get(name("Width")), 0);
  const height = numberOf(ctx, dict.get(name("Height")), 0);
  if (width <= 0 || height <= 0) return null;

  const maskFlag = ctx.lookup(dict.get(name("ImageMask")));
  const isMask = maskFlag instanceof PDFBool && maskFlag.asBoolean();
  const bpc = isMask ? 1 : numberOf(ctx, dict.get(name("BitsPerComponent")), 8);
  if (![1, 2, 4, 8, 16].includes(bpc)) return null;

  const cs: ColorSpace | null = isMask
    ? { kind: "gray" }
    : resolveColorSpace(ctx, dict.get(name("ColorSpace")) ?? dict.get(name("CS")));
  if (!cs) return null;

  let data: Uint8Array;
  try {
    data = decodePDFRawStream(stream).decode();
  } catch {
    return null; // an unsupported filter in the chain
  }

  const comps = cs.kind === "indexed" ? 1 : COMPONENTS[cs.kind];
  const rowBytes = Math.ceil((width * comps * bpc) / 8);
  if (data.length < rowBytes * height) return null;

  const maxSample = 2 ** bpc - 1;
  const decodeArr = ctx.lookup(dict.get(name("Decode")) ?? dict.get(name("D")));
  const dmin: number[] = [];
  const dmax: number[] = [];
  for (let c = 0; c < comps; c++) {
    const lo = decodeArr instanceof PDFArray ? numberOf(ctx, decodeArr.get(c * 2), 0) : 0;
    const hi = decodeArr instanceof PDFArray ? numberOf(ctx, decodeArr.get(c * 2 + 1), 1) : 1;
    // Indexed images default to [0 2^bpc-1]; an explicit array is applied below.
    dmin.push(lo);
    dmax.push(hi);
  }
  const explicitDecode = decodeArr instanceof PDFArray;

  const rgba = new Uint8ClampedArray(width * height * 4);
  const comp = Array.from({ length: comps }, () => 0);
  const rgb = [0, 0, 0];
  const baseKind = cs.kind === "indexed" ? cs.base.kind : cs.kind;
  const baseComps = COMPONENTS[baseKind];
  const entry = Array.from({ length: baseComps }, () => 0);

  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (isMask) {
        // Sample 0 paints (black) with the default Decode [0 1]; [1 0] flips it.
        const painted = (readSample(row, x, 1) === 0) !== (dmin[0] === 1);
        rgba[o + 3] = painted ? 255 : 0;
        continue;
      }
      if (cs.kind === "indexed") {
        let idx = readSample(row, x, bpc);
        if (explicitDecode) idx = Math.round(dmin[0] + (idx / maxSample) * (dmax[0] - dmin[0]));
        idx = Math.max(0, Math.min(cs.hival, idx));
        for (let c = 0; c < baseComps; c++) entry[c] = cs.palette[idx * baseComps + c] / 255;
        toRgb(baseKind, entry, rgb);
      } else {
        for (let c = 0; c < comps; c++) {
          const s = readSample(row, x * comps + c, bpc) / maxSample;
          comp[c] = dmin[c] + s * (dmax[c] - dmin[c]);
        }
        toRgb(cs.kind, comp, rgb);
      }
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = 255;
    }
  }

  let hasAlpha = isMask;
  if (withSoftMask && !isMask) {
    const alpha = decodeSoftMask(ctx, dict.get(name("SMask")), width, height);
    if (alpha) {
      for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = alpha[i];
      hasAlpha = true;
    }
  }
  return { width, height, rgba, hasAlpha };
}

// ---------------------------------------------------------------------------
// Page walk
// ---------------------------------------------------------------------------

type ImageRef = { ref: PDFRef; stream: PDFRawStream; pageIndex: number };

/** Image XObjects used by a resources dict, following Form XObjects. */
function collectImages(
  ctx: PDFContext,
  resources: PDFDict | undefined,
  pageIndex: number,
  seen: Set<PDFRef>,
  out: ImageRef[],
) {
  const xobjects = resources?.lookupMaybe(name("XObject"), PDFDict);
  if (!xobjects) return;
  for (const [, value] of xobjects.entries()) {
    if (!(value instanceof PDFRef) || seen.has(value)) continue;
    seen.add(value);
    const stream = ctx.lookup(value);
    if (!(stream instanceof PDFRawStream)) continue;
    const subtype = ctx.lookup(stream.dict.get(name("Subtype")));
    if (!(subtype instanceof PDFName)) continue;
    if (subtype.decodeText() === "Image") {
      out.push({ ref: value, stream, pageIndex });
    } else if (subtype.decodeText() === "Form") {
      collectImages(ctx, stream.dict.lookupMaybe(name("Resources"), PDFDict), pageIndex, seen, out);
    }
  }
}

/**
 * Extract the images the pages actually use. JPEG (DCT) and JPEG 2000 streams
 * are written out byte-for-byte, so they are the original, loss-free files;
 * everything else is decoded and saved as PNG (with its soft mask as alpha).
 */
export async function extractEmbeddedImages(
  pdfBytes: Uint8Array | ArrayBuffer,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const ctx = doc.context;
  const pages = doc.getPages();
  const order = (options.pages ?? pages.map((_, i) => i)).filter((i) => i >= 0 && i < pages.length);
  const minSize = options.minSize ?? 0;

  const found: ImageRef[] = [];
  const seen = new Set<PDFRef>();
  for (const pageIndex of order) {
    collectImages(ctx, pages[pageIndex].node.Resources(), pageIndex, seen, found);
  }

  const images: ExtractedImage[] = [];
  const perPage = new Map<number, number>();
  let skipped = 0;

  for (const { stream, pageIndex } of found) {
    const dict = stream.dict;
    const width = numberOf(ctx, dict.get(name("Width")), 0);
    const height = numberOf(ctx, dict.get(name("Height")), 0);
    if (Math.max(width, height) < minSize) continue;

    const filters = filtersOf(dict, ctx);
    let ext: ExtractedImage["ext"];
    let bytes: Uint8Array | null;
    if (filters.length === 1 && filters[0] === "DCTDecode") {
      ext = "jpg";
      bytes = stream.contents.slice();
    } else if (filters.length === 1 && filters[0] === "JPXDecode") {
      ext = "jp2";
      bytes = stream.contents.slice();
    } else {
      ext = "png";
      const decoded = decodeRaster(ctx, stream);
      bytes = decoded ? await encodePng(decoded) : null;
    }
    if (!bytes) {
      skipped++;
      continue;
    }
    const indexOnPage = (perPage.get(pageIndex) ?? 0) + 1;
    perPage.set(pageIndex, indexOnPage);
    images.push({ pageIndex, indexOnPage, ext, bytes, width, height });
  }
  return { images, skipped };
}
