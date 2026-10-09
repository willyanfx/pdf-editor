/**
 * "Search & redact": find literal text and sensitive-data patterns across the
 * document's own text (via pdf.js) and the editable text overlays (OCR / added
 * text), and size a redaction mark to each hit.
 */
import type { PdfEdit } from "../store/useEditorStore";
import { runsToText } from "../store/useEditorStore";
import { VIEWER_WIDTH, type ScreenRect } from "./pdfGeometry";
import { loadPdfDocument } from "./pdfOptions";
import { extractScreenTextItems, type ScreenTextItem } from "./textLayer";
import { findMatches, type RedactQuery, type TextMatch } from "./redactPatterns";
import { MARK_PAD, rectForBlockRange, textEditBounds } from "./redactGeometry";

export type RedactionMatch = {
  id: string;
  /** Original page index. */
  pageIndex: number;
  kind: TextMatch["kind"];
  before: string;
  text: string;
  after: string;
  /** The mark to create, in viewer space. */
  rect: ScreenRect;
  /** "pdf": text in the PDF itself — the mark covers just the matched words.
   * "overlay": text in an editable box (OCR / added) — the whole box is marked,
   * because overlay text is re-laid-out on export. */
  source: "pdf" | "overlay";
};

/** Every page's text blocks (viewer space), keyed by page index. One pdf.js
 * load per call — callers cache the result per file. */
export async function extractDocumentText(file: File): Promise<Map<number, ScreenTextItem[]>> {
  const data = await file.arrayBuffer();
  const task = await loadPdfDocument(data);
  const out = new Map<number, ScreenTextItem[]>();
  try {
    const doc = await task.promise;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      out.set(p - 1, await extractScreenTextItems(page, VIEWER_WIDTH));
      page.cleanup();
    }
  } finally {
    void task.destroy();
  }
  return out;
}

const CONTEXT_CHARS = 24;

function snippet(text: string, m: TextMatch) {
  return {
    before: text.slice(Math.max(0, m.start - CONTEXT_CHARS), m.start),
    text: text.slice(m.start, m.end),
    after: text.slice(m.end, m.end + CONTEXT_CHARS),
  };
}

/**
 * Run the query over every page in `pageOrder` (or all extracted pages). Pages
 * removed from the export are skipped — a mark there would never be applied.
 */
export function findRedactionMatches(
  blocks: Map<number, ScreenTextItem[]>,
  edits: PdfEdit[],
  query: RedactQuery,
  pageOrder?: number[],
): RedactionMatch[] {
  const pages =
    pageOrder && pageOrder.length > 0 ? pageOrder : [...blocks.keys()].sort((a, b) => a - b);
  const out: RedactionMatch[] = [];
  let seq = 0;
  for (const pageIndex of pages) {
    for (const block of blocks.get(pageIndex) ?? []) {
      for (const m of findMatches(block.str, query)) {
        out.push({
          id: `m${seq++}`,
          pageIndex,
          kind: m.kind,
          ...snippet(block.str, m),
          rect: rectForBlockRange(block, m.start, m.end),
          source: "pdf",
        });
      }
    }
    for (const edit of edits) {
      if (edit.type !== "text" || edit.pageIndex !== pageIndex) continue;
      const text = runsToText(edit.runs);
      if (!text.trim()) continue;
      const bounds = textEditBounds(edit);
      const rect = {
        x: bounds.x - MARK_PAD,
        y: bounds.y - MARK_PAD,
        width: bounds.width + 2 * MARK_PAD,
        height: bounds.height + 2 * MARK_PAD,
      };
      for (const m of findMatches(text, query)) {
        out.push({
          id: `m${seq++}`,
          pageIndex,
          kind: m.kind,
          ...snippet(text, m),
          rect,
          source: "overlay",
        });
      }
    }
  }
  return out;
}
