import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import { loadPdfLibDocument } from "./pdfLoad";
import { readXmp, replaceXmpTitle, setXmp, xmpTitle } from "./xmp";

/**
 * Accessibility checker. It inspects the structure a screen reader depends on
 * (tags, language, title, alt text, headings, table headers, form labels…) and
 * lists what a person still has to judge by eye. It is a structural check, not a
 * PDF/UA validation: it cannot tell whether the reading order or alt text is good.
 */

export type A11yStatus = "fail" | "warn" | "pass" | "manual";

export type A11yCheck = {
  id: string;
  status: A11yStatus;
  title: string;
  /** What was found and, for a failure, how to fix it. */
  detail: string;
  /** 1-based page numbers (in document order) where the problem occurs. */
  pages?: number[];
};

export type A11yReport = {
  checks: A11yCheck[];
  /** Whether the document carries a structure tree at all. */
  tagged: boolean;
  counts: Record<A11yStatus, number>;
};

export type A11yOptions = {
  /** The caller found the document to be image-only (no selectable text). */
  scanned?: boolean;
  password?: string;
};

const n = (s: string) => PDFName.of(s);

function dictOf(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | undefined {
  const v = ctx.lookup(obj);
  if (v instanceof PDFDict) return v;
  if (v instanceof PDFStream) return v.dict;
  return undefined;
}

function textOf(ctx: PDFContext, obj: PDFObject | undefined): string {
  const v = ctx.lookup(obj);
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText().trim();
  return "";
}

function nameOf(ctx: PDFContext, obj: PDFObject | undefined): string | undefined {
  const v = ctx.lookup(obj);
  return v instanceof PDFName ? v.decodeText() : undefined;
}

/** A page attribute that may be inherited from an ancestor /Pages node. */
function inherited(ctx: PDFContext, node: PDFDict, key: PDFName): PDFObject | undefined {
  const seen = new Set<PDFDict>();
  for (let cur: PDFDict | undefined = node; cur && !seen.has(cur); ) {
    seen.add(cur);
    const v = cur.get(key);
    if (v !== undefined) return v;
    cur = dictOf(ctx, cur.get(n("Parent")));
  }
  return undefined;
}

type StructFacts = {
  elements: number;
  figures: { page: number | null; hasAlt: boolean }[];
  /** Heading levels in reading order, with the page they sit on. */
  headings: { level: number; page: number | null }[];
  tables: { page: number | null; hasHeader: boolean }[];
};

const MAX_STRUCT_ELEMENTS = 200_000;
const MAX_STRUCT_DEPTH = 256;

/** Collect what the checks need from the structure tree, in reading order. */
function readStructure(doc: PDFDocument, pageNumber: Map<PDFRef, number>): StructFacts | null {
  const ctx = doc.context;
  const root = dictOf(ctx, doc.catalog.get(n("StructTreeRoot")));
  if (!root) return null;
  const roleMap = dictOf(ctx, root.get(n("RoleMap")));
  const facts: StructFacts = { elements: 0, figures: [], headings: [], tables: [] };
  const seen = new Set<PDFDict>();

  /** Standard role of an element, following the role map (cycle-safe). */
  const roleOf = (raw: string): string => {
    let role = raw;
    for (let i = 0; i < 8 && roleMap; i++) {
      const mapped = nameOf(ctx, roleMap.get(n(role)));
      if (!mapped || mapped === role) break;
      role = mapped;
    }
    return role;
  };

  /** Returns true if a TH was seen anywhere inside (so a table can be judged). */
  const visit = (obj: PDFObject | undefined, pg: PDFRef | undefined, depth: number): boolean => {
    if (depth > MAX_STRUCT_DEPTH || facts.elements > MAX_STRUCT_ELEMENTS) return false;
    const resolved = ctx.lookup(obj);
    if (resolved instanceof PDFArray) {
      let header = false;
      for (let i = 0; i < resolved.size(); i++)
        header = visit(resolved.get(i), pg, depth + 1) || header;
      return header;
    }
    if (!(resolved instanceof PDFDict) || seen.has(resolved)) return false;
    // Marked-content references and object references are leaves, not elements.
    if (!resolved.has(n("S"))) return false;
    seen.add(resolved);
    facts.elements++;

    const ownPg = resolved.get(n("Pg"));
    const here = ownPg instanceof PDFRef ? ownPg : pg;
    const page = here ? (pageNumber.get(here) ?? null) : null;
    const role = roleOf(nameOf(ctx, resolved.get(n("S"))) ?? "");

    if (role === "Figure") {
      const alt = textOf(ctx, resolved.get(n("Alt"))) || textOf(ctx, resolved.get(n("ActualText")));
      facts.figures.push({ page, hasAlt: alt.length > 0 });
    }
    const heading = role.match(/^H([1-6])?$/);
    if (heading) facts.headings.push({ level: heading[1] ? Number(heading[1]) : 0, page });

    const hasHeader = visit(resolved.get(n("K")), here, depth + 1);
    if (role === "Table") facts.tables.push({ page, hasHeader });
    return role === "TH" || hasHeader;
  };
  visit(root.get(n("K")), undefined, 0);
  return facts;
}

/** Number of image XObjects per page (page forms followed a few levels deep). */
function countImages(doc: PDFDocument): number[] {
  const ctx = doc.context;
  const countIn = (resources: PDFDict | undefined, depth: number, seen: Set<PDFDict>): number => {
    const xobjects = dictOf(ctx, resources?.get(n("XObject")));
    if (!xobjects) return 0;
    let total = 0;
    for (const key of xobjects.keys()) {
      const x = ctx.lookup(xobjects.get(key));
      if (!(x instanceof PDFStream) || seen.has(x.dict)) continue;
      seen.add(x.dict);
      const subtype = nameOf(ctx, x.dict.get(n("Subtype")));
      if (subtype === "Image") total++;
      else if (subtype === "Form" && depth < 3) {
        total += countIn(dictOf(ctx, x.dict.get(n("Resources"))), depth + 1, seen);
      }
    }
    return total;
  };
  return doc.getPages().map((p) => {
    const resources = dictOf(ctx, inherited(ctx, p.node, n("Resources")));
    return countIn(resources, 0, new Set());
  });
}

/** 1-based page numbers, de-duplicated and sorted. */
function pageList(pages: (number | null)[]): number[] | undefined {
  const list = [...new Set(pages.filter((p): p is number => p !== null))].sort((a, b) => a - b);
  return list.length ? list : undefined;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** A loose BCP 47 shape (`en`, `en-US`, `zh-Hant-TW`). */
export const LANGUAGE_TAG = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

/** Run the checks on finished PDF bytes. */
export async function checkAccessibility(
  bytes: Uint8Array | ArrayBuffer,
  options: A11yOptions = {},
): Promise<A11yReport> {
  const doc = await loadPdfLibDocument(bytes, options.password);
  const ctx = doc.context;
  const pages = doc.getPages();
  const checks: A11yCheck[] = [];
  const add = (c: A11yCheck) => checks.push(c);

  const pageNumber = new Map<PDFRef, number>();
  pages.forEach((p, i) => pageNumber.set(p.ref, i + 1));

  // --- Text content ----------------------------------------------------
  if (options.scanned) {
    add({
      id: "text",
      status: "fail",
      title: "Document is scanned images",
      detail:
        "The pages have no selectable text, so a screen reader has nothing to read. Run OCR, then re-check.",
    });
  }

  // --- Tagged structure -----------------------------------------------
  const facts = readStructure(doc, pageNumber);
  const markInfo = dictOf(ctx, doc.catalog.get(n("MarkInfo")));
  const marked = ctx.lookup(markInfo?.get(n("Marked")));
  const flagged = marked?.toString() === "true";
  const tagged = facts !== null;
  if (tagged && flagged) {
    add({
      id: "tagged",
      status: "pass",
      title: "Document is tagged",
      detail: `The structure tree holds ${plural(facts.elements, "element")}.`,
    });
  } else if (tagged) {
    add({
      id: "tagged",
      status: "warn",
      title: "Structure tree is not marked as tagged",
      detail:
        "The document has a structure tree but is not flagged as a tagged PDF, so assistive technology may ignore it.",
    });
  } else {
    add({
      id: "tagged",
      status: "fail",
      title: "Document is not tagged",
      detail:
        "Without tags, screen readers cannot tell headings, lists, tables or figures from plain text, and reading order is a guess. This editor cannot add tags — re-export the source document with “tagged PDF” enabled, or tag it in a dedicated accessibility tool.",
    });
  }

  // --- Language ---------------------------------------------------------
  const lang = textOf(ctx, doc.catalog.get(n("Lang")));
  if (!lang) {
    add({
      id: "language",
      status: "fail",
      title: "No document language",
      detail:
        "Screen readers pick the pronunciation from the language. Set it below and download a fixed copy.",
    });
  } else if (!LANGUAGE_TAG.test(lang)) {
    add({
      id: "language",
      status: "warn",
      title: `Language “${lang}” is not a valid language tag`,
      detail: "Use a tag such as en, en-US or fr-CA.",
    });
  } else {
    add({ id: "language", status: "pass", title: `Language is set (${lang})`, detail: "" });
  }

  // --- Title ------------------------------------------------------------
  const title = (doc.getTitle() ?? "").trim() || xmpTitle(readXmp(doc) ?? "") || "";
  if (!title) {
    add({
      id: "title",
      status: "fail",
      title: "No document title",
      detail:
        "Assistive technology announces the title when the file opens. Set one below and download a fixed copy.",
    });
  } else {
    add({ id: "title", status: "pass", title: "Document has a title", detail: `“${title}”` });
  }
  const viewerPrefs = dictOf(ctx, doc.catalog.get(n("ViewerPreferences")));
  if (title && ctx.lookup(viewerPrefs?.get(n("DisplayDocTitle")))?.toString() !== "true") {
    add({
      id: "display-title",
      status: "warn",
      title: "Window shows the file name, not the title",
      detail:
        "Turn on “show title in the window bar” below so the title is what people see and hear.",
    });
  }

  // --- Figures / images ------------------------------------------------
  if (facts) {
    const missing = facts.figures.filter((f) => !f.hasAlt);
    if (facts.figures.length === 0) {
      add({ id: "figures", status: "pass", title: "No figures to describe", detail: "" });
    } else if (missing.length) {
      add({
        id: "figures",
        status: "fail",
        title: `${plural(missing.length, "figure")} without alternate text`,
        detail: `${missing.length} of ${facts.figures.length} figures have no description for screen readers. Add alternate text in the tool that created the tags, or mark decorative images as artifacts.`,
        pages: pageList(missing.map((f) => f.page)),
      });
    } else {
      add({
        id: "figures",
        status: "pass",
        title: `All ${plural(facts.figures.length, "figure")} have alternate text`,
        detail: "",
      });
    }
  } else {
    const perPage = countImages(doc);
    const total = perPage.reduce((a, b) => a + b, 0);
    if (total > 0) {
      add({
        id: "figures",
        status: "warn",
        title: `${plural(total, "image")} that cannot be checked for alternate text`,
        detail: "Alternate text lives in the tags, and this document has none.",
        pages: pageList(perPage.flatMap((c, i) => (c > 0 ? [i + 1] : []))),
      });
    }
  }

  // --- Headings ---------------------------------------------------------
  if (facts) {
    if (facts.headings.length === 0) {
      if (pages.length >= 2) {
        add({
          id: "headings",
          status: "warn",
          title: "No headings",
          detail:
            "Headings let screen reader users jump through the document. Add them in the source document and re-export.",
        });
      }
    } else {
      const skipped: (number | null)[] = [];
      let prev = 0;
      for (const h of facts.headings) {
        if (h.level > 0 && prev > 0 && h.level > prev + 1) skipped.push(h.page);
        if (h.level > 0) prev = h.level;
      }
      if (skipped.length) {
        add({
          id: "headings",
          status: "warn",
          title: `Heading levels skip ahead in ${plural(skipped.length, "place")}`,
          detail:
            "For example an H1 followed directly by an H3. Keep levels in order, without gaps.",
          pages: pageList(skipped),
        });
      } else {
        add({
          id: "headings",
          status: "pass",
          title: `${plural(facts.headings.length, "heading")} in a logical order`,
          detail: "",
        });
      }
    }

    // --- Tables -----------------------------------------------------------
    if (facts.tables.length) {
      const bad = facts.tables.filter((t) => !t.hasHeader);
      add(
        bad.length
          ? {
              id: "tables",
              status: "warn",
              title: `${plural(bad.length, "table")} without header cells`,
              detail:
                "Header cells (TH) tell screen readers which column or row a value belongs to.",
              pages: pageList(bad.map((t) => t.page)),
            }
          : {
              id: "tables",
              status: "pass",
              title: `${plural(facts.tables.length, "table")} with header cells`,
              detail: "",
            },
      );
    }
  }

  // --- Form fields ------------------------------------------------------
  const unlabelled: (number | null)[] = [];
  let fieldCount = 0;
  const widgetPage = new Map<PDFDict, number>();
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    for (let k = 0; annots && k < annots.size(); k++) {
      const a = dictOf(ctx, annots.get(k));
      if (a) widgetPage.set(a, i + 1);
    }
  });
  const seenField = new Set<PDFDict>();
  const visitField = (obj: PDFObject | undefined, inheritedTip: boolean) => {
    const field = dictOf(ctx, obj);
    if (!field || seenField.has(field)) return;
    seenField.add(field);
    const tip = inheritedTip || textOf(ctx, field.get(n("TU"))).length > 0;
    const kids = ctx.lookup(field.get(n("Kids")));
    const hasFieldKids =
      kids instanceof PDFArray &&
      Array.from({ length: kids.size() }, (_, i) => dictOf(ctx, kids.get(i))).some((k) =>
        k?.has(n("T")),
      );
    if (hasFieldKids && kids instanceof PDFArray) {
      for (let i = 0; i < kids.size(); i++) visitField(kids.get(i), tip);
      return;
    }
    fieldCount++;
    if (!tip) unlabelled.push(widgetPage.get(field) ?? null);
  };
  const fields = ctx.lookup(dictOf(ctx, doc.catalog.get(n("AcroForm")))?.get(n("Fields")));
  if (fields instanceof PDFArray)
    for (let i = 0; i < fields.size(); i++) visitField(fields.get(i), false);
  if (fieldCount > 0) {
    add(
      unlabelled.length
        ? {
            id: "forms",
            status: "fail",
            title: `${plural(unlabelled.length, "form field")} without a description`,
            detail:
              "Each field needs a tooltip (its /TU entry) so a screen reader can announce what to enter.",
            pages: pageList(unlabelled),
          }
        : {
            id: "forms",
            status: "pass",
            title: `All ${plural(fieldCount, "form field")} are described`,
            detail: "",
          },
    );
  }

  // --- Tab order --------------------------------------------------------
  const noTabs: number[] = [];
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots || annots.size() === 0) return;
    if (nameOf(ctx, inherited(ctx, p.node, n("Tabs"))) !== "S") noTabs.push(i + 1);
  });
  if (noTabs.length) {
    add({
      id: "tab-order",
      status: "warn",
      title: `${plural(noTabs.length, "page")} with links or fields but no structure tab order`,
      detail:
        "Set the page's tab order to “follow structure” so keyboard users move in reading order.",
      pages: noTabs,
    });
  }

  // --- Bookmarks --------------------------------------------------------
  if (pages.length >= 21) {
    add(
      doc.catalog.has(n("Outlines"))
        ? { id: "bookmarks", status: "pass", title: "Long document has bookmarks", detail: "" }
        : {
            id: "bookmarks",
            status: "warn",
            title: "Long document without bookmarks",
            detail: `A ${pages.length}-page document should have bookmarks for navigation. Add them from the Bookmarks panel.`,
          },
    );
  }

  // --- Things only a person can judge -----------------------------------
  add({
    id: "reading-order",
    status: "manual",
    title: "Reading order",
    detail:
      "Confirm the content reads in a sensible order — especially columns, sidebars and captions.",
  });
  add({
    id: "contrast",
    status: "manual",
    title: "Colour contrast",
    detail: "Text should have at least a 4.5:1 contrast with its background (3:1 for large text).",
  });
  add({
    id: "alt-quality",
    status: "manual",
    title: "Quality of alternate text and link text",
    detail:
      "Alternate text should say what the image conveys, and links should make sense out of context (not “click here”).",
  });

  const counts: Record<A11yStatus, number> = { fail: 0, warn: 0, pass: 0, manual: 0 };
  for (const c of checks) counts[c.status]++;
  return { checks, tagged, counts };
}

/** Document-level fixes the checker offers. */
export type A11yFixes = {
  title?: string;
  /** BCP 47 language tag. */
  lang?: string;
  /** Make the window bar show the title rather than the file name. */
  displayDocTitle?: boolean;
};

/** Apply the fixes and return the rewritten PDF. Empty fields are left alone. */
export async function applyA11yFixes(
  bytes: Uint8Array | ArrayBuffer,
  fixes: A11yFixes,
  password?: string,
): Promise<Uint8Array> {
  const doc = await loadPdfLibDocument(bytes, password);
  const ctx = doc.context;
  const title = fixes.title?.trim();
  if (title) {
    doc.setTitle(title, { showInWindowTitleBar: fixes.displayDocTitle ?? true });
    // Keep an existing XMP title in step with the Info dictionary.
    const xmp = readXmp(doc);
    const next = xmp ? replaceXmpTitle(xmp, title) : null;
    if (next) setXmp(doc, next);
  } else if (fixes.displayDocTitle !== undefined) {
    let prefs = dictOf(ctx, doc.catalog.get(n("ViewerPreferences")));
    if (!prefs) {
      prefs = ctx.obj({});
      doc.catalog.set(n("ViewerPreferences"), prefs);
    }
    prefs.set(n("DisplayDocTitle"), ctx.obj(fixes.displayDocTitle));
  }
  const lang = fixes.lang?.trim();
  if (lang) {
    if (!LANGUAGE_TAG.test(lang)) throw new Error(`Not a valid language tag: ${lang}`);
    doc.catalog.set(n("Lang"), PDFString.of(lang));
  }
  return doc.save({ useObjectStreams: true });
}

/** The values the checker can prefill the fix form with. */
export async function readA11yFixDefaults(
  bytes: Uint8Array | ArrayBuffer,
  password?: string,
): Promise<{ title: string; lang: string }> {
  const doc = await loadPdfLibDocument(bytes, password);
  return {
    title: (doc.getTitle() ?? "").trim(),
    lang: textOf(doc.context, doc.catalog.get(n("Lang"))),
  };
}
