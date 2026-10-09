/**
 * AcroForm field model shared by the viewer (pdf.js widgets) and the store.
 * Pure data + helpers only — no pdf.js / pdf-lib imports — so the store and the
 * viewer can use it without pulling a PDF library into their chunk.
 *
 * Values are keyed by FULLY-QUALIFIED field name ("person.address.city"), the
 * name both pdf.js (`fieldName`) and pdf-lib (`getName()`) report, so one key
 * addresses every widget of a field across pages.
 */

/** A form field's value as the user set it.
 * - text: the string
 * - checkbox: checked or not
 * - radio: the chosen button's on-state name ("" = none chosen)
 * - combobox: the chosen option's export value ("" = none)
 * - listbox: the chosen options' export values (multi-select or single) */
export type FormValue = string | boolean | string[];
export type FormValues = Record<string, FormValue>;

export type FormFieldKind = "text" | "checkbox" | "radio" | "combobox" | "listbox";

/** What the store/UI needs to know about a field (no widget ids). */
export type FormFieldSummary = {
  name: string;
  kind: FormFieldKind;
  readOnly: boolean;
  /** The document's default (/DV) value, normalized for `kind`. Reset uses it. */
  defaultValue: FormValue;
};

/** One on-page widget of a field, as pdf.js identifies it in the DOM
 * (`data-element-id`) and in its annotationStorage. */
export type FormWidget = {
  id: string;
  /** Checkbox/radio on-state name for this widget; undefined for other kinds. */
  exportValue?: string;
  /** 0-based page index of the widget in the loaded document. */
  page: number;
};

export type FormFieldInfo = FormFieldSummary & {
  widgets: FormWidget[];
  /** The value stored in the document as opened (/V), normalized for `kind`. */
  originalValue: FormValue;
  multiSelect: boolean;
};

export type FormFieldIndex = {
  fields: Map<string, FormFieldInfo>;
  /** pdf.js widget/annotation id → fully-qualified field name. */
  widgetToField: Map<string, string>;
};

/** The subset of pdf.js `getFieldObjects()` entries we read. */
export type PdfJsFieldObject = {
  id: string;
  name?: string;
  type?: string;
  value?: unknown;
  defaultValue?: unknown;
  exportValues?: unknown;
  editable?: boolean;
  multipleSelection?: boolean;
  page?: number;
};

const KIND_BY_PDFJS_TYPE: Record<string, FormFieldKind> = {
  text: "text",
  checkbox: "checkbox",
  radiobutton: "radio",
  combobox: "combobox",
  listbox: "listbox",
};

/** Coerce any raw value into the canonical FormValue shape for `kind`. */
export function normalizeFormValue(kind: FormFieldKind, raw: unknown): FormValue {
  switch (kind) {
    case "checkbox":
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "string") return raw !== "" && raw !== "Off";
      return false;
    case "listbox":
      if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
      return typeof raw === "string" && raw !== "" ? [raw] : [];
    case "radio":
      if (Array.isArray(raw))
        return typeof raw[0] === "string" ? normalizeFormValue(kind, raw[0]) : "";
      return typeof raw === "string" && raw !== "Off" ? raw : "";
    default:
      if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0] : "";
      return typeof raw === "string" ? raw : "";
  }
}

/** Value equality (list values compare as sets — selection order is irrelevant). */
export function formValueEquals(a: FormValue | undefined, b: FormValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
  }
  return a === b;
}

/**
 * Build the field index from pdf.js `getFieldObjects()` output. Entries that
 * aren't fillable (push buttons, signatures, non-terminal parents with type "")
 * are skipped. `listValues` supplies full multi-select originals, which
 * getFieldObjects truncates to the first selected item.
 */
export function buildFieldIndex(
  fieldObjects: Record<string, PdfJsFieldObject[]> | null | undefined,
  listValues: Map<string, string[]> = new Map(),
): FormFieldIndex {
  const fields = new Map<string, FormFieldInfo>();
  const widgetToField = new Map<string, string>();
  if (!fieldObjects) return { fields, widgetToField };

  for (const [name, entries] of Object.entries(fieldObjects)) {
    for (const entry of entries) {
      const kind = entry.type ? KIND_BY_PDFJS_TYPE[entry.type] : undefined;
      if (!kind || typeof entry.id !== "string") continue;
      const page = typeof entry.page === "number" ? entry.page : -1;
      if (page < 0) continue; // a field object with no on-page widget

      let field = fields.get(name);
      if (!field) {
        const multiSelect = kind === "listbox" && entry.multipleSelection === true;
        const original =
          kind === "listbox" && listValues.has(entry.id)
            ? (listValues.get(entry.id) ?? [])
            : entry.value;
        field = {
          name,
          kind,
          readOnly: entry.editable === false,
          defaultValue: normalizeFormValue(kind, entry.defaultValue),
          originalValue: normalizeFormValue(kind, original),
          multiSelect,
          widgets: [],
        };
        fields.set(name, field);
      }
      if (entry.editable === false) field.readOnly = true;
      field.widgets.push({
        id: entry.id,
        page,
        exportValue: typeof entry.exportValues === "string" ? entry.exportValues : undefined,
      });
      widgetToField.set(entry.id, name);
    }
  }
  return { fields, widgetToField };
}

export function summarizeFields(index: FormFieldIndex): FormFieldSummary[] {
  return [...index.fields.values()].map(({ name, kind, readOnly, defaultValue }) => ({
    name,
    kind,
    readOnly,
    defaultValue,
  }));
}

/** The values "Reset form" applies: every editable field back to its /DV. */
export function defaultFormValues(fields: FormFieldSummary[]): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    if (f.readOnly) continue;
    out[f.name] = Array.isArray(f.defaultValue) ? [...f.defaultValue] : f.defaultValue;
  }
  return out;
}

/** What the field currently shows: the user's value, else the document's. */
export function effectiveFormValue(field: FormFieldInfo, values: FormValues): FormValue {
  const v = values[field.name];
  return v === undefined ? field.originalValue : normalizeFormValue(field.kind, v);
}

/**
 * The pdf.js annotationStorage entry for one widget showing `value`. Shapes
 * mirror what pdf.js's own widget event handlers write (pdf.js 5.4.296):
 * text `{value, formattedValue}`, checkbox/radio `{value: boolean}`, choice
 * `{value: string[]}`. Choice values are always arrays: the widget renderer
 * tests `storedValue.includes(exportValue)`, which on a string would be a
 * substring match ("App" would select "Apple").
 */
export function widgetStorageValue(
  field: FormFieldInfo,
  widget: FormWidget,
  value: FormValue,
): Record<string, unknown> {
  const v = normalizeFormValue(field.kind, value);
  switch (field.kind) {
    case "text":
      // formattedValue wins over the field's appearance text when pdf.js
      // re-renders the widget, so set it or a remount shows the old text.
      return { value: v, formattedValue: v };
    case "checkbox":
      return { value: v === true };
    case "radio":
      return { value: v !== "" && v === widget.exportValue };
    case "combobox":
      return { value: v === "" ? [] : [v as string] };
    case "listbox":
      return { value: v as string[] };
  }
}

/** Minimal shape of the DOM controls pdf.js renders for widgets. */
type WidgetControl = {
  value?: string;
  checked?: boolean;
  multiple?: boolean;
  options?: ArrayLike<{ value: string; selected: boolean }>;
};

/** Read the value a user just entered into a pdf.js widget control. */
export function readWidgetControl(
  field: FormFieldInfo,
  widget: FormWidget,
  el: WidgetControl,
): FormValue | undefined {
  switch (field.kind) {
    case "text":
      return el.value ?? "";
    case "checkbox":
      return el.checked === true;
    case "radio":
      // Radios only fire `change` when they become checked.
      return el.checked ? (widget.exportValue ?? "") : undefined;
    case "combobox": {
      const v = el.value ?? "";
      // pdf.js prepends a hidden " " option to represent "nothing chosen".
      return v === " " ? "" : v;
    }
    case "listbox":
      return Array.from(el.options ?? [])
        .filter((o) => o.selected)
        .map((o) => o.value);
  }
}

/** Push `value` into a mounted widget control without firing input events. */
export function writeWidgetControl(
  field: FormFieldInfo,
  widget: FormWidget,
  el: WidgetControl & { selectedIndex?: number },
  value: FormValue,
): void {
  const v = normalizeFormValue(field.kind, value);
  switch (field.kind) {
    case "text":
      if (el.value !== v) el.value = v as string;
      return;
    case "checkbox":
      el.checked = v === true;
      return;
    case "radio":
      el.checked = v !== "" && v === widget.exportValue;
      return;
    case "combobox":
    case "listbox": {
      const chosen = new Set(Array.isArray(v) ? v : v === "" ? [] : [v]);
      let any = false;
      for (const opt of Array.from(el.options ?? [])) {
        const on = chosen.has(opt.value) || (chosen.size === 0 && opt.value === " ");
        opt.selected = on;
        any ||= on;
      }
      if (!any && "selectedIndex" in el) el.selectedIndex = -1;
      return;
    }
  }
}

/** Every field name whose value differs between two FormValues objects. */
export function changedFormNames(prev: FormValues, next: FormValues): string[] {
  const names = new Set([...Object.keys(prev), ...Object.keys(next)]);
  return [...names].filter((n) => prev[n] !== next[n]);
}
