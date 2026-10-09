import { expect, test } from "vite-plus/test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
  type PDFCheckBox,
} from "pdf-lib";
import { exportEditedPdf } from "./exportPdf";
import type { FormValues } from "./formFields";

function toFile(bytes: Uint8Array, name = "form.pdf") {
  return new File([bytes.slice()], name, { type: "application/pdf" });
}

/** Rename a pdf-lib checkbox's on-state ("Yes") to `onName` in every widget's
 * appearance dicts, like forms authored in other tools ("Ja", "1", "On"…). */
function renameOnState(box: PDFCheckBox, onName: string) {
  for (const widget of box.acroField.getWidgets()) {
    const ap = widget.dict.lookup(PDFName.of("AP"), PDFDict);
    for (const key of ["N", "D"]) {
      const states = ap.lookupMaybe(PDFName.of(key), PDFDict);
      const on = states?.get(PDFName.of("Yes"));
      if (states && on) {
        states.delete(PDFName.of("Yes"));
        states.set(PDFName.of(onName), on);
      }
    }
  }
}

/** A one-page form exercising every field kind. */
async function buildFormPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();

  form.createTextField("name").addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
  // Hierarchical: person → address → city (pdf-lib splits on dots).
  form
    .createTextField("person.address.city")
    .addToPage(page, { x: 50, y: 660, width: 200, height: 24 });

  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 50, y: 620, width: 16, height: 16 });
  renameOnState(agree, "Ja");

  const color = form.createRadioGroup("color");
  ["red", "green", "blue"].forEach((opt, i) =>
    color.addOptionToPage(opt, page, { x: 50 + i * 30, y: 580, width: 16, height: 16 }),
  );

  const size = form.createDropdown("size");
  size.setOptions(["S", "M", "L"]);
  size.addToPage(page, { x: 50, y: 540, width: 100, height: 20 });

  const toppings = form.createOptionList("toppings");
  toppings.setOptions(["cheese", "olives", "peppers"]);
  toppings.enableMultiselect();
  toppings.addToPage(page, { x: 50, y: 440, width: 100, height: 80 });

  const locked = form.createTextField("locked");
  locked.setText("original");
  locked.enableReadOnly();
  locked.addToPage(page, { x: 300, y: 700, width: 200, height: 24 });

  return doc.save();
}

async function exportWith(values: FormValues, flattenForms = false) {
  const src = await buildFormPdf();
  const out = await exportEditedPdf(toFile(src), [], { formValues: values, flattenForms });
  return PDFDocument.load(out);
}

function appearanceText(doc: PDFDocument, fieldName: string): string {
  const field = doc.getForm().getField(fieldName);
  const widget = field.acroField.getWidgets()[0];
  const n = widget.getNormalAppearance();
  const stream = doc.context.lookup(n);
  if (!(stream instanceof PDFRawStream)) throw new Error("no appearance stream");
  return new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
}

const hex = (s: string) =>
  Array.from(s)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

test("fills text fields (incl. dotted hierarchical names) and redraws their appearance", async () => {
  const doc = await exportWith({ name: "Ada Lovelace", "person.address.city": "London" });
  const form = doc.getForm();
  expect(form.getTextField("name").getText()).toBe("Ada Lovelace");
  expect(form.getTextField("person.address.city").getText()).toBe("London");
  // The regenerated appearance draws the new value, so every viewer shows it.
  expect(appearanceText(doc, "name").toUpperCase()).toContain(hex("Ada Lovelace"));
  // Fields stay interactive: still an AcroForm field with a widget on the page.
  expect(form.getFields().length).toBeGreaterThan(0);
  expect(doc.getPage(0).node.Annots()?.size()).toBeGreaterThan(0);
});

test("checkbox uses the widget's own on-state name, not a hard-coded Yes", async () => {
  const checked = await exportWith({ agree: true });
  const box = checked.getForm().getCheckBox("agree");
  expect(box.acroField.getValue()).toBe(PDFName.of("Ja"));
  expect(box.acroField.getWidgets()[0].getAppearanceState()).toBe(PDFName.of("Ja"));
  expect(box.isChecked()).toBe(true);

  const unchecked = await exportWith({ agree: false });
  expect(unchecked.getForm().getCheckBox("agree").acroField.getValue()).toBe(PDFName.of("Off"));
});

test("radio group accepts the on-state name pdf.js reports, or the /Opt export value", async () => {
  // pdf-lib radios have on-states "0","1","2" with /Opt [red green blue].
  const byState = await exportWith({ color: "1" });
  const radio = byState.getForm().getRadioGroup("color");
  expect(radio.getSelected()).toBe("green");
  const states = radio.acroField.getWidgets().map((w) => w.getAppearanceState()?.decodeText());
  expect(states).toEqual(["Off", "1", "Off"]);

  const byExport = await exportWith({ color: "blue" });
  expect(byExport.getForm().getRadioGroup("color").getSelected()).toBe("blue");

  const cleared = await exportWith({ color: "" });
  expect(cleared.getForm().getRadioGroup("color").getSelected()).toBeUndefined();

  // An option that doesn't exist leaves the group as it was.
  const bogus = await exportWith({ color: "purple" });
  expect(bogus.getForm().getRadioGroup("color").getSelected()).toBeUndefined();
});

test("dropdown selects a listed option and ignores free text when not editable", async () => {
  const doc = await exportWith({ size: "M" });
  expect(doc.getForm().getDropdown("size").getSelected()).toEqual(["M"]);

  const free = await exportWith({ size: "XXL" });
  expect(free.getForm().getDropdown("size").getSelected()).toEqual([]);
});

test("multi-select list keeps every chosen option and updates /I", async () => {
  const doc = await exportWith({ toppings: ["peppers", "cheese"] });
  const list = doc.getForm().getOptionList("toppings");
  expect(list.getSelected().sort()).toEqual(["cheese", "peppers"]);
  const indices = list.acroField.dict.lookup(PDFName.of("I"), PDFArray);
  expect(indices.asArray().map((n) => (n as PDFNumber).asNumber())).toEqual([0, 2]);
});

test("text the standard font can't draw still saves, asking viewers to redraw", async () => {
  const doc = await exportWith({ name: "東京 Tokyo" });
  expect(doc.getForm().getTextField("name").getText()).toBe("東京 Tokyo");
  expect(doc.getForm().acroForm.dict.get(PDFName.of("NeedAppearances"))?.toString()).toBe("true");
});

test("read-only fields and unknown names are left untouched", async () => {
  const doc = await exportWith({ locked: "changed", "no.such.field": "x" });
  expect(doc.getForm().getTextField("locked").getText()).toBe("original");
});

test("flattening draws the fields into the page and removes the form", async () => {
  const doc = await exportWith({ name: "Flat Value", agree: true }, true);
  expect(doc.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  const annots = doc.getPage(0).node.Annots();
  const widgets = (annots?.asArray() ?? []).filter(
    (a) => doc.context.lookup(a, PDFDict).get(PDFName.of("Subtype")) === PDFName.of("Widget"),
  );
  expect(widgets).toHaveLength(0);

  // Each visible widget became a form XObject drawn by the page.
  const xobjects = doc.getPage(0).node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const flat = (xobjects?.keys() ?? []).filter((k) => k.decodeText().startsWith("FlatWidget"));
  expect(flat.length).toBeGreaterThanOrEqual(7);
});

test("documents without a form: no AcroForm is created, flatten is a no-op", async () => {
  const plain = await PDFDocument.create();
  plain.addPage([300, 300]);
  const src = await plain.save();
  const out = await exportEditedPdf(toFile(src), [], {
    formValues: { name: "x" },
    flattenForms: true,
  });
  const doc = await PDFDocument.load(out);
  expect(doc.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  expect(doc.getPageCount()).toBe(1);
});
