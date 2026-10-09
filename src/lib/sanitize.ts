import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import { removeOutline } from "./outline";
import { removeUnreachableObjects } from "./pageReorder";

/** What "Remove hidden information" can strip. Fillable forms are flattened by
 * the export pass (flattenForms), not here, so they aren't an option. */
export type SanitizeOptions = {
  /** Document properties, XMP metadata, private app data (/PieceInfo), page thumbnails. */
  metadata: boolean;
  /** Embedded files, file-attachment annotations, associated files. */
  attachments: boolean;
  /** JavaScript in the document, pages, links and form fields. */
  javascript: boolean;
  /** Comment and markup annotations (notes, highlights, stamps, drawings…). */
  comments: boolean;
  /** The bookmark outline. */
  bookmarks: boolean;
};

export const DEFAULT_SANITIZE: SanitizeOptions = {
  metadata: true,
  attachments: true,
  javascript: true,
  comments: true,
  bookmarks: true,
};

/** Items found in (or removed from) a document, per category. */
export type HiddenInfoReport = {
  metadata: number;
  attachments: number;
  javascript: number;
  comments: number;
  bookmarks: number;
  /** Optional-content layers that are switched off. Reported, never removed:
   * deleting the layer table would make that content visible. */
  hiddenLayers: number;
};

const n = (s: string) => PDFName.of(s);

/** Annotation subtypes that are comments/markup (links, widgets stay). */
const COMMENT_SUBTYPES = new Set([
  "Text",
  "FreeText",
  "Highlight",
  "Underline",
  "StrikeOut",
  "Squiggly",
  "Caret",
  "Stamp",
  "Ink",
  "Line",
  "Square",
  "Circle",
  "Polygon",
  "PolyLine",
  "Popup",
]);

function emptyReport(): HiddenInfoReport {
  return { metadata: 0, attachments: 0, javascript: 0, comments: 0, bookmarks: 0, hiddenLayers: 0 };
}

function dictOf(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | undefined {
  const v = ctx.lookup(obj);
  if (v instanceof PDFDict) return v;
  if (v instanceof PDFStream) return v.dict;
  return undefined;
}

/** True for a JavaScript action, or any action whose /Next chain reaches one
 * (a harmless-looking URI action can chain into a script). */
function isJsAction(ctx: PDFContext, obj: PDFObject | undefined): boolean {
  const seen = new Set<PDFDict>();
  const queue: (PDFObject | undefined)[] = [obj];
  for (let cur = queue.pop(); queue.length || cur; cur = queue.pop()) {
    const action = dictOf(ctx, cur);
    if (!action || seen.has(action)) continue;
    seen.add(action);
    const s = ctx.lookup(action.get(n("S")));
    if (s instanceof PDFName && s.decodeText() === "JavaScript") return true;
    // /Next is one action or an array of them.
    const next = ctx.lookup(action.get(n("Next")));
    if (next instanceof PDFArray) for (let i = 0; i < next.size(); i++) queue.push(next.get(i));
    else queue.push(next);
  }
  return false;
}

function subtypeOf(ctx: PDFContext, dict: PDFDict): string | undefined {
  const s = ctx.lookup(dict.get(n("Subtype")));
  return s instanceof PDFName ? s.decodeText() : undefined;
}

/** Number of leaves (name -> value pairs) in a name tree. */
function countNameTree(ctx: PDFContext, root: PDFObject | undefined): number {
  const seen = new Set<PDFDict>();
  const walk = (node: PDFObject | undefined): number => {
    const dict = dictOf(ctx, node);
    if (!dict || seen.has(dict)) return 0;
    seen.add(dict);
    let total = 0;
    const names = ctx.lookup(dict.get(n("Names")));
    if (names instanceof PDFArray) total += Math.floor(names.size() / 2);
    const kids = ctx.lookup(dict.get(n("Kids")));
    if (kids instanceof PDFArray) {
      for (let i = 0; i < kids.size(); i++) total += walk(kids.get(i));
    }
    return total;
  };
  return walk(root);
}

/** Outline entries, following /First and /Next iteratively (cycle-safe). */
function countOutline(ctx: PDFContext, root: PDFObject | undefined): number {
  const seen = new Set<PDFDict>();
  const stack: (PDFObject | undefined)[] = [dictOf(ctx, root)?.get(n("First"))];
  let total = 0;
  for (let cur = stack.pop(); stack.length || cur; cur = stack.pop()) {
    const item = dictOf(ctx, cur);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    total++;
    stack.push(item.get(n("First")), item.get(n("Next")));
  }
  return total;
}

/** Every form field dict reachable from the AcroForm, for /AA scanning. */
function formFieldDicts(ctx: PDFContext, catalog: PDFDict): PDFDict[] {
  const out: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const visit = (obj: PDFObject | undefined) => {
    const dict = dictOf(ctx, obj);
    if (!dict || seen.has(dict)) return;
    seen.add(dict);
    out.push(dict);
    const kids = ctx.lookup(dict.get(n("Kids")));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) visit(kids.get(i));
  };
  const fields = ctx.lookup(dictOf(ctx, catalog.get(n("AcroForm")))?.get(n("Fields")));
  if (fields instanceof PDFArray) for (let i = 0; i < fields.size(); i++) visit(fields.get(i));
  return out;
}

/** Annotation dicts of a page, with the array slot each came from. */
function pageAnnots(ctx: PDFContext, pageNode: PDFDict) {
  const annots = ctx.lookup(pageNode.get(n("Annots")));
  const out: { index: number; dict: PDFDict }[] = [];
  if (!(annots instanceof PDFArray)) return { annots: undefined, out };
  for (let i = 0; i < annots.size(); i++) {
    const dict = dictOf(ctx, annots.get(i));
    if (dict) out.push({ index: i, dict });
  }
  return { annots, out };
}

/** Strip JavaScript actions from `owner`'s /A and /AA; returns how many were removed. */
function stripJsActions(ctx: PDFContext, owner: PDFDict): number {
  let removed = 0;
  if (isJsAction(ctx, owner.get(n("A")))) {
    owner.delete(n("A"));
    removed++;
  }
  const aa = dictOf(ctx, owner.get(n("AA")));
  if (aa) {
    for (const key of aa.keys()) {
      if (isJsAction(ctx, aa.get(key))) {
        aa.delete(key);
        removed++;
      }
    }
    if (aa.keys().length === 0) owner.delete(n("AA"));
  }
  return removed;
}

/** Count (and, when `apply`, remove) each category of hidden information. */
function inspectOrStrip(
  doc: PDFDocument,
  options: SanitizeOptions,
  apply: boolean,
  /** Collects refs of removed annotations so the sweep can't keep them alive. */
  removedRefs: Set<PDFRef> = new Set(),
): HiddenInfoReport {
  const ctx = doc.context;
  const catalog = doc.catalog;
  const report = emptyReport();
  const pages = doc.getPages();

  // --- Metadata ---------------------------------------------------------
  const info = dictOf(ctx, ctx.trailerInfo.Info);
  if (info && info.keys().length > 0) report.metadata++;
  if (apply && options.metadata) ctx.trailerInfo.Info = undefined;
  // /Metadata (XMP), /PieceInfo (app-private data) and /Thumb can hang off the
  // catalog, pages, XObjects, fonts… so sweep every object rather than a fixed list.
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
    if (!dict) continue;
    for (const key of ["Metadata", "PieceInfo", "Thumb"]) {
      if (!dict.has(n(key))) continue;
      report.metadata++;
      if (apply && options.metadata) dict.delete(n(key));
    }
  }

  // --- Attachments ------------------------------------------------------
  const names = dictOf(ctx, catalog.get(n("Names")));
  if (names?.has(n("EmbeddedFiles"))) {
    report.attachments += countNameTree(ctx, names.get(n("EmbeddedFiles")));
    if (apply && options.attachments) names.delete(n("EmbeddedFiles"));
  }
  for (const holder of [catalog, ...pages.map((p) => p.node)]) {
    if (!holder.has(n("AF"))) continue;
    if (apply && options.attachments) holder.delete(n("AF"));
  }

  // --- JavaScript -------------------------------------------------------
  if (names?.has(n("JavaScript"))) {
    report.javascript += countNameTree(ctx, names.get(n("JavaScript")));
    if (apply && options.javascript) names.delete(n("JavaScript"));
  }
  // A merged field/widget is both an AcroForm field and a page annotation;
  // visit each dict once so scan counts match what removal reports.
  const jsDone = new Set<PDFDict>();
  const js = (owner: PDFDict) => {
    if (jsDone.has(owner)) return;
    jsDone.add(owner);
    const count = apply && options.javascript ? stripJsActions(ctx, owner) : countJs(ctx, owner);
    report.javascript += count;
  };
  js(catalog);
  for (const field of formFieldDicts(ctx, catalog)) js(field);

  // --- Per-page: annotations, page actions -----------------------------
  for (const page of pages) {
    js(page.node);
    const { annots, out } = pageAnnots(ctx, page.node);
    const remove: number[] = [];
    for (const { index, dict } of out) {
      const subtype = subtypeOf(ctx, dict);
      if (subtype === "FileAttachment") {
        report.attachments++;
        if (apply && options.attachments) remove.push(index);
      } else if (subtype && COMMENT_SUBTYPES.has(subtype)) {
        // Popups only exist to display another comment, so they don't count.
        if (subtype !== "Popup") report.comments++;
        if (apply && options.comments) remove.push(index);
      } else {
        js(dict);
      }
    }
    if (annots && remove.length) {
      for (const i of remove.reverse()) {
        const entry = annots.get(i);
        if (entry instanceof PDFRef) removedRefs.add(entry);
        annots.remove(i);
      }
    }
  }

  // --- Bookmarks --------------------------------------------------------
  const outlines = catalog.get(n("Outlines"));
  if (outlines) {
    report.bookmarks = countOutline(ctx, outlines);
    if (apply && options.bookmarks) {
      removeOutline(doc);
      const mode = ctx.lookup(catalog.get(n("PageMode")));
      if (mode instanceof PDFName && mode.decodeText() === "UseOutlines") {
        catalog.delete(n("PageMode"));
      }
    }
  }

  // --- Hidden layers (report only) --------------------------------------
  const oc = dictOf(ctx, catalog.get(n("OCProperties")));
  const config = dictOf(ctx, oc?.get(n("D")));
  if (oc && config) {
    const off = ctx.lookup(config.get(n("OFF")));
    const base = ctx.lookup(config.get(n("BaseState")));
    const all = ctx.lookup(oc.get(n("OCGs")));
    if (base instanceof PDFName && base.decodeText() === "OFF" && all instanceof PDFArray) {
      report.hiddenLayers = all.size();
    } else if (off instanceof PDFArray) {
      report.hiddenLayers = off.size();
    }
  }
  return report;
}

/** JavaScript actions on `owner`, counted without removing them. */
function countJs(ctx: PDFContext, owner: PDFDict): number {
  let count = isJsAction(ctx, owner.get(n("A"))) ? 1 : 0;
  const aa = dictOf(ctx, owner.get(n("AA")));
  if (aa) for (const key of aa.keys()) if (isJsAction(ctx, aa.get(key))) count++;
  return count;
}

/** The catalog's /OpenAction is a JS action or a destination; only JS is removed. */
function stripOpenAction(doc: PDFDocument, options: SanitizeOptions, apply: boolean): number {
  const open = doc.catalog.get(n("OpenAction"));
  if (!isJsAction(doc.context, open)) return 0;
  if (apply && options.javascript) doc.catalog.delete(n("OpenAction"));
  return 1;
}

/** What hiding in the document the dialog should list, without changing it. */
export async function scanHiddenInfo(
  pdfBytes: Uint8Array | ArrayBuffer,
): Promise<HiddenInfoReport> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const report = inspectOrStrip(doc, DEFAULT_SANITIZE, false);
  report.javascript += stripOpenAction(doc, DEFAULT_SANITIZE, false);
  return report;
}

/**
 * Remove the selected categories and return the rewritten PDF. Unlinked
 * objects are dropped afterwards — pdf-lib writes every object it holds, so
 * without that sweep a "removed" attachment or thumbnail would still be
 * sitting in the file, just unreferenced.
 */
export async function sanitizePdf(
  pdfBytes: Uint8Array | ArrayBuffer,
  options: SanitizeOptions,
): Promise<{ bytes: Uint8Array; removed: HiddenInfoReport }> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const cut = new Set<PDFRef>();
  const removed = inspectOrStrip(doc, options, true, cut);
  removed.javascript += stripOpenAction(doc, options, true);
  // A removed annotation can still hang off the structure tree (OBJR), which
  // would keep its text alive in the file; cut those refs explicitly.
  removeUnreachableObjects(doc, cut);
  const bytes = await doc.save();
  return { bytes, removed: pickRemoved(removed, options) };
}

/** Zero the categories the user left unticked, so the summary lists only what was removed. */
function pickRemoved(found: HiddenInfoReport, options: SanitizeOptions): HiddenInfoReport {
  return {
    metadata: options.metadata ? found.metadata : 0,
    attachments: options.attachments ? found.attachments : 0,
    javascript: options.javascript ? found.javascript : 0,
    comments: options.comments ? found.comments : 0,
    bookmarks: options.bookmarks ? found.bookmarks : 0,
    hiddenLayers: found.hiddenLayers,
  };
}

/** True when at least one removable category has something in it. */
export function hasHiddenInfo(report: HiddenInfoReport): boolean {
  return (
    report.metadata + report.attachments + report.javascript + report.comments + report.bookmarks >
    0
  );
}

/** "3 comments, 1 attachment and metadata" — a one-line summary of what was removed. */
export function describeRemoved(removed: HiddenInfoReport): string {
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (removed.comments) parts.push(plural(removed.comments, "comment"));
  if (removed.attachments) parts.push(plural(removed.attachments, "attachment"));
  if (removed.javascript) parts.push(plural(removed.javascript, "script"));
  if (removed.bookmarks) parts.push(plural(removed.bookmarks, "bookmark"));
  if (removed.metadata) parts.push("metadata");
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
