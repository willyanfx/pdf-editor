import type { PdfEdit, TextEdit, TextRun } from "../store/useEditorStore";
import { runsToText } from "../store/useEditorStore";
import { MARKER_RE } from "./ocr";

/**
 * Export the OCR/text edits as a formatted .docx, reconstructing the document
 * structure (bold section headings + bullet lists) the way the gold Acrobat OCR
 * does. Runs fully client-side: the `docx` library is lazy-loaded and serialized
 * in the browser, so the document is never uploaded.
 *
 * Classification per text block:
 *  - starts with a list marker (•, -, 1., a)…) → a bullet list item
 *  - bold & short                              → a bold heading paragraph
 *  - otherwise                                 → a body paragraph (per-run styling)
 */

/** Strip a leading bullet/number marker so the list glyph isn't doubled (docx
 * renders its own bullet). Keeps numbered markers' text since they carry meaning. */
function stripBullet(text: string): string {
  return text.replace(/^[\s]*[-•◦▪*–—]\s+/, "").trimStart();
}

type Classified =
  | { kind: "list"; text: string; edit: TextEdit }
  | { kind: "heading"; edit: TextEdit }
  | { kind: "body"; edit: TextEdit };

function classify(edit: TextEdit): Classified {
  const text = runsToText(edit.runs);
  if (MARKER_RE.test(text)) return { kind: "list", text: stripBullet(text), edit };
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (edit.bold && wordCount > 0 && wordCount <= 8) return { kind: "heading", edit };
  return { kind: "body", edit };
}

/** Order text edits the way they read: by page, then top-to-bottom. */
function orderEdits(edits: PdfEdit[], pageOrder: number[]): TextEdit[] {
  const rank = new Map(pageOrder.map((p, i) => [p, i]));
  return edits
    .filter((e): e is TextEdit => e.type === "text")
    .sort((a, b) => {
      const pa = rank.get(a.pageIndex) ?? a.pageIndex;
      const pb = rank.get(b.pageIndex) ?? b.pageIndex;
      return pa !== pb ? pa - pb : a.y - b.y;
    });
}

/**
 * Build and download a .docx from the current text edits.
 * @returns true if a document was produced, false if there was nothing to export.
 */
export async function exportDocx(
  edits: PdfEdit[],
  filename: string,
  pageOrder: number[],
): Promise<boolean> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun: DocxRun,
    LevelFormat,
    AlignmentType,
  } = await import("docx");

  const ordered = orderEdits(edits, pageOrder);
  if (ordered.length === 0) return false;

  const align = (a: TextEdit["align"]) =>
    a === "center"
      ? AlignmentType.CENTER
      : a === "right"
        ? AlignmentType.RIGHT
        : AlignmentType.LEFT;

  /** Map our styled runs to docx runs, inheriting the box's bold/italic defaults. */
  const toDocxRuns = (edit: TextEdit, runs: TextRun[], forceBold = false) =>
    runs.map(
      (r) =>
        new DocxRun({
          text: r.text,
          bold: forceBold || (r.bold ?? edit.bold),
          italics: r.italic ?? edit.italic,
        }),
    );

  const paragraphs = ordered.map((edit) => {
    const c = classify(edit);
    if (c.kind === "list") {
      return new Paragraph({
        numbering: { reference: "ocr-bullets", level: 0 },
        alignment: align(edit.align),
        children: toDocxRuns(edit, [{ text: c.text }], edit.bold),
      });
    }
    if (c.kind === "heading") {
      return new Paragraph({
        alignment: align(edit.align),
        spacing: { before: 200, after: 80 },
        children: toDocxRuns(edit, edit.runs, true),
      });
    }
    return new Paragraph({
      alignment: align(edit.align),
      children: toDocxRuns(edit, edit.runs),
    });
  });

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "ocr-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children: paragraphs }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
