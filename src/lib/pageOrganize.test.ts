import { test, expect, describe, beforeEach } from "vite-plus/test";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import type { PDFPage } from "pdf-lib";
import { buildPlannedPdf, loadPdf } from "./pageOrganize";
import { planDuplicate, planInsert, planReplace } from "./pageRemap";
import { exportEditedPdf } from "./exportPdf";
import { hasAcroForm } from "./formExport";
import { useEditorStore, type PdfEdit } from "../store/useEditorStore";

/** A PDF whose pages carry a distinct width (positional fingerprint) and a
 * text label drawn into their content stream. */
async function makePdf(
  widths: number[],
  name = "doc.pdf",
  opts: { title?: string; indirectContents?: boolean } = {},
): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  if (opts.title) doc.setTitle(opts.title);
  widths.forEach((w, i) => {
    const page = doc.addPage([w, 792]);
    page.drawText(`Label ${name} ${i + 1}`, { x: 20, y: 700, size: 12, font });
    // An indirect /Contents array is the case where a shallow page copy would
    // share it — and an edit drawn on one page would show on the other.
    if (opts.indirectContents) {
      const contents = page.node.Contents();
      if (contents) page.node.set(PDFName.of("Contents"), doc.context.register(contents));
    }
  });
  return new File([(await doc.save()).slice()], name, { type: "application/pdf" });
}

async function widthsOf(bytes: Uint8Array | File): Promise<number[]> {
  const doc = await PDFDocument.load(bytes instanceof File ? await bytes.arrayBuffer() : bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

/** Decoded content-stream text of a page (all streams concatenated). */
function contentOf(page: PDFPage): string {
  const ctx = page.doc.context;
  const raw = page.node.get(PDFName.of("Contents"));
  const resolved = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
  // Contents is either one stream or an array of streams.
  const items = resolved instanceof PDFArray ? resolved.asArray() : [resolved];
  return items
    .map((r) => (r instanceof PDFRef ? ctx.lookup(r) : r))
    .map((s) =>
      s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : "",
    )
    .join("\n");
}

describe("buildPlannedPdf", () => {
  test("duplicate yields N+k pages, each copy right after its original with the same content", async () => {
    const file = await makePdf([100, 101, 102]);
    const plan = planDuplicate(3, [0, 1, 2], [0, 2]);
    const bytes = await buildPlannedPdf(await loadPdf(file), plan.layout);
    expect(await widthsOf(bytes)).toEqual([100, 100, 101, 102, 102]);

    const out = await PDFDocument.load(bytes);
    const pages = out.getPages();
    expect(contentOf(pages[1])).toBe(contentOf(pages[0]));
    expect(contentOf(pages[4])).toBe(contentOf(pages[3]));
    expect(contentOf(pages[0])).not.toBe(contentOf(pages[3]));
  });

  test("a duplicated page is independent: an edit baked onto the copy leaves the original alone", async () => {
    const file = await makePdf([100, 101], "doc.pdf", { indirectContents: true });
    const plan = planDuplicate(2, [0, 1], [0]);
    const bytes = await buildPlannedPdf(await loadPdf(file), plan.layout);
    const dup = new File([bytes.slice()], "dup.pdf", { type: "application/pdf" });

    const box: PdfEdit = {
      id: "b",
      type: "rectangle",
      pageIndex: 1,
      x: 10,
      y: 10,
      width: 80,
      height: 40,
    };
    const plain = await PDFDocument.load(await exportEditedPdf(dup, []));
    const edited = await PDFDocument.load(await exportEditedPdf(dup, [box]));
    expect(contentOf(edited.getPage(0))).toBe(contentOf(plain.getPage(0)));
    expect(contentOf(edited.getPage(1))).not.toBe(contentOf(plain.getPage(1)));
  });

  test("replace swaps pages in place and preserves the surrounding order", async () => {
    const base = await makePdf([100, 101, 102, 103]);
    const other = await makePdf([200, 201, 202], "other.pdf");
    const plan = planReplace(4, [0, 1, 2, 3], [1, 2], [1, 2]);
    const bytes = await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other));
    expect(await widthsOf(bytes)).toEqual([100, 201, 202, 103]);
  });

  test("replace with more pages than selected, and the same source page twice", async () => {
    const base = await makePdf([100, 101, 102]);
    const other = await makePdf([200, 201], "other.pdf");
    const plan = planReplace(3, [0, 1, 2], [1], [0, 1, 0]);
    const bytes = await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other));
    expect(await widthsOf(bytes)).toEqual([100, 200, 201, 200, 102]);
  });

  test("replacing every page works", async () => {
    const base = await makePdf([100, 101]);
    const other = await makePdf([200], "other.pdf");
    const plan = planReplace(2, [0, 1], [0, 1], [0]);
    const bytes = await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other));
    expect(await widthsOf(bytes)).toEqual([200]);
  });

  test("insert keeps document metadata (the base document is edited in place)", async () => {
    const base = await makePdf([100, 101], "base.pdf", { title: "Quarterly report" });
    const other = await makePdf([200], "other.pdf");
    const plan = planInsert(2, [0, 1], 1, 1);
    const bytes = await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other));
    expect(await widthsOf(bytes)).toEqual([100, 200, 101]);
    expect((await PDFDocument.load(bytes)).getTitle()).toBe("Quarterly report");
  });

  test("rejects source pages the other PDF doesn't have", async () => {
    const base = await makePdf([100]);
    const other = await makePdf([200], "other.pdf");
    const plan = planReplace(1, [0], [0], [3]);
    await expect(
      buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other)),
    ).rejects.toThrow(/doesn't have a page 4/);
  });
});

/** A one-page PDF (width 300) with a text field, a checkbox and a radio group.
 * `drFonts` adds form-level defaults pdf-lib doesn't write itself: a /DR with
 * those font names (Helvetica, or Courier for "Cour"), a /DA, NeedAppearances. */
async function makeFormPdf(name = "form.pdf", prefix = "", drFonts: string[] = []): Promise<File> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  const form = doc.getForm();
  if (drFonts.length > 0) {
    const fonts: Record<string, PDFRef> = {};
    for (const f of drFonts) {
      fonts[f] = (
        await doc.embedFont(f === "Cour" ? StandardFonts.Courier : StandardFonts.Helvetica)
      ).ref;
    }
    form.acroForm.dict.set(PDFName.of("DR"), doc.context.obj({ Font: fonts }));
    form.acroForm.dict.set(PDFName.of("DA"), PDFString.of(`/${drFonts[0]} 0 Tf 0 g`));
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  }
  const text = form.createTextField(`${prefix}name`);
  text.setText("Alice");
  text.addToPage(page, { x: 10, y: 300, width: 150, height: 20 });
  const box = form.createCheckBox(`${prefix}agree`);
  box.addToPage(page, { x: 10, y: 250, width: 15, height: 15 });
  box.check();
  const radio = form.createRadioGroup(`${prefix}choice`);
  radio.addOptionToPage("a", page, { x: 10, y: 200, width: 15, height: 15 });
  radio.addOptionToPage("b", page, { x: 40, y: 200, width: 15, height: 15 });
  radio.select("a");
  // Let the text field inherit the form's default /DA instead of its own.
  // (Saving would regenerate appearances and put a /DA back.)
  if (drFonts.length > 0) text.acroField.dict.delete(PDFName.of("DA"));
  const bytes = await doc.save({ updateFieldAppearances: drFonts.length === 0 });
  return new File([bytes.slice()], name, { type: "application/pdf" });
}

/** Refs of a field's widgets and the page each widget's /P and /Annots place it on. */
function widgetPlacement(doc: PDFDocument, fieldName: string) {
  const field = doc.getForm().getField(fieldName);
  const pages = doc.getPages();
  return field.acroField.getWidgets().map((w) => {
    const ref = doc.context.getObjectRef(w.dict);
    return {
      byP: pages.findIndex((p) => p.ref === w.P()),
      byAnnots: pages.findIndex((p) => p.node.Annots()?.asArray().includes(ref!) ?? false),
    };
  });
}

function fieldNames(doc: PDFDocument): string[] {
  return doc
    .getForm()
    .getFields()
    .map((f) => f.getName());
}

describe("buildPlannedPdf form fields", () => {
  test("a duplicated page's fields become independent, renamed fields on the copy", async () => {
    const file = await makeFormPdf();
    const plan = planDuplicate(1, [0], [0]);
    const out = await PDFDocument.load(await buildPlannedPdf(await loadPdf(file), plan.layout));

    expect(fieldNames(out)).toEqual(["name", "agree", "choice", "name_2", "agree_2", "choice_2"]);
    for (const name of ["name", "agree", "choice"]) {
      for (const w of widgetPlacement(out, name)) expect(w).toEqual({ byP: 0, byAnnots: 0 });
      for (const w of widgetPlacement(out, `${name}_2`)) expect(w).toEqual({ byP: 1, byAnnots: 1 });
    }
    const form = out.getForm();
    // The copies start with the original's values…
    expect(form.getTextField("name_2").getText()).toBe("Alice");
    expect(form.getCheckBox("agree_2").isChecked()).toBe(true);
    expect(form.getRadioGroup("choice_2").getOptions()).toEqual(["a", "b"]);
    expect(form.getRadioGroup("choice_2").getSelected()).toBe("a");

    // …but changing a copy leaves the original alone, through a save/load.
    form.getTextField("name_2").setText("Bob");
    form.getCheckBox("agree_2").uncheck();
    form.getRadioGroup("choice_2").select("b");
    const again = (await PDFDocument.load(await out.save())).getForm();
    expect(again.getTextField("name").getText()).toBe("Alice");
    expect(again.getTextField("name_2").getText()).toBe("Bob");
    expect(again.getCheckBox("agree").isChecked()).toBe(true);
    expect(again.getCheckBox("agree_2").isChecked()).toBe(false);
    expect(again.getRadioGroup("choice").getSelected()).toBe("a");
    expect(again.getRadioGroup("choice_2").getSelected()).toBe("b");
  });

  test("a clone keeps only its own page's widgets of a field that spans pages", async () => {
    const doc = await PDFDocument.create();
    const pages = [doc.addPage([300, 400]), doc.addPage([301, 400])];
    const field = doc.getForm().createTextField("initials");
    for (const page of pages) field.addToPage(page, { x: 10, y: 10, width: 50, height: 20 });
    const file = new File([(await doc.save()).slice()], "span.pdf");

    const plan = planDuplicate(2, [0, 1], [0]);
    const out = await PDFDocument.load(await buildPlannedPdf(await loadPdf(file), plan.layout));
    expect(widgetPlacement(out, "initials")).toEqual([
      { byP: 0, byAnnots: 0 },
      { byP: 2, byAnnots: 2 },
    ]);
    expect(widgetPlacement(out, "initials_2")).toEqual([{ byP: 1, byAnnots: 1 }]);
    // The stray page copies copyPages made while following references are gone.
    const pageObjects = out.context
      .enumerateIndirectObjects()
      .filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("Page"));
    expect(pageObjects).toHaveLength(3);
  });

  test("two clones of the same page take the next free suffixes", async () => {
    const file = await makeFormPdf();
    const layout = [
      { kind: "base" as const, index: 0 },
      { kind: "base" as const, index: 0, clone: true },
      { kind: "base" as const, index: 0, clone: true },
    ];
    const out = await PDFDocument.load(await buildPlannedPdf(await loadPdf(file), layout));
    expect(fieldNames(out).filter((n) => n.startsWith("name"))).toEqual([
      "name",
      "name_2",
      "name_3",
    ]);
    expect(widgetPlacement(out, "name_3")).toEqual([{ byP: 2, byAnnots: 2 }]);
  });

  test("inserting a form page into a formless PDF creates the AcroForm with its fields", async () => {
    const base = await makePdf([100, 101]);
    const other = await makeFormPdf("other.pdf", "", ["Helv"]);
    const plan = planInsert(2, [0, 1], 1, 1);
    const out = await PDFDocument.load(
      await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other)),
    );
    expect(hasAcroForm(out)).toBe(true);
    expect(fieldNames(out)).toEqual(["name", "agree", "choice"]);
    expect(widgetPlacement(out, "name")).toEqual([{ byP: 1, byAnnots: 1 }]);
    expect(out.getForm().getTextField("name").getText()).toBe("Alice");
    // The source form's defaults came along: the font its /DA names, the /DA
    // itself, NeedAppearances.
    const acroForm = out.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    const font = acroForm.lookup(PDFName.of("DR"), PDFDict).lookup(PDFName.of("Font"), PDFDict);
    expect(font.lookup(PDFName.of("Helv"), PDFDict).get(PDFName.of("BaseFont"))).toBe(
      PDFName.of("Helvetica"),
    );
    expect(acroForm.lookup(PDFName.of("DA"), PDFString).decodeText()).toBe("/Helv 0 Tf 0 g");
    expect(acroForm.get(PDFName.of("NeedAppearances"))).toBe(PDFBool.True);
  });

  test("an incoming form's /DR fonts are merged in, without replacing the base's", async () => {
    const base = await makeFormPdf("base.pdf", "", ["Helv"]);
    const other = await makeFormPdf("other.pdf", "x_", ["Cour", "Helv"]);
    const out = await PDFDocument.load(
      await buildPlannedPdf(
        await loadPdf(base),
        planInsert(1, [0], 1, 1).layout,
        await loadPdf(other),
      ),
    );
    const acroForm = out.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    const font = acroForm.lookup(PDFName.of("DR"), PDFDict).lookup(PDFName.of("Font"), PDFDict);
    const baseFont = (name: string) =>
      font.lookup(PDFName.of(name), PDFDict).get(PDFName.of("BaseFont"));
    expect(baseFont("Helv")).toBe(PDFName.of("Helvetica"));
    expect(baseFont("Cour")).toBe(PDFName.of("Courier"));
    // The base keeps its default /DA; an incoming field that inherited its
    // form's default gets it set on itself.
    expect(acroForm.lookup(PDFName.of("DA"), PDFString).decodeText()).toBe("/Helv 0 Tf 0 g");
    expect(out.getForm().getField("name").acroField.dict.has(PDFName.of("DA"))).toBe(false);
    const incoming = out.getForm().getField("x_name").acroField.dict;
    expect(incoming.lookup(PDFName.of("DA"), PDFString).decodeText()).toBe("/Cour 0 Tf 0 g");
    expect(fieldNames(out)).toEqual(["name", "agree", "choice", "x_name", "x_agree", "x_choice"]);
  });

  test("replacing a page with a form page gives a formless PDF the fields", async () => {
    const base = await makePdf([100, 101]);
    const other = await makeFormPdf("other.pdf");
    const plan = planReplace(2, [0, 1], [0], [0]);
    const out = await PDFDocument.load(
      await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other)),
    );
    expect(await widthsOf(await out.save())).toEqual([300, 101]);
    expect(fieldNames(out)).toEqual(["name", "agree", "choice"]);
    expect(widgetPlacement(out, "choice")).toEqual([
      { byP: 0, byAnnots: 0 },
      { byP: 0, byAnnots: 0 },
    ]);
  });

  test("an inserted field whose name is taken is renamed", async () => {
    const base = await makeFormPdf("base.pdf");
    const other = await makeFormPdf("other.pdf");
    const plan = planInsert(1, [0], 1, 1);
    const out = await PDFDocument.load(
      await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other)),
    );
    expect(fieldNames(out)).toEqual(["name", "agree", "choice", "name_2", "agree_2", "choice_2"]);
    expect(widgetPlacement(out, "agree_2")).toEqual([{ byP: 1, byAnnots: 1 }]);
  });

  test("replacing a form page drops its fields, so the replacement keeps its names", async () => {
    const base = await makeFormPdf("base.pdf");
    const other = await makeFormPdf("other.pdf", "x_");
    const replacement = await makeFormPdf("again.pdf");
    const swapped = await PDFDocument.load(
      await buildPlannedPdf(
        await loadPdf(base),
        planReplace(1, [0], [0], [0]).layout,
        await loadPdf(other),
      ),
    );
    expect(fieldNames(swapped)).toEqual(["x_name", "x_agree", "x_choice"]);

    const same = await PDFDocument.load(
      await buildPlannedPdf(
        await loadPdf(base),
        planReplace(1, [0], [0], [0]).layout,
        await loadPdf(replacement),
      ),
    );
    expect(fieldNames(same)).toEqual(["name", "agree", "choice"]);
  });

  test("documents without forms stay without an AcroForm", async () => {
    const base = await makePdf([100, 101]);
    const other = await makePdf([200], "other.pdf");
    const inserted = await buildPlannedPdf(
      await loadPdf(base),
      planInsert(2, [0, 1], 1, 1).layout,
      await loadPdf(other),
    );
    expect(hasAcroForm(await PDFDocument.load(inserted))).toBe(false);
    const duplicated = await buildPlannedPdf(
      await loadPdf(base),
      planDuplicate(2, [0, 1], [0]).layout,
    );
    expect(hasAcroForm(await PDFDocument.load(duplicated))).toBe(false);
  });
});

describe("store page operations", () => {
  const box = (id: string, pageIndex: number): PdfEdit => ({
    id,
    type: "rectangle",
    pageIndex,
    x: 1,
    y: 1,
    width: 2,
    height: 2,
  });

  beforeEach(async () => {
    const store = useEditorStore.getState();
    store.setFile(await makePdf([100, 101, 102]));
    store.setNumPages(3);
    useEditorStore.setState({ edits: [box("a", 0), box("c", 2)], _past: [], _future: [] });
  });

  test("duplicatePages rewrites the file, copies edits, and undoes in one step", async () => {
    const before = useEditorStore.getState();
    const created = await before.duplicatePages([2]);
    const after = useEditorStore.getState();

    expect(created).toEqual([3]);
    expect(after.numPages).toBe(4);
    expect(after.pageOrder).toEqual([0, 1, 2, 3]);
    expect(await widthsOf(after.file!)).toEqual([100, 101, 102, 102]);
    expect(after.edits.map((e) => e.pageIndex)).toEqual([0, 2, 3]);
    expect(new Set(after.edits.map((e) => e.id)).size).toBe(3);
    expect(after._past).toHaveLength(1);

    after.undo();
    const undone = useEditorStore.getState();
    expect(undone.file).toBe(before.file);
    expect(undone.pageOrder).toEqual([0, 1, 2]);
    expect(undone.edits).toEqual(before.edits);
  });

  test("replacePages keeps neighbours, drops the replaced page's edits", async () => {
    const other = await makePdf([200, 201], "other.pdf");
    const created = await useEditorStore.getState().replacePages([0], other, [1]);
    const after = useEditorStore.getState();
    expect(created).toEqual([0]);
    expect(await widthsOf(after.file!)).toEqual([201, 101, 102]);
    expect(after.edits.map((e) => e.id)).toEqual(["c"]);
    expect(after._past).toHaveLength(1);
  });

  test("insertPages after a deleted page keeps it deleted through the reload", async () => {
    useEditorStore.getState().deletePage(1);
    await useEditorStore.getState().insertPages([{ kind: "blank" }], 2);
    const s = useEditorStore.getState();
    expect(s.pageOrder).toEqual([0, 2, 3]);
    // The viewer re-reports the page count after the File changes.
    s.setNumPages(4);
    expect(useEditorStore.getState().pageOrder).toEqual([0, 2, 3]);
  });

  test("rotatePages and deletePages are one history step each", () => {
    const store = useEditorStore.getState();
    store.rotatePages([0, 2], 90);
    expect(useEditorStore.getState().pageOps).toEqual([
      { pageIndex: 0, rotation: 90 },
      { pageIndex: 2, rotation: 90 },
    ]);
    store.deletePages([0, 1]);
    const s = useEditorStore.getState();
    expect(s.pageOrder).toEqual([2]);
    expect(s.edits.map((e) => e.id)).toEqual(["c"]);
    expect(s._past).toHaveLength(2);
    // Never removes every page.
    s.deletePages([2]);
    expect(useEditorStore.getState().pageOrder).toEqual([2]);
  });
});
