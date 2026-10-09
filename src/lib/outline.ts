import {
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFDocument,
} from "pdf-lib";
import { resolveBookmarksForOutput, type Bookmark, type OutputBookmark } from "./bookmarks";

/**
 * Write `bookmarks` as the output document's outline (catalog /Outlines),
 * replacing whatever outline the document already had.
 *
 * Works on either export path (the in-place source document or a freshly
 * rebuilt one) because it only needs the output's page refs and export's
 * `origToOut` map (original page index → output position, -1 = dropped).
 * Bookmarks on dropped pages are pruned and their children promoted. With no
 * bookmarks left, the old outline is removed and no /Outlines is written.
 *
 * All outline items are written open (positive /Count), so a viewer shows
 * the full tree the way the editor's panel does.
 */
export function writeOutline(
  pdfDoc: PDFDocument,
  bookmarks: Bookmark[],
  origToOut: readonly number[],
): void {
  removeOutline(pdfDoc);

  const tree = resolveBookmarksForOutput(bookmarks, origToOut);
  if (tree.length === 0) return;

  const { context } = pdfDoc;
  const pageRefs = pdfDoc.getPages().map((p) => p.ref);
  const rootRef = context.nextRef();

  /** Build one sibling level under `parentRef`; returns its first/last refs
   * and how many items it contributes to the parent's (open) /Count. */
  function buildLevel(
    nodes: OutputBookmark[],
    parentRef: PDFRef,
  ): { first: PDFRef; last: PDFRef; count: number } {
    const refs = nodes.map(() => context.nextRef());
    let count = 0;
    nodes.forEach((node, i) => {
      const dict = context.obj({});
      dict.set(PDFName.of("Title"), PDFHexString.fromText(node.title));
      dict.set(PDFName.of("Parent"), parentRef);
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i < nodes.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]);

      const pageRef = node.outPage !== null ? pageRefs[node.outPage] : undefined;
      if (pageRef) {
        const dest =
          node.top !== undefined && Number.isFinite(node.top)
            ? [pageRef, PDFName.of("XYZ"), PDFNull, PDFNumber.of(node.top), PDFNull]
            : [pageRef, PDFName.of("Fit")];
        dict.set(PDFName.of("Dest"), context.obj(dest));
      } else if (node.url) {
        const action = context.obj({});
        action.set(PDFName.of("S"), PDFName.of("URI"));
        action.set(PDFName.of("URI"), PDFString.of(asciiUri(node.url)));
        dict.set(PDFName.of("A"), action);
      }

      count += 1;
      if (node.children.length > 0) {
        const sub = buildLevel(node.children, refs[i]);
        dict.set(PDFName.of("First"), sub.first);
        dict.set(PDFName.of("Last"), sub.last);
        dict.set(PDFName.of("Count"), PDFNumber.of(sub.count));
        count += sub.count;
      }
      context.assign(refs[i], dict);
    });
    return { first: refs[0], last: refs[refs.length - 1], count };
  }

  const top = buildLevel(tree, rootRef);
  const root = context.obj({});
  root.set(PDFName.of("Type"), PDFName.of("Outlines"));
  root.set(PDFName.of("First"), top.first);
  root.set(PDFName.of("Last"), top.last);
  root.set(PDFName.of("Count"), PDFNumber.of(top.count));
  context.assign(rootRef, root);
  pdfDoc.catalog.set(PDFName.of("Outlines"), rootRef);
}

/**
 * Drop the catalog's /Outlines and delete the old outline item objects so they
 * aren't saved as orphans. Only the item dictionaries are deleted — their
 * destinations/actions may be shared with links elsewhere in the file.
 */
export function removeOutline(pdfDoc: PDFDocument): void {
  const { catalog, context } = pdfDoc;
  const rootEntry = catalog.get(PDFName.of("Outlines"));
  catalog.delete(PDFName.of("Outlines"));
  if (!(rootEntry instanceof PDFRef)) return;

  const seen = new Set<string>();
  const stack: PDFRef[] = [rootEntry];
  for (let ref = stack.pop(); ref; ref = stack.pop()) {
    const key = ref.toString();
    if (seen.has(key)) continue; // guard against malformed cyclic outlines
    seen.add(key);
    const dict = context.lookup(ref);
    if (dict instanceof PDFDict) {
      for (const name of ["First", "Next"]) {
        const next = dict.get(PDFName.of(name));
        if (next instanceof PDFRef) stack.push(next);
      }
    }
    context.delete(ref);
  }
}

/** PDF URI strings are 7-bit ASCII; percent-encode anything else. */
function asciiUri(url: string): string {
  return url.replace(/[^\x20-\x7e]/g, (c) => encodeURIComponent(c));
}
