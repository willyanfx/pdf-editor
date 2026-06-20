import * as XLSX from "xlsx";
import { VIEWER_WIDTH } from "./pdfGeometry";
import { loadPdfDocument } from "./pdfOptions";
import { extractScreenTextItems } from "./textLayer";

/**
 * Extract the native (selectable) text of a PDF, one row per line block, into a
 * CSV. Columns: Page, Line, Text — where Line is the 1-based order of the line
 * block on that page (top-to-bottom, left-to-right, as grouped by textLayer).
 *
 * This is read-only structured extraction of the source text; it does not reflect
 * editor overlays. Scanned/image-only pages yield no rows (run OCR for those).
 * Returns the number of rows written, or 0 if the document has no extractable text.
 */
export async function extractCsvRows(file: File): Promise<string[][]> {
  // Fresh buffer: pdf.js neuters the one it loads.
  const data = await file.arrayBuffer();
  const loadingTask = await loadPdfDocument(data);
  const rows: string[][] = [["Page", "Line", "Text"]];
  try {
    const doc = await loadingTask.promise;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const items = await extractScreenTextItems(page, VIEWER_WIDTH);
      // extractScreenTextItems groups by baseline then x; keep that reading order
      // but sort top-to-bottom so the CSV reads like the page.
      const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
      let line = 0;
      for (const item of ordered) {
        const text = item.str.trim();
        if (!text) continue;
        line += 1;
        rows.push([String(p), String(line), text]);
      }
    }
  } finally {
    void loadingTask.destroy();
  }
  return rows;
}

/**
 * Build a CSV string from the extracted rows. Returns null when there is no text
 * (only the header row), so callers can surface "run OCR first".
 */
export async function buildCsv(file: File): Promise<string | null> {
  const rows = await extractCsvRows(file);
  if (rows.length <= 1) return null;
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  return XLSX.utils.sheet_to_csv(sheet);
}
