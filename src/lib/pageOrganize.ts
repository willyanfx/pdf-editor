import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObjectCopier,
  PDFRef,
  PDFString,
  type PDFPage,
} from "pdf-lib";
import type { LayoutEntry } from "./pageRemap";
import { pruneRemovedPages, removeUnreachableObjects } from "./pageReorder";

/** Load a File as an editable pdf-lib document. */
export async function loadPdf(file: File): Promise<PDFDocument> {
  return PDFDocument.load(await file.arrayBuffer());
}

/**
 * Rewrite `baseDoc` IN PLACE so its pages match `layout` (see lib/pageRemap.ts)
 * and return the saved bytes. Mutating the base document rather than copying
 * into a fresh one keeps document-level data — metadata, outline, form — that
 * a fresh document would drop.
 *
 * Clone entries are copied with their own copyPages call, so the copy shares no
 * mutable objects (content arrays, annotations, form fields) with its original:
 * drawing edits on one page at export can never bleed onto the other. Pages
 * from `extra` are copied in one batch so fonts/images they share are copied
 * once. Form fields on copied pages are registered in the AcroForm (see
 * `adoptCopiedFields`), and fields on replaced pages are dropped.
 */
export async function buildPlannedPdf(
  baseDoc: PDFDocument,
  layout: LayoutEntry[],
  extra?: PDFDocument,
): Promise<Uint8Array> {
  const baseCount = baseDoc.getPageCount();
  const extraCount = extra?.getPageCount() ?? 0;

  // Surviving base pages must stay in ascending order: they are left where they
  // are and everything else is inserted around them.
  let last = -1;
  for (const e of layout) {
    if (e.kind === "base" && (e.index < 0 || e.index >= baseCount)) {
      throw new RangeError(`Page ${e.index + 1} is not in this document.`);
    }
    if (e.kind === "new" && (!extra || e.index < 0 || e.index >= extraCount)) {
      throw new RangeError(`The other PDF doesn't have a page ${e.index + 1}.`);
    }
    if (e.kind === "base" && !e.clone) {
      if (e.index <= last) throw new Error("Page layout must keep original pages in order.");
      last = e.index;
    }
  }

  // 1. Materialize every page that isn't already in baseDoc, before any removal
  //    shifts base indices. Each copyPages call is remembered with its source so
  //    its form fields can be registered once the replaced pages' fields are gone.
  const added: (PDFPage | undefined)[] = Array.from({ length: layout.length });
  const copies: { src: PDFDocument; pages: PDFPage[] }[] = [];
  for (const [pos, e] of layout.entries()) {
    if (e.kind !== "base" || !e.clone) continue;
    [added[pos]] = await baseDoc.copyPages(baseDoc, [e.index]);
    copies.push({ src: baseDoc, pages: [added[pos]] });
  }
  if (extra) {
    // First use of each source page goes in one batch; a repeat gets its own
    // copy for the same independence reason as clones.
    const firstUse = new Map<number, number>();
    const repeats: number[] = [];
    layout.forEach((e, pos) => {
      if (e.kind !== "new") return;
      if (firstUse.has(e.index)) repeats.push(pos);
      else firstUse.set(e.index, pos);
    });
    const batch = await baseDoc.copyPages(extra, [...firstUse.keys()]);
    [...firstUse.values()].forEach((pos, i) => (added[pos] = batch[i]));
    if (batch.length > 0) copies.push({ src: extra, pages: batch });
    for (const pos of repeats) {
      [added[pos]] = await baseDoc.copyPages(extra, [layout[pos].index]);
      copies.push({ src: extra, pages: [added[pos]] });
    }
  }

  // 2. Fields whose widgets sit on replaced pages go first (so a replacement
  //    page's field can keep its name), then the copies' fields join the form.
  const kept = new Set(layout.flatMap((e) => (e.kind === "base" && !e.clone ? [e.index] : [])));
  const removed = baseDoc.getPages().filter((_, i) => !kept.has(i));
  if (removed.length > 0) pruneRemovedPages(baseDoc, removed);
  const taken = topLevelFieldNames(baseDoc);
  for (const { src, pages } of copies) adoptCopiedFields(baseDoc, src, pages, taken);

  // 3. Drop base pages the layout no longer contains (replaced), highest first.
  for (let i = baseCount - 1; i >= 0; i--) if (!kept.has(i)) baseDoc.removePage(i);

  // 4. Kept pages are now in layout order; slot the new ones in around them.
  added.forEach((page, pos) => {
    if (page) baseDoc.insertPage(pos, page);
  });

  // copyPages follows every reference out of a page — an annotation's /P, a
  // field's widgets on other pages — and copies what it reaches, including
  // whole other pages. Those copies, and the replaced pages, are unreachable
  // now; don't ship them.
  if (copies.length > 0 || removed.length > 0) {
    removeUnreachableObjects(baseDoc, new Set(removed.map((p) => p.ref)));
  }

  return baseDoc.save({ useObjectStreams: true });
}

const N = {
  AcroForm: PDFName.of("AcroForm"),
  Annots: PDFName.of("Annots"),
  DA: PDFName.of("DA"),
  DR: PDFName.of("DR"),
  FT: PDFName.of("FT"),
  Fields: PDFName.of("Fields"),
  Kids: PDFName.of("Kids"),
  NeedAppearances: PDFName.of("NeedAppearances"),
  P: PDFName.of("P"),
  Parent: PDFName.of("Parent"),
  Q: PDFName.of("Q"),
  Subtype: PDFName.of("Subtype"),
  T: PDFName.of("T"),
  Widget: PDFName.of("Widget"),
};

function acroFormOf(doc: PDFDocument): PDFDict | undefined {
  return doc.catalog.lookupMaybe(N.AcroForm, PDFDict);
}

function fieldName(dict: PDFDict): string | undefined {
  const t = dict.lookup(N.T);
  return t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : undefined;
}

/** Partial names of the form's top-level fields: two fields whose top-level
 * names differ can never share a fully-qualified name. */
function topLevelFieldNames(doc: PDFDocument): Set<string> {
  const names = new Set<string>();
  const fields = acroFormOf(doc)?.lookupMaybe(N.Fields, PDFArray);
  for (let i = 0; i < (fields?.size() ?? 0); i++) {
    const dict = fields!.lookupMaybe(i, PDFDict);
    const name = dict && fieldName(dict);
    if (name !== undefined) names.add(name);
  }
  return names;
}

/** `name` if free, else `name_2`, `name_3`, … — the first one not taken. */
function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name}_${n}`)) n++;
  return `${name}_${n}`;
}

/**
 * Make the form fields on freshly copied `pages` real fields of `base`.
 *
 * copyPages deep-copies each widget and its /Parent chain but never touches the
 * catalog, so the copies are invisible to anything that walks /AcroForm
 * /Fields (pdf.js getFieldObjects, pdf-lib getForm, export, flatten). This:
 * - points every copied annotation's /P at its new page (copyPages pointed it
 *   at a stray extra copy of the source page);
 * - drops widgets the copied fields have on pages that weren't copied;
 * - renames a copied top-level field whose name is `taken` to the next free
 *   `name_N` (always the case for a clone, whose original is still there), so
 *   the copy is an independent field rather than a second widget of the
 *   original's name — the rename is on the top-level /T only, so radio
 *   groups and other kid hierarchies stay intact underneath;
 * - adds the top-level fields to /AcroForm /Fields, creating the AcroForm if
 *   needed and carrying over the source form's /DR resources, its default
 *   /DA and /Q, and NeedAppearances.
 */
function adoptCopiedFields(
  base: PDFDocument,
  src: PDFDocument,
  pages: PDFPage[],
  taken: Set<string>,
) {
  const ctx = base.context;
  const onPages = new Set<PDFRef>();
  const tops: PDFRef[] = [];

  for (const page of pages) {
    const annots = page.node.lookupMaybe(N.Annots, PDFArray);
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const ref = annots!.get(i);
      const annot = annots!.lookupMaybe(i, PDFDict);
      if (!annot) continue;
      if (annot.has(N.P)) annot.set(N.P, page.ref);
      if (!(ref instanceof PDFRef) || annot.get(N.Subtype) !== N.Widget) continue;
      onPages.add(ref);

      // Climb to the top-level field; a widget is a field only if something on
      // the way up says what kind (/FT is inheritable).
      let top = ref;
      let dict = annot;
      let isField = dict.has(N.FT);
      const seen = new Set<PDFRef>([ref]);
      for (let up = dict.get(N.Parent); up instanceof PDFRef && !seen.has(up); ) {
        const parent = ctx.lookupMaybe(up, PDFDict);
        if (!parent) break;
        seen.add(up);
        top = up;
        dict = parent;
        isField ||= dict.has(N.FT);
        up = dict.get(N.Parent);
      }
      if (isField && !tops.includes(top)) tops.push(top);
    }
  }
  if (tops.length === 0) return;

  const acroForm = base.catalog.getOrCreateAcroForm();
  if (src !== base) mergeFormDefaults(acroForm.dict, acroFormOf(src), src, base, tops);

  for (const top of tops) {
    const dict = ctx.lookup(top, PDFDict);
    pruneKids(dict, onPages, ctx);
    const name = fieldName(dict);
    if (name !== undefined) {
      const unique = freeName(name, taken);
      if (unique !== name) dict.set(N.T, PDFHexString.fromText(unique));
      taken.add(unique);
    }
    acroForm.addField(top);
  }
}

/** Remove widgets under `field` that aren't on the copied pages, and any
 * intermediate field left without kids. */
function pruneKids(field: PDFDict, onPages: Set<PDFRef>, ctx: PDFDocument["context"]) {
  const kids = field.lookupMaybe(N.Kids, PDFArray);
  if (!kids) return;
  for (let i = kids.size() - 1; i >= 0; i--) {
    const ref = kids.get(i);
    const kid = ctx.lookupMaybe(ref, PDFDict);
    if (!kid) continue;
    if (kid.get(N.Subtype) === N.Widget) {
      if (!(ref instanceof PDFRef) || !onPages.has(ref)) kids.remove(i);
    } else if (kid.has(N.Kids)) {
      pruneKids(kid, onPages, ctx);
      if ((kid.lookupMaybe(N.Kids, PDFArray)?.size() ?? 0) === 0) kids.remove(i);
    }
  }
}

/**
 * Bring the source form's document-wide defaults along with its fields:
 * /DR entries the base lacks (fonts named by the fields' /DA), NeedAppearances,
 * and the default /DA and /Q — set on the form when the base had none, else on
 * each incoming top-level field that doesn't override them, so the base's
 * defaults don't silently restyle the incoming fields.
 */
function mergeFormDefaults(
  baseForm: PDFDict,
  srcForm: PDFDict | undefined,
  src: PDFDocument,
  base: PDFDocument,
  tops: PDFRef[],
) {
  if (!srcForm) return;
  const copier = PDFObjectCopier.for(src.context, base.context);

  const srcDR = srcForm.lookupMaybe(N.DR, PDFDict);
  if (srcDR) {
    const baseDR = baseForm.lookupMaybe(N.DR, PDFDict);
    if (!baseDR) {
      baseForm.set(N.DR, copier.copy(srcDR));
    } else {
      for (const [category, value] of srcDR.entries()) {
        const srcSub = srcDR.lookupMaybe(category, PDFDict);
        const baseSub = baseDR.lookupMaybe(category, PDFDict);
        if (!baseDR.has(category)) baseDR.set(category, copier.copy(value));
        else if (srcSub && baseSub) {
          // A resource name the base already uses keeps the base's object.
          for (const [key, res] of srcSub.entries()) {
            if (!baseSub.has(key)) baseSub.set(key, copier.copy(res));
          }
        }
      }
    }
  }

  if (srcForm.lookup(N.NeedAppearances) === PDFBool.True) {
    baseForm.set(N.NeedAppearances, PDFBool.True);
  }

  for (const key of [N.DA, N.Q]) {
    const value = srcForm.lookup(key);
    if (value === undefined) continue;
    const baseValue = baseForm.lookup(key);
    if (baseValue === undefined) {
      baseForm.set(key, copier.copy(value));
    } else if (baseValue.toString() !== value.toString()) {
      for (const top of tops) {
        const dict = base.context.lookup(top, PDFDict);
        if (!dict.has(key)) dict.set(key, copier.copy(value));
      }
    }
  }
}
