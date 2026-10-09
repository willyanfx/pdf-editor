import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";
import { collectStructParentKeys, pruneStructTree } from "./structTree";

/**
 * Reorder and/or drop pages IN PLACE on a loaded document.
 *
 * Export used to rebuild reordered documents with `PDFDocument.create()` +
 * `copyPages`, which copies page objects but not the catalog — so the AcroForm
 * (fields stopped working), Outlines, and Names/Dests were silently lost. Here
 * the same document is kept and only its page tree is rewritten, so the catalog
 * and every reference into the kept pages (bookmarks, link targets, form
 * widgets' /P) survive untouched.
 *
 * `order` lists ORIGINAL page indices in output order; entries must be unique
 * (out-of-range ones are ignored). Returns `origToOut`: original index → output
 * position, or -1 when the page was dropped.
 */
export function reorderPagesInPlace(doc: PDFDocument, order: number[]): number[] {
  const pages = doc.getPages();
  const count = pages.length;
  const origToOut = Array.from({ length: count }, () => -1);
  const seen = new Set<number>();
  const kept: number[] = [];
  for (const i of order) {
    if (i < 0 || i >= count || seen.has(i)) continue;
    seen.add(i);
    kept.push(i);
  }
  kept.forEach((orig, pos) => (origToOut[orig] = pos));

  const removed = pages.filter((_, i) => !seen.has(i));

  // Moving a page out of an intermediate /Pages node would change what it
  // inherits (Resources, MediaBox, CropBox, Rotate) — copyPages flattened these,
  // so do the same before detaching anything.
  for (const i of kept) pinInheritedAttributes(pages[i]);

  // Fields and structure elements need the original page → content mapping, so
  // prune them before the removed pages leave the tree.
  if (removed.length > 0) pruneRemovedPages(doc, removed);
  // Page labels are keyed by page index; rebuild them for the new order.
  remapPageLabels(doc, kept);

  // Detach every page (pruning now-empty intermediate nodes), then re-insert the
  // kept ones in order. insertPage accepts the same PDFPage objects because they
  // belong to this document, so every page keeps its object ref.
  for (let i = count - 1; i >= 0; i--) doc.removePage(i);
  kept.forEach((orig, pos) => doc.insertPage(pos, pages[orig]));

  // The dropped pages (and anything only they used) are now unreachable but
  // would still be written out — deleted content must not ship in the file.
  if (removed.length > 0) removeUnreachableObjects(doc, new Set(removed.map((p) => p.ref)));

  return origToOut;
}

/**
 * Drop what belongs only to `removedPages` from document-level structures:
 * AcroForm fields whose widgets all sat there, and structure-tree elements
 * (which can hold copies of the page's text in /ActualText, /Alt, /E).
 * Call before the pages leave the page tree.
 */
export function pruneRemovedPages(doc: PDFDocument, removedPages: PDFPage[]) {
  pruneFieldsOnRemovedPages(doc, removedPages);
  const structParentKeys = new Set<number>();
  for (const page of removedPages) collectStructParentKeys(page, structParentKeys);
  const warnings: string[] = [];
  pruneStructTree(
    doc,
    removedPages.map((p) => p.ref),
    structParentKeys,
    warnings,
  );
  for (const w of warnings) console.warn(`[pageReorder] ${w}`);
}

/** One page's label as the /PageLabels tree defines it. */
type PageLabel = { style?: PDFObject; prefix?: PDFObject; number: number };

/**
 * Rewrite /PageLabels for pages that now appear in `kept` order (ORIGINAL
 * indices). Each output page keeps the label it had; a new range starts
 * wherever the numbering no longer simply continues. No-op without labels.
 */
export function remapPageLabels(doc: PDFDocument, kept: number[]) {
  const { catalog, context } = doc;
  const tree = catalog.lookupMaybe(PDFName.of("PageLabels"), PDFDict);
  if (!tree) return;
  const ranges: { start: number; dict: PDFDict }[] = [];
  collectNumberTree(tree, ranges);
  if (ranges.length === 0) return;
  ranges.sort((a, b) => a.start - b.start);

  const labelOf = (index: number): PageLabel | null => {
    let range: (typeof ranges)[number] | undefined;
    for (const r of ranges) if (r.start <= index) range = r;
    if (!range) return null;
    const st = range.dict.lookupMaybe(PDFName.of("St"), PDFNumber)?.asNumber() ?? 1;
    return {
      style: range.dict.get(PDFName.of("S")),
      prefix: range.dict.get(PDFName.of("P")),
      number: st + (index - range.start),
    };
  };

  const nums: PDFObject[] = [];
  let prev: PageLabel | null = null;
  kept.forEach((orig, pos) => {
    const label = labelOf(orig);
    const continues =
      prev !== null &&
      label !== null &&
      label.style === prev.style &&
      label.prefix === prev.prefix &&
      label.number === prev.number + 1;
    if (!continues && (label !== null || pos === 0)) {
      const dict = context.obj({});
      if (label?.style) dict.set(PDFName.of("S"), label.style);
      if (label?.prefix) dict.set(PDFName.of("P"), label.prefix);
      if (label && label.number !== 1) dict.set(PDFName.of("St"), PDFNumber.of(label.number));
      nums.push(PDFNumber.of(pos), dict);
    }
    prev = label;
  });
  catalog.set(PDFName.of("PageLabels"), context.obj({ Nums: context.obj(nums) }));
}

function collectNumberTree(node: PDFDict, into: { start: number; dict: PDFDict }[]) {
  const nums = node.lookupMaybe(PDFName.of("Nums"), PDFArray);
  if (nums) {
    for (let i = 0; i + 1 < nums.size(); i += 2) {
      const key = nums.lookup(i);
      const dict = nums.lookup(i + 1);
      if (key instanceof PDFNumber && dict instanceof PDFDict) {
        into.push({ start: key.asNumber(), dict });
      }
    }
  }
  const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict) collectNumberTree(kid, into);
    }
  }
}

const INHERITABLE = ["Resources", "MediaBox", "CropBox", "Rotate"] as const;

function pinInheritedAttributes(page: PDFPage) {
  const { node } = page;
  const context = node.context;
  for (const key of INHERITABLE) {
    const name = PDFName.of(key);
    if (node.get(name) !== undefined) continue;
    const inherited = node.getInheritableAttribute(name);
    if (inherited === undefined) continue;
    // Clone direct dicts/arrays so later drawing (which adds fonts/XObjects to
    // Resources) can't leak into sibling pages that inherited the same object.
    node.set(
      name,
      inherited instanceof PDFDict || inherited instanceof PDFArray
        ? inherited.clone(context)
        : inherited,
    );
  }
}

/**
 * Drop AcroForm widgets that sit on `removedPages`, and any field left with no
 * widgets, so the output has no fields pointing at pages that no longer exist.
 * Fields with widgets on surviving pages keep working (only the dead widgets go).
 */
export function pruneFieldsOnRemovedPages(doc: PDFDocument, removedPages: PDFPage[]) {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const fields = acroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (!acroForm || !fields) return;

  const removedPageRefs = new Set<PDFRef>(removedPages.map((p) => p.ref));
  const onRemoved = new Set<PDFRef>();
  const onKept = new Set<PDFRef>();
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const bucket = removedPageRefs.has(page.ref) ? onRemoved : onKept;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (ref instanceof PDFRef) bucket.add(ref);
    }
  }

  const isDeadWidget = (ref: PDFRef | undefined, dict: PDFDict) => {
    if (dict.get(PDFName.of("Subtype")) !== PDFName.of("Widget")) return false;
    if (ref && onKept.has(ref)) return false;
    if (ref && onRemoved.has(ref)) return true;
    // Not listed in any page's /Annots: fall back to the widget's /P.
    const p = dict.get(PDFName.of("P"));
    return p instanceof PDFRef && removedPageRefs.has(p);
  };

  const removedRefs = new Set<PDFRef>();
  const prune = (arr: PDFArray) => {
    for (let i = arr.size() - 1; i >= 0; i--) {
      const raw = arr.get(i);
      const ref = raw instanceof PDFRef ? raw : undefined;
      const dict = doc.context.lookup(raw);
      if (!(dict instanceof PDFDict)) continue;
      const kids = dict.lookupMaybe(PDFName.of("Kids"), PDFArray);
      if (kids && kids.size() > 0) {
        prune(kids);
        if (kids.size() === 0) {
          arr.remove(i);
          if (ref) removedRefs.add(ref);
        }
      } else if (isDeadWidget(ref, dict)) {
        arr.remove(i);
        if (ref) removedRefs.add(ref);
      }
    }
  };
  prune(fields);

  // The calculation order may list fields that no longer exist.
  const co = acroForm.lookupMaybe(PDFName.of("CO"), PDFArray);
  if (co) {
    for (let i = co.size() - 1; i >= 0; i--) {
      const ref = co.get(i);
      if (ref instanceof PDFRef && removedRefs.has(ref)) co.remove(i);
    }
  }
}

/**
 * Delete every indirect object no longer reachable from the trailer (Root,
 * Info, Encrypt, ID). pdf-lib writes every indirect object it holds, so without
 * this, unlinked content streams, images, fonts and annotations would still
 * ship in the file — which page deletion and redaction must prevent.
 *
 * `cut` refs are dead ends: never marked reachable (so always deleted) and
 * never traversed (so nothing is kept alive through them), whatever still
 * points at them (e.g. a bookmark that targeted a deleted page). A reference to
 * a deleted object is, per the spec, a reference to null.
 */
export function removeUnreachableObjects(doc: PDFDocument, cut: Set<PDFRef> = new Set()) {
  const { context } = doc;
  const reachable = new Set<PDFRef>();
  const { Root, Info, Encrypt, ID } = context.trailerInfo;
  const stack: PDFObject[] = [Root, Info, Encrypt, ID].filter(
    (o): o is PDFObject => o !== undefined,
  );

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
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }

  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) context.delete(ref);
  }
}
