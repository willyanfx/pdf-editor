/**
 * "Compare PDFs": load two documents with pdf.js and, page by page, diff their
 * text (word level) and their rendering (pixel level). Pages are paired by
 * index; a page present on only one side is reported as added/removed.
 */
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { VIEWER_WIDTH } from "./pdfGeometry";
import { extractScreenTextItems } from "./textLayer";
import type { ScreenTextItem } from "./textLayer";
import {
  diffPageText,
  type MeasureText,
  diffPixels,
  isVisuallyChanged,
  type PageTextDiff,
  type PixelDiff,
  type RgbaImage,
} from "./compareDiff";

export type CompareDoc = {
  name: string;
  numPages: number;
  doc: PDFDocumentProxy;
  destroy: () => void;
};

/** Thrown for a file we can't open, with a message fit for a toast. */
export class CompareLoadError extends Error {}

/** Open a PDF for comparison. Unlike the editor's own loader this never prompts:
 * an encrypted file needs `password` (the open document's, if it is that file). */
export async function openCompareDoc(file: File, password?: string): Promise<CompareDoc> {
  const { pdfjs } = await import("react-pdf");
  const { PDF_DOCUMENT_OPTIONS } = await import("./pdfOptions");
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    password,
    ...PDF_DOCUMENT_OPTIONS,
  });
  try {
    const doc = await task.promise;
    return { name: file.name, numPages: doc.numPages, doc, destroy: () => void task.destroy() };
  } catch (err) {
    void task.destroy();
    if (err instanceof Error && err.name === "PasswordException") {
      throw new CompareLoadError(`${file.name} is password-protected — unlock it first.`);
    }
    throw new CompareLoadError(`Could not read ${file.name}.`);
  }
}

const CSS_FAMILY = {
  Helvetica: "Helvetica, Arial, sans-serif",
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
} as const;

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Glyph-aware text width via canvas, so a word's highlight lands on the word
 * rather than on where it would sit if every letter were the same width. */
const measureText: MeasureText = (text, block: ScreenTextItem) => {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length;
  measureCtx.font = `${block.bold ? "bold " : ""}${block.italic ? "italic " : ""}${block.fontSize}px ${CSS_FAMILY[block.fontFamily as keyof typeof CSS_FAMILY] ?? "sans-serif"}`;
  return measureCtx.measureText(text).width;
};

export type RenderedPage = RgbaImage & { pageWidth: number; pageHeight: number };

/** Render a page at VIEWER_WIDTH px wide on a white matte. `intent: "print"`
 * skips the rAF scheduling that stalls forever in a hidden tab. */
async function renderPage(page: PDFPageProxy): Promise<RenderedPage> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: VIEWER_WIDTH / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport, intent: "print" }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = 0; // release the backing store
  return {
    width: img.width,
    height: img.height,
    data: img.data,
    pageWidth: base.width,
    pageHeight: base.height,
  };
}

export type PageStatus = "identical" | "changed" | "added" | "removed";

export type PageComparison = {
  pageIndex: number;
  status: PageStatus;
  textChanged: boolean;
  visualChanged: boolean;
  /** Pages of different physical size can't be meaningfully overlaid. */
  sizeMismatch: boolean;
  addedWords: number;
  removedWords: number;
  /** Only present when the caller asked for `detail`. */
  detail?: PageDetail;
};

export type PageDetail = {
  text: PageTextDiff;
  pixels: PixelDiff;
  original: RenderedPage | null;
  revised: RenderedPage | null;
};

const SIZE_TOLERANCE_PT = 2;

/**
 * Compare page `pageIndex` of both documents. Pass `detail: true` to also keep
 * the rendered bitmaps and diff artefacts (for display); the summary pass over a
 * whole document leaves them out so it doesn't hold every page in memory.
 */
export async function comparePage(
  a: CompareDoc,
  b: CompareDoc,
  pageIndex: number,
  detail = false,
): Promise<PageComparison> {
  const hasA = pageIndex < a.numPages;
  const hasB = pageIndex < b.numPages;
  const pageA = hasA ? await a.doc.getPage(pageIndex + 1) : null;
  const pageB = hasB ? await b.doc.getPage(pageIndex + 1) : null;
  try {
    const [blocksA, blocksB] = await Promise.all([
      pageA ? extractScreenTextItems(pageA, VIEWER_WIDTH) : Promise.resolve([]),
      pageB ? extractScreenTextItems(pageB, VIEWER_WIDTH) : Promise.resolve([]),
    ]);
    const text = diffPageText(blocksA, blocksB, measureText);
    const [original, revised] = await Promise.all([
      pageA ? renderPage(pageA) : null,
      pageB ? renderPage(pageB) : null,
    ]);
    const blank: RgbaImage = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    const pixels = diffPixels(original ?? blank, revised ?? blank);

    const sizeMismatch =
      !!original &&
      !!revised &&
      (Math.abs(original.pageWidth - revised.pageWidth) > SIZE_TOLERANCE_PT ||
        Math.abs(original.pageHeight - revised.pageHeight) > SIZE_TOLERANCE_PT);
    const textChanged = text.addedWords + text.removedWords > 0;
    const visualChanged = isVisuallyChanged(pixels) || sizeMismatch;
    const status: PageStatus = !hasA
      ? "added"
      : !hasB
        ? "removed"
        : textChanged || visualChanged
          ? "changed"
          : "identical";

    return {
      pageIndex,
      status,
      textChanged,
      visualChanged,
      sizeMismatch,
      addedWords: text.addedWords,
      removedWords: text.removedWords,
      detail: detail ? { text, pixels, original, revised } : undefined,
    };
  } finally {
    pageA?.cleanup();
    pageB?.cleanup();
  }
}

export type CompareSummary = {
  pages: PageComparison[];
  changedPages: number;
  textChangedPages: number;
  visualChangedPages: number;
  addedWords: number;
  removedWords: number;
};

export function summarize(pages: PageComparison[]): CompareSummary {
  return {
    pages,
    changedPages: pages.filter((p) => p.status !== "identical").length,
    textChangedPages: pages.filter((p) => p.textChanged).length,
    visualChangedPages: pages.filter((p) => p.visualChanged).length,
    addedWords: pages.reduce((n, p) => n + p.addedWords, 0),
    removedWords: pages.reduce((n, p) => n + p.removedWords, 0),
  };
}

/** Compare every page. `onProgress(done, total)` fires after each page;
 * `signal` aborts between pages (the result is then discarded by the caller). */
export async function compareDocuments(
  a: CompareDoc,
  b: CompareDoc,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<CompareSummary> {
  const total = Math.max(a.numPages, b.numPages);
  const pages: PageComparison[] = [];
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    pages.push(await comparePage(a, b, i));
    onProgress?.(i + 1, total);
  }
  return summarize(pages);
}
