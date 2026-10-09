/**
 * Tagged-PDF structure tree pruning for pages that leave a document (deleted,
 * replaced, or flattened by redaction). Structure elements can hold copies of a
 * page's text (/ActualText, /Alt, /E), so they must go with the page.
 */
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";

const N = {
  ActualText: PDFName.of("ActualText"),
  Alt: PDFName.of("Alt"),
  E: PDFName.of("E"),
  IDTree: PDFName.of("IDTree"),
  K: PDFName.of("K"),
  Kids: PDFName.of("Kids"),
  MCR: PDFName.of("MCR"),
  MarkInfo: PDFName.of("MarkInfo"),
  Names: PDFName.of("Names"),
  Nums: PDFName.of("Nums"),
  OBJR: PDFName.of("OBJR"),
  ParentTree: PDFName.of("ParentTree"),
  Pg: PDFName.of("Pg"),
  StructParent: PDFName.of("StructParent"),
  StructParents: PDFName.of("StructParents"),
  StructTreeRoot: PDFName.of("StructTreeRoot"),
  Type: PDFName.of("Type"),
};

/** The /StructParents key of the page and /StructParent keys of its annotations,
 * so their ParentTree entries can be dropped. */
export function collectStructParentKeys(page: PDFPage, into: Set<number>) {
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
 * Tagged-PDF structure can hold copies of page text (/ActualText, /Alt, /E).
 * Drop every structure element or marked-content reference that points at a
 * redacted page (its ref now resolves to the flattened page, which has no
 * marked content, so those kids are meaningless), and the ParentTree / IDTree
 * entries that would keep them alive. Elements that also have kids on other
 * pages survive with their text copies stripped.
 * Falls back to removing the whole structure tree if anything looks unusual.
 */
export function pruneStructTree(
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
