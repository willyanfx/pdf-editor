/** How many leading pages to sample when deciding if a PDF is scanned. */
export const SAMPLE_PAGES = 3;
/** Below this many extracted characters (across the sampled pages) we treat the
 * document as image-only / scanned — a few stray chars (page numbers, a stamp)
 * shouldn't count as "has selectable text". */
export const TEXT_CHAR_THRESHOLD = 12;

/** Pure verdict: given the total trimmed-char count from the sampled pages and
 * whether the document had any pages, decide if it looks scanned. */
export function looksScanned(sampledChars: number, hasPages: boolean): boolean {
  return hasPages && sampledChars < TEXT_CHAR_THRESHOLD;
}

/**
 * Decide whether a PDF looks scanned (image-only) by sampling the selectable
 * text of its first few pages. Returns true when the sampled pages yield almost
 * no text — the signal that OCR is needed to make the document editable.
 *
 * Cheap: reads getTextContent() (metadata) only; never rasterizes a page. Loads
 * its own document copy and tears it down, so it doesn't interfere with the
 * render path (pdf.js neuters the buffer it loads).
 */
export async function isLikelyScanned(file: File): Promise<boolean> {
  const { loadPdfDocument } = await import("./pdfOptions");
  const data = await file.arrayBuffer();
  const loadingTask = await loadPdfDocument(data);
  try {
    const doc = await loadingTask.promise;
    if (doc.numPages === 0) return false;
    const sample = Math.min(SAMPLE_PAGES, doc.numPages);
    let chars = 0;
    for (let i = 1; i <= sample; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item) chars += item.str.trim().length;
      }
      page.cleanup();
      if (chars >= TEXT_CHAR_THRESHOLD) return false; // found real text early — done
    }
    return looksScanned(chars, true);
  } catch {
    // If we can't read it, don't nag — the render path will surface real errors.
    return false;
  } finally {
    void loadingTask.destroy();
  }
}
