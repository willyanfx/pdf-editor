/**
 * Real redaction: content under a mark is REMOVED from the downloaded PDF, not
 * covered. Runs as a final pass over the bytes produced by exportEditedPdf, so
 * every other edit is already baked when a page is flattened.
 *
 * Approach (per output page that carries marks):
 *   1. Render the page with pdf.js (intent "print", ~200 DPI), paint the marks
 *      solid black on the canvas, and encode the canvas as a JPEG.
 *   2. Replace the page dict with a fresh one of the same visible size that
 *      only draws that image — BEHIND THE SAME OBJECT REFERENCE, so outline
 *      entries, links, named destinations, /OpenAction, structure elements and
 *      anything else that pointed at the page keep working (see
 *      replacePageInPlace). The old dict is dropped from the object table and
 *      its constituents (content streams, annotations, thumbnail, metadata)
 *      are recorded as "cut" for the GC below.
 *   3. Remove AcroForm fields that had a widget on the page (their stored /V
 *      values go with them), drop XFA data if any field was removed, and prune
 *      structure-tree elements that referred to the page (they can carry
 *      /ActualText or /Alt copies of page text).
 *   4. Re-add the page's original text that lies entirely OUTSIDE every mark as
 *      invisible text (render mode 3) so the page stays searchable.
 *   5. Garbage-collect: every indirect object no longer reachable from the
 *      trailer is deleted, so pdf-lib doesn't write the orphaned content
 *      streams, fonts, images or annotation dicts into the file. The cut set is
 *      deleted unconditionally and never traversed, so no stray referrer (a
 *      shared annotation, an OBJR structure kid, ...) can keep old page content
 *      in the file. Images that were listed in a resources dict shared with
 *      other pages are dropped from those pages too when their content streams
 *      never draw them.
 *
 * Coordinates: marks are stored in the viewer's 800px space of the ORIGINAL
 * page (pdf.js default viewport = page's own /Rotate, CropBox). They are mapped
 * into PDF user space with that viewport, then into the OUTPUT page's render
 * viewport (which reflects any PageOp rotation/crop applied by exportEditedPdf).
 * User space is stable across those operations, so no second coordinate system
 * is introduced.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFPage,
  PDFPageLeaf,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  TextRenderingMode,
  beginText,
  decodePDFRawStream,
  endText,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFFont,
  type PDFObject,
} from "pdf-lib";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PdfEdit } from "../store/useEditorStore";
import { VIEWER_WIDTH, type ScreenRect } from "./pdfGeometry";
import { exportEditedPdf, type ExportOptions } from "./exportPdf";
import { blankRedactedTextEdits, redactMarks } from "./redactGeometry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The subset of a pdf.js loading task we use. */
export type PdfJsLoadingTask = {
  promise: Promise<PDFDocumentProxy>;
  destroy(): Promise<void>;
};

/** A canvas abstraction so the pass runs in the browser and in Node tests. */
export type RedactCanvas = {
  /** The object handed to pdf.js `page.render({ canvas })`. */
  canvas: unknown;
  fill(x: number, y: number, width: number, height: number, color: string): void;
  toJpeg(quality: number): Promise<Uint8Array>;
  dispose?(): void;
};

export type RedactDeps = {
  loadDocument(data: Uint8Array): Promise<PdfJsLoadingTask>;
  createCanvas(width: number, height: number): RedactCanvas;
};

/** Marks for one output page, in the viewer space of its source page. */
export type RedactTarget = {
  /** Original (source document) page index — defines the viewer space. */
  srcIndex: number;
  /** Index of that page in the exported document. */
  outIndex: number;
  rects: ScreenRect[];
};

export type RedactOptions = {
  /** Raster resolution for flattened pages. Default 200. */
  dpi?: number;
  /** JPEG quality for the flattened page image. Default 0.92. */
  jpegQuality?: number;
  /** Longest canvas edge in px, to bound memory on huge pages. Default 6000. */
  maxEdgePx?: number;
  /** Re-add unmarked text as invisible text so the page stays searchable. Default true. */
  keepSearchableText?: boolean;
  /** Platform hooks; defaults to the browser (pdfOptions loader + <canvas>). */
  deps?: RedactDeps;
};

export type RedactResult = {
  bytes: Uint8Array;
  /** Human-readable notes about fallbacks taken (shown to the user as toasts). */
  warnings: string[];
  /** Output page indices that were flattened. */
  redactedPages: number[];
};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Group redact edits by their output page. `pageOrder` maps original → output
 * index (marks on dropped pages are ignored); omit it for identity order. */
export function buildRedactTargets(edits: PdfEdit[], pageOrder?: number[]): RedactTarget[] {
  const byOut = new Map<number, RedactTarget>();
  for (const mark of redactMarks(edits)) {
    if (mark.width <= 0 || mark.height <= 0) continue;
    const outIndex = pageOrder ? pageOrder.indexOf(mark.pageIndex) : mark.pageIndex;
    if (outIndex < 0) continue;
    let target = byOut.get(outIndex);
    if (!target) {
      target = { srcIndex: mark.pageIndex, outIndex, rects: [] };
      byOut.set(outIndex, target);
    }
    target.rects.push({ x: mark.x, y: mark.y, width: mark.width, height: mark.height });
  }
  return [...byOut.values()].sort((a, b) => a.outIndex - b.outIndex);
}

/**
 * The download path: bake all edits with exportEditedPdf, then apply the
 * redaction marks. With no marks this is exactly exportEditedPdf.
 */
export async function exportRedactedPdf(
  file: File,
  edits: PdfEdit[],
  options: ExportOptions = {},
  redactOptions: RedactOptions = {},
): Promise<RedactResult> {
  const targets = buildRedactTargets(edits, options.pageOrder);
  const baked = await exportEditedPdf(file, blankRedactedTextEdits(edits), {
    ...options,
    redactionsHandled: true,
  });
  if (targets.length === 0) return { bytes: baked, warnings: [], redactedPages: [] };
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  return applyRedactions(baked, sourceBytes, targets, redactOptions);
}

/**
 * A post-export pass for callers that run exportEditedPdf themselves (e.g. the
 * compress path). Null when there is nothing to redact. The caller must pass
 * `redactionsHandled: true` (and ideally blankRedactedTextEdits) to the export.
 */
export function createRedactionPass(
  file: File,
  edits: PdfEdit[],
  pageOrder?: number[],
  redactOptions: RedactOptions = {},
): { run: (bytes: Uint8Array) => Promise<Uint8Array>; warnings: string[] } | null {
  const targets = buildRedactTargets(edits, pageOrder);
  if (targets.length === 0) return null;
  const warnings: string[] = [];
  const run = async (bytes: Uint8Array) => {
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    const result = await applyRedactions(bytes, sourceBytes, targets, redactOptions);
    warnings.push(...result.warnings);
    return result.bytes;
  };
  return { run, warnings };
}

/**
 * Apply redaction marks to exported PDF bytes. `sourceBytes` is the document
 * the marks were drawn on (needed to reproduce the viewer's coordinate space).
 * Throws rather than silently skipping when rendering isn't possible.
 */
export async function applyRedactions(
  pdfBytes: Uint8Array,
  sourceBytes: Uint8Array,
  targets: RedactTarget[],
  options: RedactOptions = {},
): Promise<RedactResult> {
  const live = targets.filter((t) => t.rects.length > 0);
  if (live.length === 0) return { bytes: pdfBytes, warnings: [], redactedPages: [] };

  const deps = options.deps ?? (await browserDeps());
  const settings = {
    dpi: options.dpi ?? 200,
    quality: options.jpegQuality ?? 0.92,
    maxEdge: options.maxEdgePx ?? 6000,
    keepText: options.keepSearchableText ?? true,
  };
  const warnings: string[] = [];
  const redactedPages: number[] = [];

  const srcTask = await deps.loadDocument(sourceBytes.slice());
  const outTask = await deps.loadDocument(pdfBytes.slice());
  try {
    const srcDoc = await srcTask.promise;
    const outDoc = await outTask.promise;
    const pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });

    let font: PDFFont | null = null;
    const getFont = async () => (font ??= await pdfDoc.embedFont(StandardFonts.Helvetica));

    const suspectXObjects = new Set<PDFRef>();
    const redactedPageRefs: PDFRef[] = [];
    const cut = new Set<PDFRef>();
    const structParentKeys = new Set<number>();
    let removedFields = 0;

    for (const target of live) {
      // Fail closed: a mark we can't place must never turn into a download
      // that still carries what it was meant to remove.
      if (target.outIndex < 0 || target.outIndex >= pdfDoc.getPageCount()) {
        throw new Error(
          `Redaction: output page ${target.outIndex + 1} is out of range (the document has ${pdfDoc.getPageCount()} pages).`,
        );
      }
      if (target.srcIndex < 0 || target.srcIndex >= srcDoc.numPages) {
        throw new Error(
          `Redaction: source page ${target.srcIndex + 1} is out of range (the original has ${srcDoc.numPages} pages).`,
        );
      }

      const srcPage = await srcDoc.getPage(target.srcIndex + 1);
      const outPage = await outDoc.getPage(target.outIndex + 1);
      const raster = await rasterizeRedactedPage(srcPage, outPage, target.rects, deps, settings);
      srcPage.cleanup();
      outPage.cleanup();

      const oldPage = pdfDoc.getPage(target.outIndex);
      collectSuspectXObjects(oldPage, suspectXObjects);
      collectStructParentKeys(oldPage, structParentKeys);
      collectPageCutRefs(oldPage, cut);
      removedFields += removeFormFieldsOnPage(pdfDoc, oldPage, warnings);

      // Fresh page dict behind the old reference: nothing from the old one
      // (content, resources, annots, thumbnail, page-level metadata,
      // /StructParents) carries over, but every reference to the page does.
      const newPage = replacePageInPlace(pdfDoc, oldPage, target.outIndex, [
        raster.width,
        raster.height,
      ]);
      redactedPageRefs.push(newPage.ref);

      const image = await pdfDoc.embedJpg(raster.jpeg);
      newPage.drawImage(image, { x: 0, y: 0, width: raster.width, height: raster.height });
      if (settings.keepText && raster.textItems.length > 0) {
        drawInvisibleText(newPage, await getFont(), raster.textItems);
      }
      redactedPages.push(target.outIndex);
    }

    pruneStructTree(pdfDoc, redactedPageRefs, structParentKeys, warnings);
    if (removedFields > 0) stripXfa(pdfDoc, warnings);
    exemptSharedPageParts(pdfDoc, cut);
    collectGarbage(pdfDoc, cut);
    pruneSuspectXObjects(pdfDoc, suspectXObjects, warnings);
    collectGarbage(pdfDoc, cut);

    // removeFormFieldsOnPage populated pdf-lib's form cache; the default
    // updateFieldAppearances: true would then redraw every untouched field
    // that lacks an appearance stream (exportEditedPdf avoids this too).
    const bytes = await pdfDoc.save({ useObjectStreams: true, updateFieldAppearances: false });
    return { bytes, warnings, redactedPages };
  } finally {
    await srcTask.destroy();
    await outTask.destroy();
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];

/** Compose pdf.js-style matrices: apply `m2` first, then `m1`. */
function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

type PxRect = { x0: number; y0: number; x1: number; y1: number };

function bbox(points: [number, number][]): PxRect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

function pxRectsIntersect(a: PxRect, b: PxRect, margin: number): boolean {
  return (
    a.x0 - margin < b.x1 && a.x1 + margin > b.x0 && a.y0 - margin < b.y1 && a.y1 + margin > b.y0
  );
}

type InvisibleTextItem = { str: string; matrix: Matrix };

type RasterResult = {
  jpeg: Uint8Array;
  /** Visible page size in PDF points (after rotation/crop). */
  width: number;
  height: number;
  textItems: InvisibleTextItem[];
};

type RasterSettings = { dpi: number; quality: number; maxEdge: number; keepText: boolean };

async function rasterizeRedactedPage(
  srcPage: PDFPageProxy,
  outPage: PDFPageProxy,
  rects: ScreenRect[],
  deps: RedactDeps,
  settings: RasterSettings,
): Promise<RasterResult> {
  // The viewer renders <Page width={VIEWER_WIDTH}> with the page's own rotation,
  // which is exactly pdf.js's default viewport at this scale.
  const srcBase = srcPage.getViewport({ scale: 1 });
  const srcViewport = srcPage.getViewport({ scale: VIEWER_WIDTH / srcBase.width });

  const outBase = outPage.getViewport({ scale: 1 });
  const scale = Math.min(
    settings.dpi / 72,
    settings.maxEdge / Math.max(outBase.width, outBase.height),
  );
  const viewport = outPage.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);

  // Viewer px → user space (via the source page) → output render px. Expand by a
  // little over a point so anti-aliased glyph edges never survive at the rim.
  const marginPx = Math.ceil(scale * 0.75) + 1;
  const marks: PxRect[] = rects.map((r) => {
    const corners: [number, number][] = [
      [r.x, r.y],
      [r.x + r.width, r.y],
      [r.x, r.y + r.height],
      [r.x + r.width, r.y + r.height],
    ];
    const user = corners.map(([x, y]) => srcViewport.convertToPdfPoint(x, y) as [number, number]);
    const ub = bbox(user);
    const userCorners: [number, number][] = [
      [ub.x0, ub.y0],
      [ub.x1, ub.y0],
      [ub.x0, ub.y1],
      [ub.x1, ub.y1],
    ];
    const px = bbox(
      userCorners.map(([x, y]) => viewport.convertToViewportPoint(x, y) as [number, number]),
    );
    return {
      x0: Math.floor(px.x0 - marginPx),
      y0: Math.floor(px.y0 - marginPx),
      x1: Math.ceil(px.x1 + marginPx),
      y1: Math.ceil(px.y1 + marginPx),
    };
  });

  const canvas = deps.createCanvas(width, height);
  try {
    canvas.fill(0, 0, width, height, "#ffffff");
    // intent "print": display intent schedules via requestAnimationFrame and
    // never resolves in a hidden tab.
    await outPage.render({
      canvas: canvas.canvas as HTMLCanvasElement,
      viewport,
      intent: "print",
    }).promise;
    for (const m of marks) canvas.fill(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0, "#000000");
    const jpeg = await canvas.toJpeg(settings.quality);

    const textItems = settings.keepText ? await collectOutsideText(outPage, viewport, marks) : [];
    return { jpeg, width: outBase.width, height: outBase.height, textItems };
  } finally {
    canvas.dispose?.();
  }
}

/**
 * The page's text items whose glyph boxes lie entirely outside every mark,
 * with the text matrix they need on the new (unrotated, origin-at-0) page.
 * Anything that touches a mark — even partially — is dropped whole.
 */
async function collectOutsideText(
  page: PDFPageProxy,
  viewport: ReturnType<PDFPageProxy["getViewport"]>,
  marks: PxRect[],
): Promise<InvisibleTextItem[]> {
  const content = await page.getTextContent();
  const base = page.getViewport({ scale: 1 });
  const baseTransform = base.transform as Matrix;
  // Render space (y down) → new page user space (y up).
  const flip: Matrix = [1, 0, 0, -1, 0, base.height];
  const toNewPage = mul(flip, baseTransform);
  const SAFETY_PX = 2;

  const out: InvisibleTextItem[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !("transform" in item)) continue;
    if (item.str.trim() === "") continue;
    const t = item.transform as Matrix;
    // Font size is folded into the transform; the glyph box in text space is
    // [0, advance] × [descent, ascent] in font-size units (generous bounds).
    const fontSize = Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]);
    if (!fontSize) continue;
    const advance = item.width / fontSize;
    const local: [number, number][] = [
      [0, -0.35],
      [advance, -0.35],
      [0, 1.05],
      [advance, 1.05],
    ];
    const box = bbox(
      local.map(([lx, ly]) => {
        const [ux, uy] = applyMatrix(t, lx, ly);
        return viewport.convertToViewportPoint(ux, uy) as [number, number];
      }),
    );
    if (marks.some((m) => pxRectsIntersect(box, m, SAFETY_PX))) continue;
    out.push({ str: item.str, matrix: mul(toNewPage, t) });
  }
  return out;
}

/** Draw text items with render mode 3 (invisible) at font size 1 — the matrix
 * carries the real size/rotation. Characters the standard font can't encode
 * are dropped (search still works for the rest). */
function drawInvisibleText(page: PDFPage, font: PDFFont, items: InvisibleTextItem[]) {
  const fontKey = page.node.newFontDictionary("F", font.ref);
  const charset = new Set(font.getCharacterSet());
  const ops = [
    beginText(),
    setFontAndSize(fontKey, 1),
    setTextRenderingMode(TextRenderingMode.Invisible),
  ];
  let count = 0;
  for (const item of items) {
    const safe = Array.from(item.str)
      .filter((ch) => charset.has(ch.codePointAt(0) ?? -1))
      .join("");
    if (safe.trim() === "") continue;
    try {
      const encoded = font.encodeText(safe);
      ops.push(setTextMatrix(...item.matrix), showText(encoded));
      count++;
    } catch {
      // Unencodable run: skip it rather than fail the export.
    }
  }
  ops.push(endText());
  if (count > 0) page.pushOperators(...ops);
}

// ---------------------------------------------------------------------------
// Document surgery
// ---------------------------------------------------------------------------

const N = {
  Annots: PDFName.of("Annots"),
  AcroForm: PDFName.of("AcroForm"),
  XFA: PDFName.of("XFA"),
  XObject: PDFName.of("XObject"),
  Resources: PDFName.of("Resources"),
  StructTreeRoot: PDFName.of("StructTreeRoot"),
  StructParents: PDFName.of("StructParents"),
  StructParent: PDFName.of("StructParent"),
  ParentTree: PDFName.of("ParentTree"),
  IDTree: PDFName.of("IDTree"),
  Nums: PDFName.of("Nums"),
  Names: PDFName.of("Names"),
  Kids: PDFName.of("Kids"),
  K: PDFName.of("K"),
  Pg: PDFName.of("Pg"),
  Type: PDFName.of("Type"),
  MCR: PDFName.of("MCR"),
  OBJR: PDFName.of("OBJR"),
  ActualText: PDFName.of("ActualText"),
  Alt: PDFName.of("Alt"),
  E: PDFName.of("E"),
  MarkInfo: PDFName.of("MarkInfo"),
  Pages: PDFName.of("Pages"),
  MediaBox: PDFName.of("MediaBox"),
  Contents: PDFName.of("Contents"),
};

/**
 * Swap the dict behind `oldPage.ref` for an empty page of `size` points and
 * return it. The new page deliberately KEEPS THE OLD OBJECT REFERENCE.
 *
 * Why: a PDF refers to a page by reference from many places — outline /Dest
 * arrays (the file's own or the ones exportPdf writes for bookmarks), GoTo
 * link annotations on other pages (/Dest or /A /D), /Names /Dests and the
 * legacy catalog /Dests, /OpenAction, structure elements' /Pg, AcroForm widget
 * /P entries, article beads, ... With a NEW ref, each of those would have to
 * be found and retargeted, and any kind we forgot would both dangle and keep
 * the old dict (with its content streams, resources and annotations) alive
 * for the garbage collector — the leak this replaces. Reusing the ref makes
 * every referrer resolve to the flattened page with no rewrite at all, and the
 * old dict is gone from the object table the moment `context.assign` runs, so
 * no path can reach it. Its constituents are handled by collectPageCutRefs.
 *
 * Mechanics: pdf-lib caches PDFPage wrappers per leaf dict, and removePage
 * does not invalidate that cache while insertPage does. So detach the old
 * leaf from the page tree, assign the fresh leaf to the old ref, and insert
 * the wrapper for it at the same index — insertPage sets its /Parent,
 * registers the wrapper and invalidates the cache, all through public API.
 */
function replacePageInPlace(
  pdfDoc: PDFDocument,
  oldPage: PDFPage,
  index: number,
  size: [number, number],
): PDFPage {
  const { context } = pdfDoc;
  const ref = oldPage.ref;
  if (pdfDoc.getPage(index) !== oldPage) {
    throw new Error(`Redaction: page ${index + 1} changed while it was being replaced.`);
  }
  const pagesRef = pdfDoc.catalog.get(N.Pages);
  if (!(pagesRef instanceof PDFRef)) throw new Error("Redaction: the page tree is not indirect.");
  const leaf = PDFPageLeaf.withContextAndParent(context, pagesRef);
  leaf.set(N.MediaBox, context.obj([0, 0, size[0], size[1]]));

  pdfDoc.removePage(index);
  context.assign(ref, leaf);
  const page = PDFPage.of(leaf, ref, pdfDoc);
  pdfDoc.insertPage(index, page);
  if (pdfDoc.getPage(index) !== page || context.lookup(ref) !== leaf) {
    throw new Error(`Redaction: could not replace page ${index + 1}.`);
  }
  return page;
}

/**
 * Indirect objects that belong to the old page dict and must not survive:
 * its content streams (and the /Contents array itself when indirect), its
 * annotations, thumbnail, metadata, piece info, beads, associated files and
 * any other page-level entry. Excluded are the entries that are legitimately
 * shared across pages: /Parent, the inheritable /Resources, /MediaBox,
 * /CropBox and /Rotate (resources are handled by pruneSuspectXObjects), and
 * /Group (a transparency group attribute dict, often one object for the
 * whole file). exemptSharedPageParts later lifts the cut for anything a
 * remaining page also lists directly.
 */
const PAGE_KEEP_KEYS = new Set(
  ["Type", "Parent", "Resources", "MediaBox", "CropBox", "Rotate", "Group"].map((k) =>
    PDFName.of(k),
  ),
);

function collectPageCutRefs(page: PDFPage, into: Set<PDFRef>) {
  const context = page.doc.context;
  for (const [key, value] of page.node.entries()) {
    if (PAGE_KEEP_KEYS.has(key)) continue;
    if (value instanceof PDFRef) into.add(value);
    // /Contents and /Annots are arrays of refs (direct or indirect); cut the
    // elements too, so a referrer to one element can't keep it alive.
    const resolved = value instanceof PDFRef ? context.lookup(value) : value;
    if (resolved instanceof PDFArray) {
      for (const el of resolved.asArray()) if (el instanceof PDFRef) into.add(el);
    }
  }
}

/** Objects a page shares with a page that stays (the same content stream or
 * annotation listed by both) are still visible there, so they are not cut. */
function exemptSharedPageParts(pdfDoc: PDFDocument, cut: Set<PDFRef>) {
  if (cut.size === 0) return;
  const context = pdfDoc.context;
  for (const page of pdfDoc.getPages()) {
    for (const [, value] of page.node.entries()) {
      if (value instanceof PDFRef) cut.delete(value);
      const resolved = value instanceof PDFRef ? context.lookup(value) : value;
      if (resolved instanceof PDFArray) {
        for (const el of resolved.asArray()) if (el instanceof PDFRef) cut.delete(el);
      }
    }
  }
}

/** Image/form XObjects the page's resources list. If a resources dict is shared
 * with other pages, these survive GC through them — pruneSuspectXObjects then
 * checks whether those pages actually draw them. */
function collectSuspectXObjects(page: PDFPage, into: Set<PDFRef>) {
  const resources = page.node.Resources();
  const xobjects = resources?.lookupMaybe(N.XObject, PDFDict);
  if (!xobjects) return;
  for (const [, value] of xobjects.entries()) {
    if (value instanceof PDFRef) into.add(value);
  }
}

/** The /StructParents key of the page and /StructParent keys of its annotations,
 * so their ParentTree entries can be dropped. */
function collectStructParentKeys(page: PDFPage, into: Set<number>) {
  const own = page.node.get(N.StructParents);
  if (own instanceof PDFNumber) into.add(own.asNumber());
  const annots = page.node.Annots();
  if (!annots) return;
  for (let i = 0; i < annots.size(); i++) {
    const annot = annots.lookup(i);
    if (annot instanceof PDFDict) {
      const key = annot.get(N.StructParent);
      if (key instanceof PDFNumber) into.add(key.asNumber());
    }
  }
}

/**
 * Remove every AcroForm field with a widget on this page (field value included).
 * A field with widgets on several pages is removed everywhere — conservative.
 * If the form can't be walked safely, the whole AcroForm is dropped instead.
 * Returns the number of fields removed (or a positive count on the fallback).
 */
function removeFormFieldsOnPage(pdfDoc: PDFDocument, page: PDFPage, warnings: string[]): number {
  if (!pdfDoc.catalog.has(N.AcroForm)) return 0;
  const context = pdfDoc.context;
  const annotDicts = new Set<PDFObject>();
  const annots = page.node.Annots();
  if (annots) {
    for (let i = 0; i < annots.size(); i++) {
      const el = annots.get(i);
      const dict = el instanceof PDFRef ? context.lookup(el) : el;
      if (dict) annotDicts.add(dict);
    }
  }
  try {
    const form = pdfDoc.getForm();
    let removed = 0;
    for (const field of form.getFields()) {
      const widgets = field.acroField.getWidgets();
      const onPage = widgets.some((w) => annotDicts.has(w.dict) || w.P() === page.ref);
      if (!onPage) continue;
      try {
        form.removeField(field);
      } catch {
        // Widget not findable via the page tree (orphan): detach the field
        // from the AcroForm directly; GC drops the dicts.
        form.acroForm.removeField(field.acroField);
      }
      removed++;
    }
    return removed;
  } catch {
    pdfDoc.catalog.delete(N.AcroForm);
    warnings.push(
      "Form fields could not be cleaned up individually, so all form fields were removed from the file.",
    );
    return 1;
  }
}

/** XFA keeps every field value in an XML packet we can't edit surgically. */
function stripXfa(pdfDoc: PDFDocument, warnings: string[]) {
  const acro = pdfDoc.catalog.lookupMaybe(N.AcroForm, PDFDict);
  if (acro?.has(N.XFA)) {
    acro.delete(N.XFA);
    warnings.push("XFA form data was removed because it contained values of redacted fields.");
  }
}

/**
 * Tagged-PDF structure can hold copies of page text (/ActualText, /Alt, /E).
 * Drop every structure element or marked-content reference that points at a
 * redacted page (its ref now resolves to the flattened page, which has no
 * marked content, so those kids are meaningless), and the ParentTree / IDTree
 * entries that would keep them alive. Elements that also have kids on other
 * pages survive with their text copies stripped.
 * Falls back to removing the whole structure tree if anything looks unusual.
 */
function pruneStructTree(
  pdfDoc: PDFDocument,
  redactedPageRefs: PDFRef[],
  structParentKeys: Set<number>,
  warnings: string[],
) {
  const catalog = pdfDoc.catalog;
  const root = catalog.lookupMaybe(N.StructTreeRoot, PDFDict);
  if (!root || redactedPageRefs.length === 0) return;
  const context = pdfDoc.context;
  const removedPages = new Set(redactedPageRefs);
  const droppedElements = new Set<PDFRef>();

  const dropRefs = (arr: PDFArray, remove: (v: PDFObject) => boolean) => {
    const kept = arr.asArray().filter((v) => !remove(v));
    return context.obj(kept);
  };

  try {
    const seen = new Set<PDFDict>();
    /** Returns false when `kid` must be dropped from its parent's /K. */
    const keepKid = (kid: PDFObject, inheritedPg: PDFRef | undefined): boolean => {
      const resolved = kid instanceof PDFRef ? context.lookup(kid) : kid;
      if (resolved instanceof PDFNumber) {
        // A bare MCID lives on the element's page.
        return !(inheritedPg && removedPages.has(inheritedPg));
      }
      if (!(resolved instanceof PDFDict)) return true;
      const pg = resolved.get(N.Pg);
      const ownPg = pg instanceof PDFRef ? pg : inheritedPg;
      const type = resolved.get(N.Type);
      if (type === N.MCR || type === N.OBJR) {
        return !(ownPg && removedPages.has(ownPg));
      }
      // A structure element. If it sits on a removed page (its own /Pg, or the
      // one it inherits from an ancestor), strip the text copies it may carry
      // and keep only kids that live elsewhere; drop it once nothing remains.
      const onRemovedPage = ownPg !== undefined && removedPages.has(ownPg);
      if (onRemovedPage) {
        resolved.delete(N.ActualText);
        resolved.delete(N.Alt);
        resolved.delete(N.E);
      }
      visit(resolved, ownPg);
      const remaining = resolved.get(N.K);
      const empty =
        remaining === undefined || (remaining instanceof PDFArray && remaining.size() === 0);
      if (empty && onRemovedPage) {
        if (kid instanceof PDFRef) droppedElements.add(kid);
        return false;
      }
      return true;
    };
    const visit = (elem: PDFDict, inheritedPg: PDFRef | undefined) => {
      if (seen.has(elem)) return;
      seen.add(elem);
      const K = elem.get(N.K);
      if (K === undefined) return;
      if (K instanceof PDFArray) {
        elem.set(
          N.K,
          dropRefs(K, (v) => !keepKid(v, inheritedPg)),
        );
      } else if (!keepKid(K, inheritedPg)) {
        elem.delete(N.K);
      }
    };
    visit(root, undefined);

    // ParentTree: drop the removed page's / annotations' keys, and any dangling
    // references to elements we dropped.
    const parentTree = root.lookupMaybe(N.ParentTree, PDFDict);
    if (parentTree) pruneNumberTree(parentTree, structParentKeys, droppedElements, context);
    const idTree = root.lookupMaybe(N.IDTree, PDFDict);
    if (idTree) pruneNameTree(idTree, droppedElements, context);
  } catch {
    catalog.delete(N.StructTreeRoot);
    catalog.delete(N.MarkInfo);
    warnings.push(
      "Accessibility tags were removed from the file because they could not be updated safely.",
    );
  }
}

/** Walk a number tree's /Nums (recursing into /Kids) and rebuild each array
 * without the removed keys or values that point at dropped elements. */
function pruneNumberTree(
  node: PDFDict,
  removedKeys: Set<number>,
  dropped: Set<PDFRef>,
  context: PDFDocument["context"],
) {
  const nums = node.lookupMaybe(N.Nums, PDFArray);
  if (nums) {
    const kept: PDFObject[] = [];
    for (let i = 0; i + 1 < nums.size(); i += 2) {
      const key = nums.lookup(i);
      const value = nums.get(i + 1);
      if (key instanceof PDFNumber && removedKeys.has(key.asNumber())) continue;
      kept.push(nums.get(i), scrubValue(value, dropped, context));
    }
    node.set(N.Nums, context.obj(kept));
  }
  const kids = node.lookupMaybe(N.Kids, PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict) pruneNumberTree(kid, removedKeys, dropped, context);
    }
  }
}

function pruneNameTree(node: PDFDict, dropped: Set<PDFRef>, context: PDFDocument["context"]) {
  const names = node.lookupMaybe(N.Names, PDFArray);
  if (names) {
    const kept: PDFObject[] = [];
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const value = names.get(i + 1);
      if (value instanceof PDFRef && dropped.has(value)) continue;
      kept.push(names.get(i), value);
    }
    node.set(N.Names, context.obj(kept));
  }
  const kids = node.lookupMaybe(N.Kids, PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict) pruneNameTree(kid, dropped, context);
    }
  }
}

/** A ParentTree value is an element ref or an array of them; replace dropped
 * refs with null (allowed by the spec) so nothing dangles. */
function scrubValue(value: PDFObject, dropped: Set<PDFRef>, context: PDFDocument["context"]) {
  if (value instanceof PDFRef && dropped.has(value)) return PDFNull;
  const resolved = value instanceof PDFRef ? context.lookup(value) : value;
  if (resolved instanceof PDFArray) {
    const arr = resolved
      .asArray()
      .map((v) => (v instanceof PDFRef && dropped.has(v) ? PDFNull : v));
    return context.obj(arr);
  }
  return value;
}

/**
 * Mark-and-sweep over pdf-lib's object table from the trailer (Root, Info,
 * Encrypt, ID). pdf-lib writes every indirect object it holds, so without this
 * the unlinked content streams, images, fonts and annotations would still be
 * in the file — exactly what redaction must prevent.
 *
 * `cut` refs are dead ends: they are never marked reachable (so they are
 * always deleted) and never traversed (so nothing is kept alive through them),
 * whatever still points at them. A reference to a deleted object is, per the
 * spec, a reference to null.
 */
export function collectGarbage(pdfDoc: PDFDocument, cut: Set<PDFRef> = new Set()) {
  const context = pdfDoc.context;
  const reachable = new Set<PDFRef>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt, ID } = context.trailerInfo;
  for (const entry of [Root, Info, Encrypt, ID]) if (entry) stack.push(entry);

  while (stack.length > 0) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      if (cut.has(obj) || reachable.has(obj)) continue;
      reachable.add(obj);
      const target = context.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
    } else if (obj instanceof PDFArray) {
      for (const value of obj.asArray()) stack.push(value);
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }

  // enumerateIndirectObjects() returns a fresh array, so deleting while
  // iterating is safe.
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) context.delete(ref);
  }
}

/** Decoded `/Name Do` tokens of a page's content streams, or null when a
 * stream can't be decoded (unknown filter) — the caller then keeps everything. */
function usedXObjectNames(page: PDFPage): Set<string> | null {
  const context = page.doc.context;
  const contents = page.node.Contents();
  if (!contents) return new Set();
  const streams: PDFObject[] =
    contents instanceof PDFArray
      ? contents.asArray().map((r) => context.lookup(r) ?? r)
      : [contents];
  const used = new Set<string>();
  for (const stream of streams) {
    if (!(stream instanceof PDFStream)) return null;
    let text: string;
    try {
      const raw =
        stream instanceof PDFRawStream
          ? stream
          : PDFRawStream.of(stream.dict, stream.getContents());
      const bytes = decodePDFRawStream(raw).decode();
      text = latin1(bytes);
    } catch {
      return null;
    }
    for (const m of text.matchAll(/\/([^\s/[\]<>(){}%]+)\s+Do(?![A-Za-z])/g)) {
      used.add(m[1].replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
    }
  }
  return used;
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return s;
}

/**
 * Resources dicts shared between pages keep a redacted page's images reachable
 * even though only that page drew them. For every remaining page that lists a
 * suspect XObject its content never draws, give the page its own resources
 * copy without that entry; the next GC pass then drops the image.
 */
function pruneSuspectXObjects(pdfDoc: PDFDocument, suspects: Set<PDFRef>, warnings: string[]) {
  const context = pdfDoc.context;
  const alive = [...suspects].filter((ref) => context.lookup(ref) !== undefined);
  if (alive.length === 0) return;
  const aliveSet = new Set(alive);
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const resources = page.node.Resources();
    const xobjects = resources?.lookupMaybe(N.XObject, PDFDict);
    if (!resources || !xobjects) continue;
    const listed = xobjects.entries().filter(([, v]) => v instanceof PDFRef && aliveSet.has(v));
    if (listed.length === 0) continue;
    const used = usedXObjectNames(page);
    if (used === null) {
      warnings.push(
        `Page ${i + 1}: could not verify which images it uses, so images shared with a redacted page were kept.`,
      );
      continue;
    }
    const drop = new Set(
      listed.filter(([name]) => !used.has(name.decodeText())).map(([name]) => name),
    );
    if (drop.size === 0) continue;
    const newXObjects = context.obj({});
    for (const [name, value] of xobjects.entries())
      if (!drop.has(name)) newXObjects.set(name, value);
    const newResources = context.obj({});
    for (const [name, value] of resources.entries()) newResources.set(name, value);
    newResources.set(N.XObject, newXObjects);
    page.node.set(N.Resources, newResources);
  }
}

// ---------------------------------------------------------------------------
// Browser platform hooks
// ---------------------------------------------------------------------------

async function browserDeps(): Promise<RedactDeps> {
  if (typeof document === "undefined") {
    throw new Error("Redaction needs a canvas to render pages, which is unavailable here.");
  }
  const { loadPdfDocument } = await import("./pdfOptions");
  return {
    loadDocument: (data) => loadPdfDocument(data),
    createCanvas: (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create a 2D canvas context.");
      return {
        canvas,
        fill(x, y, w, h, color) {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, w, h);
        },
        toJpeg: (quality) =>
          new Promise<Uint8Array>((resolve, reject) => {
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  reject(new Error("Could not encode the redacted page image."));
                  return;
                }
                blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)), reject);
              },
              "image/jpeg",
              quality,
            );
          }),
        dispose() {
          canvas.width = canvas.height = 0;
        },
      };
    },
  };
}
