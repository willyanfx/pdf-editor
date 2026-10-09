import { loadPdfDocument } from "./pdfOptions";

export type ImageFormat = "png" | "jpeg";

export type PageImageOptions = {
  format: ImageFormat;
  /** Output resolution; a PDF point is 1/72", so scale = dpi / 72. */
  dpi: number;
  /** JPEG quality, 0–1. Ignored for PNG. */
  quality: number;
};

export const DPI_CHOICES = [72, 150, 300] as const;

/** Browsers refuse (or silently blank) canvases past these limits. */
const MAX_EDGE_PX = 16384;
const MAX_PIXELS = 50_000_000;

/**
 * The render scale for a page of `widthPt` x `heightPt` points at `dpi`,
 * reduced when the result would exceed what a canvas can hold. `clamped` says
 * the user's requested resolution wasn't fully honoured.
 */
export function pageImageScale(
  widthPt: number,
  heightPt: number,
  dpi: number,
): { scale: number; clamped: boolean } {
  const wanted = dpi / 72;
  const byEdge = MAX_EDGE_PX / Math.max(widthPt, heightPt);
  const byArea = Math.sqrt(MAX_PIXELS / (widthPt * heightPt));
  const scale = Math.min(wanted, byEdge, byArea);
  return { scale, clamped: scale < wanted };
}

/** `<base>-page-<n>.<ext>`, zero-padded to `digits` so files sort in page order. */
export function pageImageName(
  base: string,
  pageNumber: number,
  digits: number,
  format: ImageFormat,
): string {
  const padded = String(pageNumber).padStart(digits, "0");
  return `${base}-page-${padded}.${format === "png" ? "png" : "jpg"}`;
}

export type RenderedPage = {
  /** 1-based page number within `pdfBytes`. */
  pageNumber: number;
  blob: Blob;
};

/**
 * Rasterise every page of `pdfBytes` (the edited, redacted export — so the
 * image is what the downloaded PDF looks like). Returns the encoded images and
 * whether any page had to be rendered below the requested resolution.
 */
export async function renderPdfPages(
  pdfBytes: Uint8Array,
  options: PageImageOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<{ pages: RenderedPage[]; clamped: boolean }> {
  const loadingTask = await loadPdfDocument(pdfBytes.slice());
  const pages: RenderedPage[] = [];
  let clamped = false;
  try {
    const doc = await loadingTask.promise;
    const mime = options.format === "png" ? "image/png" : "image/jpeg";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const fit = pageImageScale(base.width, base.height, options.dpi);
      clamped ||= fit.clamped;
      const viewport = page.getViewport({ scale: fit.scale });

      const canvas = document.createElement("canvas");
      // round, not ceil: 792pt at 150 DPI is 1650.0000001px in floating point,
      // and ceil would add a blank row to every page.
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no-canvas");
      // PDF pages have no paper colour of their own; JPEG has no alpha at all.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // intent "print" renders without requestAnimationFrame, which never fires
      // in a hidden tab and would hang the export if the user switches away.
      await page.render({ canvas, viewport, intent: "print" }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mime, options.quality),
      );
      // Free the pixel buffer now rather than waiting for GC on large exports.
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      if (!blob) throw new Error("encode-failed");
      pages.push({ pageNumber: i, blob });
      onProgress?.(i, doc.numPages);
    }
  } finally {
    await loadingTask.destroy();
  }
  return { pages, clamped };
}
