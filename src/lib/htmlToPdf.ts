import { PDFDocument } from "pdf-lib";
import { useToastStore } from "../store/useToastStore";

/**
 * HTML → PDF conversion, fully client-side.
 *
 * The browser itself is the layout engine: the HTML is rendered in a hidden
 * same-origin `srcdoc` iframe (remote stylesheets and web fonts load through
 * the normal network pipeline), rasterized with html2canvas-pro, sliced into
 * A4-height strips, and embedded as JPEG pages via pdf-lib. Output is
 * raster-only — a selectable-text pass would need a server-grade layout
 * engine, which a static GitHub Pages deployment doesn't have.
 *
 * The pipeline is two deliberately separate stages so a future selectable-text
 * backend can replace the raster path without a rewrite:
 *   1. renderHtmlToCanvas()      — HTML string → one tall capture canvas
 *   2. assemblePdfWithinBudget() — capture canvas → A4-paged PDF bytes
 */

/** A4 in PDF points and in CSS pixels at 96 DPI. */
export const A4_PT = { width: 595.28, height: 841.89 } as const;
export const A4_PX = { width: 794, height: 1123 } as const;

const CAPTURE_SCALE = 2;
const JPEG_QUALITY = 0.88;
/** Re-encode quality used when the assembled PDF exceeds the size budget. */
const FALLBACK_JPEG_QUALITY = 0.6;
/** Size budget for one converted HTML file (inserting several compounds fast). */
export const MAX_HTML_PDF_BYTES = 20 * 1024 * 1024;

/** 1×1 transparent PNG substituted for images whose fetch is CORS-blocked. */
const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Block-ish leaf elements the page-break pass may push to the next page. */
const BREAKABLE_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,img,table,pre,blockquote,figure";

/** Convert one .html file into A4 PDF bytes. */
export async function htmlToPdf(file: File): Promise<Uint8Array> {
  const html = await file.text();
  const toast = (message: string) => useToastStore.getState().addToast(message, "info");

  const { canvas, blockedImages, scaleReduced } = await renderHtmlToCanvas(html);
  if (scaleReduced) {
    toast("This HTML file is very long — export quality was reduced.");
  }
  if (blockedImages.length > 0) {
    toast(
      blockedImages.length === 1
        ? "1 image couldn't be loaded (blocked by CORS) and was left out."
        : `${blockedImages.length} images couldn't be loaded (blocked by CORS) and were left out.`,
    );
  }

  const { bytes, recompressed, overBudget } = await assemblePdfWithinBudget(canvas);
  if (overBudget) {
    const mb = Math.round(bytes.byteLength / 1024 / 1024);
    toast(`The converted PDF is large (~${mb} MB) — use Compress to shrink it further.`);
  } else if (recompressed) {
    toast("Converted PDF was large — image quality was reduced to keep the file size down.");
  }
  return bytes;
}

/**
 * Stage 1: render an HTML string into one tall capture canvas.
 *
 * `scaleReduced` is true when the 2× capture failed (very long documents can
 * exceed the browser's canvas area limit) and the 1× retry was used instead.
 * `blockedImages` lists the image URLs that were CORS-blocked and replaced by
 * a transparent placeholder.
 */
export async function renderHtmlToCanvas(
  html: string,
): Promise<{ canvas: HTMLCanvasElement; blockedImages: string[]; scaleReduced: boolean }> {
  const iframe = document.createElement("iframe");
  // Same-origin so we can walk contentDocument, but never execute the user's
  // scripts inside the app's origin. JS-driven pages are a documented
  // limitation of the converter, not a rendering bug.
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.style.cssText =
    `position:fixed;left:-9999px;top:0;border:0;visibility:hidden;` +
    `width:${A4_PX.width}px;height:${A4_PX.height}px;`;

  const objectUrls: string[] = [];
  try {
    document.body.appendChild(iframe);
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () => reject(new Error("Could not load the HTML document."));
      iframe.srcdoc = html;
    });
    const doc = iframe.contentDocument;
    if (!doc?.body) throw new Error("Could not parse the HTML document.");

    // Remote stylesheets are fetched before `load`, but web-font glyphs arrive
    // later — capture with the wrong font metrics otherwise.
    try {
      await doc.fonts?.ready;
    } catch {
      /* fonts are best-effort */
    }

    const blockedImages = await inlineRemoteImages(doc, objectUrls);
    await Promise.all(Array.from(doc.images).map((img) => img.decode().catch(() => undefined)));

    injectPageBreakSpacers(doc);

    const contentHeight = Math.max(doc.documentElement.scrollHeight, 1);
    iframe.style.height = `${contentHeight}px`;

    const { default: html2canvas } = await import("html2canvas-pro");
    const capture = (scale: number) =>
      html2canvas(doc.body, {
        scale,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: "#ffffff",
        width: A4_PX.width,
        windowWidth: A4_PX.width,
        height: contentHeight,
      });

    try {
      return { canvas: await capture(CAPTURE_SCALE), blockedImages, scaleReduced: false };
    } catch {
      return { canvas: await capture(1), blockedImages, scaleReduced: true };
    }
  } finally {
    iframe.remove();
    for (const url of objectUrls) URL.revokeObjectURL(url);
  }
}

/**
 * Pre-fetch every `<img src>` and swap in a same-origin blob URL, so no image
 * can taint the capture canvas. html2canvas-pro's `useCORS` alone is not
 * enough: it skips images whose URL *looks* same-origin but redirects to a
 * CDN, and one tainted pixel makes the whole export unreadable. Returns the
 * URLs that were CORS-blocked (each replaced by a transparent placeholder).
 */
async function inlineRemoteImages(doc: Document, objectUrls: string[]): Promise<string[]> {
  const blocked: string[] = [];
  await Promise.all(
    Array.from(doc.querySelectorAll<HTMLImageElement>("img[src]")).map(async (img) => {
      const raw = img.getAttribute("src") ?? "";
      if (raw.startsWith("data:") || raw.startsWith("blob:")) return;
      try {
        const res = await fetch(img.src, { mode: "cors" });
        if (!res.ok) throw new Error(`http-${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        objectUrls.push(url);
        img.src = url;
      } catch {
        blocked.push(raw);
        img.src = TRANSPARENT_PIXEL;
      }
    }),
  );
  return blocked;
}

/**
 * Keep paragraphs, headings, images, etc. from being sliced in half: any
 * breakable element that straddles an A4 page boundary (and fits on one page)
 * gets a spacer <div> pushing it onto the next page. Rects are re-read per
 * element, so each inserted spacer is accounted for in the elements below it.
 */
function injectPageBreakSpacers(doc: Document): void {
  const view = doc.defaultView;
  if (!view) return;
  const bodyTop = doc.body.getBoundingClientRect().top;

  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>(BREAKABLE_SELECTOR))) {
    const style = view.getComputedStyle(el);
    if (style.position === "absolute" || style.position === "fixed") continue;
    // A spacer inside a flex/grid/table container becomes a bogus item/cell.
    const parentDisplay = el.parentElement
      ? view.getComputedStyle(el.parentElement).display
      : "block";
    if (/flex|grid|table|inline/.test(parentDisplay)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.height <= 0 || rect.height >= A4_PX.height) continue;

    const top = rect.top - bodyTop;
    const startPage = Math.floor(top / A4_PX.height);
    const endPage = Math.floor((top + rect.height) / A4_PX.height);
    if (startPage === endPage) continue;

    const spacer = doc.createElement("div");
    spacer.style.height = `${(startPage + 1) * A4_PX.height - top}px`;
    el.parentElement?.insertBefore(spacer, el);
  }
}

/**
 * Stage 2: assemble the PDF, staying under the size budget when possible.
 * Image-heavy documents get one automatic re-encode at a lower JPEG quality;
 * if the result still exceeds the budget the smaller of the two is returned
 * with `overBudget` set so the caller can point the user at Compress.
 */
export async function assemblePdfWithinBudget(
  canvas: HTMLCanvasElement,
  maxBytes = MAX_HTML_PDF_BYTES,
): Promise<{ bytes: Uint8Array; recompressed: boolean; overBudget: boolean }> {
  const bytes = await assemblePdfFromCanvas(canvas, JPEG_QUALITY);
  if (bytes.byteLength <= maxBytes) return { bytes, recompressed: false, overBudget: false };

  const reencoded = await assemblePdfFromCanvas(canvas, FALLBACK_JPEG_QUALITY);
  const best = reencoded.byteLength < bytes.byteLength ? reencoded : bytes;
  return { bytes: best, recompressed: true, overBudget: best.byteLength > maxBytes };
}

/**
 * Slice a tall capture canvas into A4 pages and assemble the PDF. The page
 * height in pixels is derived from the canvas width, so any capture scale
 * works. Exported separately from the DOM-bound capture path so it can be
 * unit-tested in the Node test environment.
 */
export async function assemblePdfFromCanvas(
  canvas: HTMLCanvasElement,
  quality = JPEG_QUALITY,
): Promise<Uint8Array> {
  const pageHeightPx = Math.round((canvas.width * A4_PX.height) / A4_PX.width);
  const pageCount = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const slice = new OffscreenCanvas(canvas.width, pageHeightPx);
    const ctx = slice.getContext("2d");
    if (!ctx) throw new Error("Could not create a 2D canvas context.");
    // JPEG has no alpha — unfilled regions would come out black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, pageHeightPx);
    const srcH = Math.min(pageHeightPx, canvas.height - i * pageHeightPx);
    if (srcH > 0) {
      ctx.drawImage(canvas, 0, i * pageHeightPx, canvas.width, srcH, 0, 0, canvas.width, srcH);
    }

    const blob = await slice.convertToBlob({ type: "image/jpeg", quality });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // The spec lets a browser ignore the requested type and return PNG.
    const image = blob.type === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

    const page = doc.addPage([A4_PT.width, A4_PT.height]);
    page.drawImage(image, { x: 0, y: 0, width: A4_PT.width, height: A4_PT.height });
  }
  return doc.save();
}
