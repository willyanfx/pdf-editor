import {
  PDFArray,
  PDFBool,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFStream,
  PDFTextField,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFField,
  type PDFFont,
  type PDFForm,
} from "pdf-lib";
import { normalizeFormValue, type FormValue, type FormValues } from "./formFields";
import { removeUnreachableObjects } from "./pageReorder";

/** True when the document has an AcroForm. Checked before touching
 * `doc.getForm()`, which would otherwise CREATE an empty AcroForm (and make
 * save() regenerate appearances) on documents that never had a form. */
export function hasAcroForm(doc: PDFDocument): boolean {
  return doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict) !== undefined;
}

/**
 * Write the user's form values into the document's fields with pdf-lib, then
 * regenerate the appearance of each changed text/choice field so every viewer
 * (not just ones honoring /NeedAppearances) shows the new value. Fields stay
 * interactive. Read-only fields, unknown names, and values that don't fit the
 * field (a radio option that doesn't exist) are left untouched.
 *
 * Checkbox/radio changes only flip /V and each widget's /AS: their on/off
 * appearances already exist, so the document's own look is preserved.
 */
export function applyFormValues(doc: PDFDocument, values: FormValues | undefined): void {
  const names = Object.keys(values ?? {});
  if (!values || names.length === 0 || !hasAcroForm(doc)) return;

  const form = doc.getForm();
  const byName = new Map<string, PDFField>();
  for (const field of form.getFields()) byName.set(field.getName(), field);

  let font: PDFFont | undefined;
  const getFont = () => (font ??= form.getDefaultFont());
  let needAppearances = false;

  for (const name of names) {
    const field = byName.get(name);
    if (!field || field.isReadOnly()) continue;
    try {
      const changed = setFieldValue(field, values[name]);
      if (changed) needAppearances ||= !refreshAppearance(form, field, getFont);
    } catch (err) {
      console.warn(`[formExport] could not set field "${name}":`, err);
    }
  }

  // A value the standard font can't encode (e.g. CJK) keeps its old appearance;
  // ask viewers to rebuild appearances from /V instead of showing stale text.
  if (needAppearances) {
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  }
}

/** Set one field from a FormValue. Returns false when nothing changed. */
function setFieldValue(field: PDFField, raw: FormValue): boolean {
  if (field instanceof PDFTextField) {
    let text = normalizeFormValue("text", raw) as string;
    const max = field.getMaxLength();
    if (max !== undefined && text.length > max) text = text.slice(0, max);
    if ((field.getText() ?? "") === text) return false;
    field.setText(text === "" ? undefined : text);
    return true;
  }

  if (field instanceof PDFCheckBox) {
    const want = normalizeFormValue("checkbox", raw) as boolean;
    if (field.isChecked() === want) return false;
    // The widget's own on-state name ("Ja", "1", …), not a hard-coded "Yes".
    const onValue = field.acroField.getOnValue() ?? PDFName.of("Yes");
    field.acroField.setValue(want ? onValue : PDFName.of("Off"));
    return true;
  }

  if (field instanceof PDFRadioGroup) {
    const want = normalizeFormValue("radio", raw) as string;
    const acro = field.acroField;
    const onValues = acro.getOnValues();
    // Values are on-state names (what pdf.js reports); accept an /Opt export
    // value too, mapping it to the on-state at the same index.
    let target = want === "" ? PDFName.of("Off") : onValues.find((n) => n.decodeText() === want);
    if (!target) {
      const idx = (acro.getExportValues() ?? []).findIndex((v) => v.decodeText() === want);
      target = idx >= 0 ? onValues[idx] : undefined;
    }
    if (!target || acro.getValue() === target) return false;
    acro.setValue(target);
    return true;
  }

  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const isList = field instanceof PDFOptionList;
    const options = field.acroField.getOptions();
    const exportOf = (o: (typeof options)[number]) => o.value.decodeText();
    const displayOf = (o: (typeof options)[number]) => (o.display ?? o.value).decodeText();
    const wantRaw = isList
      ? (normalizeFormValue("listbox", raw) as string[])
      : [normalizeFormValue("combobox", raw) as string].filter((v) => v !== "");

    // Values are export values (what pdf.js widgets report); tolerate display
    // text, and allow free text only in editable combo boxes.
    const editable = field instanceof PDFDropdown && field.isEditable();
    const want: string[] = [];
    for (const v of wantRaw) {
      const opt = options.find((o) => exportOf(o) === v) ?? options.find((o) => displayOf(o) === v);
      if (opt) want.push(exportOf(opt));
      else if (editable) want.push(v);
    }
    const multi = isList && field.isMultiselect();
    const chosen = multi ? want : want.slice(0, 1);

    const current = field.acroField.getValues().map((v) => v.decodeText());
    if (current.length === chosen.length && current.every((v, i) => v === chosen[i])) return false;

    // Written directly rather than via pdf-lib's select(), which matches options
    // by DISPLAY text and rejects export values that differ from it.
    const dict = field.acroField.dict;
    if (chosen.length === 0) dict.delete(PDFName.of("V"));
    else if (chosen.length === 1) dict.set(PDFName.of("V"), PDFHexString.fromText(chosen[0]));
    else dict.set(PDFName.of("V"), dict.context.obj(chosen.map((v) => PDFHexString.fromText(v))));

    // /I (selected indices) takes precedence over /V in pdf.js and Acrobat for
    // lists, so keep it in step or the old selection would still show.
    const indices = chosen
      .map((v) => options.findIndex((o) => exportOf(o) === v))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (multi && indices.length > 0) dict.set(PDFName.of("I"), dict.context.obj(indices));
    else dict.delete(PDFName.of("I"));
    return true;
  }

  return false;
}

/** Rebuild a changed field's appearance. Returns false if it couldn't be drawn. */
function refreshAppearance(form: PDFForm, field: PDFField, getFont: () => PDFFont): boolean {
  const isButton = field instanceof PDFCheckBox || field instanceof PDFRadioGroup;
  if (isButton) {
    // Toggling only flips /AS; draw appearances only if the widgets have none.
    const missing = field.acroField
      .getWidgets()
      .some((w) => !(w.getAppearances()?.normal instanceof PDFDict));
    if (!missing) return true;
  }
  try {
    if (field instanceof PDFTextField) field.updateAppearances(getFont());
    else if (field instanceof PDFDropdown) field.updateAppearances(getFont());
    else if (field instanceof PDFOptionList) field.updateAppearances(getFont());
    else if (field instanceof PDFCheckBox) field.updateAppearances();
    else if (field instanceof PDFRadioGroup) field.updateAppearances();
    return true;
  } catch (err) {
    console.warn(`[formExport] could not draw "${field.getName()}":`, err);
    form.markFieldAsClean(field.ref);
    return false;
  }
}

/**
 * Flatten the form: draw every widget's current appearance into its page's
 * content and remove the fields, so the values become ordinary page content.
 *
 * Hand-rolled instead of pdf-lib's `form.flatten()`, which throws on common
 * real-world widgets (unsigned signature fields with no appearance, direct
 * appearance streams) and ignores each appearance's /BBox and /Matrix.
 * Must run BEFORE overlay edits are drawn so those stay on top.
 */
export function flattenForm(doc: PDFDocument): void {
  if (!hasAcroForm(doc)) return;
  const form = doc.getForm();

  // Fields that never had an appearance (forms relying on /NeedAppearances)
  // would otherwise flatten to nothing.
  let font: PDFFont | undefined;
  for (const field of form.getFields()) {
    try {
      if (field.needsAppearancesUpdate())
        field.defaultUpdateAppearances((font ??= form.getDefaultFont()));
    } catch {
      // Leave it: an un-drawable field flattens to whatever appearance it has.
    }
  }

  const { context } = doc;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const widget = annots.lookup(i);
      if (!(widget instanceof PDFDict)) continue;
      if (widget.get(PDFName.of("Subtype")) !== PDFName.of("Widget")) continue;
      annots.remove(i);

      const flags = widget.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
      const HIDDEN = 1 << 1;
      const NO_VIEW = 1 << 5;
      if (flags & (HIDDEN | NO_VIEW)) continue;

      const appearance = normalAppearance(widget);
      const rect = widget.lookupMaybe(PDFName.of("Rect"), PDFArray);
      if (!appearance || !rect || rect.size() < 4) continue;
      const stream = context.lookup(appearance);
      if (!(stream instanceof PDFStream)) continue;
      const ref = appearance instanceof PDFRef ? appearance : context.register(stream);

      const [x1, y1, x2, y2] = [0, 1, 2, 3].map(
        (k) => rect.lookupMaybe(k, PDFNumber)?.asNumber() ?? 0,
      );
      const matrix = appearanceToRectMatrix(stream.dict, {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      });
      if (!matrix) continue;
      const name = page.node.newXObject("FlatWidget", ref);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(...matrix),
        drawObject(name),
        popGraphicsState(),
      );
    }
  }

  // Every field is now page content; drop the form (and any XFA) entirely, and
  // the now-orphaned field/widget objects with it.
  doc.catalog.delete(PDFName.of("AcroForm"));
  removeUnreachableObjects(doc);
}

/** The widget's normal appearance stream for its current state. */
function normalAppearance(widget: PDFDict): PDFRef | PDFStream | undefined {
  const ap = widget.lookupMaybe(PDFName.of("AP"), PDFDict);
  const n = ap?.get(PDFName.of("N"));
  if (!n) return undefined;
  const resolved = widget.context.lookup(n);
  if (resolved instanceof PDFStream) return n instanceof PDFRef ? n : resolved;
  if (resolved instanceof PDFDict) {
    // Checkbox/radio: a dict of states keyed by name; /AS picks the live one.
    const as = widget.get(PDFName.of("AS"));
    const state = as instanceof PDFName ? resolved.get(as) : undefined;
    if (!state) return undefined;
    const s = widget.context.lookup(state);
    if (s instanceof PDFStream) return state instanceof PDFRef ? state : s;
  }
  return undefined;
}

/**
 * The `cm` that places a form XObject so its (Matrix-transformed) BBox fills
 * the widget rect — the PDF spec's algorithm for drawing annotation appearances
 * (ISO 32000-1 §12.5.5). The XObject's own /Matrix is applied by `Do`.
 */
export function appearanceToRectMatrix(
  dict: PDFDict,
  rect: { x: number; y: number; width: number; height: number },
): [number, number, number, number, number, number] | undefined {
  const bboxArr = dict.lookupMaybe(PDFName.of("BBox"), PDFArray);
  const matArr = dict.lookupMaybe(PDFName.of("Matrix"), PDFArray);
  const num = (arr: PDFArray | undefined, i: number, d: number) =>
    arr?.lookupMaybe(i, PDFNumber)?.asNumber() ?? d;
  const bbox = [0, 1, 2, 3].map((i) => num(bboxArr, i, 0));
  const m = [1, 0, 0, 1, 0, 0].map((d, i) => num(matArr, i, d));

  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[0], bbox[3]],
    [bbox[2], bbox[3]],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  if (!(w > 0) || !(h > 0) || !(rect.width > 0) || !(rect.height > 0)) return undefined;

  const sx = rect.width / w;
  const sy = rect.height / h;
  return [sx, 0, 0, sy, rect.x - minX * sx, rect.y - minY * sy];
}
