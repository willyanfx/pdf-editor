import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFStream,
  PDFString,
} from "pdf-lib";
import { buildSrgbProfile, SRGB_PROFILE_NAME } from "./iccSrgb";
import { loadPdfLibDocument } from "./pdfLoad";
import { dictOf, nameOf, plural } from "./pdfObjects";
import { sanitizeDocument, scanHiddenInfoOfDocument } from "./sanitize";
import { buildPdfaXmp, setXmp } from "./xmp";

/**
 * Best-effort PDF/A-2b preparation.
 *
 * This rewrites what can be fixed mechanically — XMP identification, an sRGB
 * output intent, the trailer file ID, annotation flags, form appearance — and
 * reports what cannot (fonts that are not embedded, annotations without an
 * appearance, forbidden filters). Nothing here is checked by an external PDF/A
 * validator, so the output is "prepared for PDF/A", never certified.
 */

export type PdfaIssue = {
  id: "fonts" | "annotations" | "filters" | "restricted";
  message: string;
};

export type PdfaResult = {
  bytes: Uint8Array;
  /** What was changed to move the file toward PDF/A. */
  applied: string[];
  /** What still stands between this file and PDF/A conformance. */
  issues: PdfaIssue[];
};

export type PdfaOptions = {
  /** Remove JavaScript and embedded files, which PDF/A-2b forbids. */
  removeRestricted: boolean;
  password?: string;
};

const n = (s: string) => PDFName.of(s);

const SUBSET_PREFIX = /^[A-Z]{6}\+/;

/**
 * One pass over every indirect object: names of fonts whose program is not
 * embedded, and the stream filters PDF/A-2 forbids (LZW and the Crypt filter).
 */
function scanObjects(doc: PDFDocument): { fonts: string[]; filters: string[] } {
  const ctx = doc.context;
  const fonts = new Set<string>();
  const filters = new Set<string>();
  const hasProgram = (descriptor: PDFDict | undefined) =>
    !!descriptor &&
    (descriptor.has(n("FontFile")) ||
      descriptor.has(n("FontFile2")) ||
      descriptor.has(n("FontFile3")));
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      const filter = ctx.lookup(obj.dict.get(n("Filter")));
      const list =
        filter instanceof PDFArray ? filter.asArray().map((f) => ctx.lookup(f)) : [filter];
      for (const f of list) {
        if (f instanceof PDFName && ["LZWDecode", "Crypt"].includes(f.decodeText())) {
          filters.add(f.decodeText());
        }
      }
      continue;
    }
    if (!(obj instanceof PDFDict) || nameOf(ctx, obj.get(n("Type"))) !== "Font") continue;
    const subtype = nameOf(ctx, obj.get(n("Subtype")));
    // Type 3 glyphs are drawn inline; CID fonts are judged via their Type0 parent.
    if (subtype === "Type3" || subtype === "CIDFontType0" || subtype === "CIDFontType2") continue;
    let descriptor = dictOf(ctx, obj.get(n("FontDescriptor")));
    if (subtype === "Type0") {
      const descendants = ctx.lookup(obj.get(n("DescendantFonts")));
      const first = descendants instanceof PDFArray ? dictOf(ctx, descendants.get(0)) : undefined;
      descriptor = dictOf(ctx, first?.get(n("FontDescriptor")));
    }
    if (hasProgram(descriptor)) continue;
    const base = nameOf(ctx, obj.get(n("BaseFont"))) ?? "(unnamed)";
    fonts.add(base.replace(SUBSET_PREFIX, ""));
  }
  return { fonts: [...fonts].sort(), filters: [...filters] };
}

const FLAG_INVISIBLE = 1;
const FLAG_HIDDEN = 2;
const FLAG_PRINT = 4;
const FLAG_NOVIEW = 32;

/**
 * Make every annotation printable and visible, as PDF/A requires. Returns how
 * many were changed and how many lack an appearance stream (which can't be
 * fixed here).
 */
function fixAnnotations(doc: PDFDocument): { changed: number; noAppearance: number } {
  const ctx = doc.context;
  let changed = 0;
  let noAppearance = 0;
  const seen = new Set<PDFDict>();
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    for (let i = 0; annots && i < annots.size(); i++) {
      const a = dictOf(ctx, annots.get(i));
      if (!a || seen.has(a)) continue;
      seen.add(a);
      const subtype = nameOf(ctx, a.get(n("Subtype")));
      // A popup only displays another annotation; links need no appearance.
      if (subtype === "Popup") continue;
      const flags = ctx.lookup(a.get(n("F")));
      const current = flags instanceof PDFNumber ? flags.asNumber() : 0;
      const next = (current | FLAG_PRINT) & ~(FLAG_INVISIBLE | FLAG_HIDDEN | FLAG_NOVIEW);
      if (next !== current) {
        a.set(n("F"), PDFNumber.of(next));
        changed++;
      }
      if (subtype !== "Link" && !a.has(n("AP"))) noAppearance++;
    }
  }
  return { changed, noAppearance };
}

function randomId(): PDFHexString {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return PDFHexString.of([...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
}

/** Prepare finished PDF bytes for PDF/A-2b. */
export async function prepareForPdfA(
  bytes: Uint8Array | ArrayBuffer,
  options: PdfaOptions,
): Promise<PdfaResult> {
  const applied: string[] = [];
  const issues: PdfaIssue[] = [];

  const doc = await loadPdfLibDocument(bytes, options.password);
  const ctx = doc.context;
  const catalog = doc.catalog;

  if (options.removeRestricted) {
    const removed = sanitizeDocument(doc, {
      metadata: false,
      comments: false,
      bookmarks: false,
      attachments: true,
      javascript: true,
    });
    if (removed.javascript) applied.push(`Removed ${plural(removed.javascript, "script")}`);
    if (removed.attachments) applied.push(`Removed ${plural(removed.attachments, "attachment")}`);
  } else {
    // Left in on request, but PDF/A-2b forbids both, so say so.
    const found = scanHiddenInfoOfDocument(doc);
    const parts = [
      found.javascript ? plural(found.javascript, "script") : "",
      found.attachments ? plural(found.attachments, "attachment") : "",
    ].filter(Boolean);
    if (parts.length) {
      issues.push({
        id: "restricted",
        message: `Contains ${parts.join(" and ")}, which PDF/A-2b does not allow. Export again with the removal option ticked.`,
      });
    }
  }

  // Properties: write the same values to the Info dictionary and the XMP packet.
  const now = new Date();
  const created = doc.getCreationDate() ?? now;
  const producer = "PDF Editor";
  doc.setProducer(producer);
  doc.setModificationDate(now);
  doc.setCreationDate(created);
  setXmp(
    doc,
    buildPdfaXmp({
      title: doc.getTitle(),
      author: doc.getAuthor(),
      subject: doc.getSubject(),
      keywords: doc.getKeywords(),
      creator: doc.getCreator(),
      producer,
      created,
      modified: now,
      pdfa: { part: 2, conformance: "B" },
    }),
  );
  applied.push("Declared PDF/A-2b in the document metadata");

  // Device colours need an output intent that names the colour space they mean.
  if (!catalog.has(n("OutputIntents"))) {
    const profile = ctx.register(
      ctx.flateStream(buildSrgbProfile(), { N: 3, Alternate: "DeviceRGB" }),
    );
    const intent = ctx.obj({
      Type: "OutputIntent",
      S: "GTS_PDFA1",
      OutputConditionIdentifier: PDFString.of(SRGB_PROFILE_NAME),
      Info: PDFString.of(SRGB_PROFILE_NAME),
      RegistryName: PDFString.of("http://www.color.org"),
      DestOutputProfile: profile,
    });
    catalog.set(n("OutputIntents"), ctx.obj([ctx.register(intent)]));
    applied.push("Added an sRGB output intent");
  }

  if (!ctx.trailerInfo.ID) {
    const id = randomId();
    ctx.trailerInfo.ID = ctx.obj([id, id]);
    applied.push("Added a file identifier");
  }

  const acroForm = dictOf(ctx, catalog.get(n("AcroForm")));
  if (acroForm?.has(n("NeedAppearances"))) {
    acroForm.delete(n("NeedAppearances"));
    applied.push("Stored form field appearances instead of regenerating them");
  }

  const annots = fixAnnotations(doc);
  if (annots.changed)
    applied.push(`Made ${plural(annots.changed, "annotation")} printable and visible`);
  if (annots.noAppearance) {
    issues.push({
      id: "annotations",
      message: `${plural(annots.noAppearance, "annotation")} without an appearance stream — PDF/A requires one. Flatten comments before exporting.`,
    });
  }

  const { fonts, filters } = scanObjects(doc);
  if (fonts.length) {
    const shown =
      fonts.slice(0, 6).join(", ") + (fonts.length > 6 ? `, +${fonts.length - 6} more` : "");
    issues.push({
      id: "fonts",
      message: `${plural(fonts.length, "font")} not embedded (${shown}). PDF/A needs every font inside the file; text you added in the standard Helvetica, Times or Courier fonts counts, so pick one of the embedded web fonts for it.`,
    });
  }

  if (filters.length) {
    issues.push({
      id: "filters",
      message: `Uses ${filters.join(" and ")} stream compression, which PDF/A does not allow.`,
    });
  }

  // Object streams are legal in PDF/A-2, but a plain file is the safest to validate.
  return { bytes: await doc.save({ useObjectStreams: false }), applied, issues };
}
