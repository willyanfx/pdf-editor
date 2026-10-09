import { useEffect, useRef, type RefObject } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEditorStore } from "../store/useEditorStore";
import {
  buildFieldIndex,
  changedFormNames,
  effectiveFormValue,
  readWidgetControl,
  summarizeFields,
  widgetStorageValue,
  writeWidgetControl,
  type FormFieldIndex,
  type FormValues,
  type PdfJsFieldObject,
} from "../lib/formFields";

/**
 * Two-way sync between the pdf.js form widgets react-pdf renders and the
 * store's `formValues` (the source of truth).
 *
 * Why this mechanism (pdf.js 5.4.296 / react-pdf 10): every widget reads its
 * value from `pdf.annotationStorage` (a map keyed by widget id) ONCE, when its
 * page's annotation layer renders, and writes back to it on user input. pdf.js's
 * only push channel into rendered widgets ("updatefromsandbox" events) exists
 * only with scripting enabled, which react-pdf never turns on; and its sibling
 * lookup (radio groups, same-named fields) only sees pages that are mounted,
 * which with our virtualized viewer is a handful. So the sync is explicit:
 *
 * - user → store: one delegated input/change listener on the viewer root reads
 *   the control the user touched (found by its `data-element-id`) and calls
 *   setFormValue. It runs in the bubble phase, after pdf.js's own handler.
 * - store → widgets: on every formValues change — typing, undo/redo, Reset
 *   form, crash restore — write the field's value into annotationStorage for
 *   EVERY widget id of the field (so pages that mount later render it) and
 *   patch the controls already mounted. Assigning .value/.checked fires no
 *   input event, so this can't loop. A field that drops out of formValues
 *   (undo past its first edit) has its storage entries removed, so pdf.js falls
 *   back to the document's own value and appearance.
 */
export function useFormFieldSync(
  pdf: PDFDocumentProxy | null,
  rootRef: RefObject<HTMLElement | null>,
) {
  const indexRef = useRef<FormFieldIndex | null>(null);

  // Read the document's fields once per loaded document.
  useEffect(() => {
    indexRef.current = null;
    useEditorStore.getState().setFormFields(null);
    if (!pdf) return;
    let cancelled = false;
    void (async () => {
      try {
        const objects = (await pdf.getFieldObjects()) as Record<string, PdfJsFieldObject[]> | null;
        if (cancelled || !objects) return;
        const listValues = await readMultiSelectValues(pdf, objects);
        if (cancelled) return;
        const index = buildFieldIndex(objects, listValues);
        if (index.fields.size === 0) return;
        indexRef.current = index;
        const { formValues, setFormFields } = useEditorStore.getState();
        setFormFields(summarizeFields(index));
        // Values restored before the fields were known (autosave restore).
        applyToWidgets(pdf, index, rootRef.current, Object.keys(formValues), formValues);
      } catch {
        // A form pdf.js can't read stays view-only; the rest of the app is fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, rootRef]);

  // store → widgets
  useEffect(() => {
    if (!pdf) return;
    return useEditorStore.subscribe((state, prev) => {
      const index = indexRef.current;
      if (!index || state.formValues === prev.formValues) return;
      const names = changedFormNames(prev.formValues, state.formValues);
      applyToWidgets(pdf, index, rootRef.current, names, state.formValues);
    });
  }, [pdf, rootRef]);

  // user → store
  useEffect(() => {
    const root = rootRef.current;
    if (!pdf || !root) return;
    function onUserInput(e: Event) {
      const el = e.target;
      if (
        !(
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        ) ||
        !el.closest(".annotationLayer")
      ) {
        return;
      }
      const id = el.getAttribute("data-element-id");
      const index = indexRef.current;
      const name = id ? index?.widgetToField.get(id) : undefined;
      const field = name ? index?.fields.get(name) : undefined;
      const widget = field?.widgets.find((w) => w.id === id);
      if (!field || !widget || field.readOnly) return;
      // Text fields also fire `change` on blur; the `input` events already
      // recorded every keystroke.
      if (e.type === "change" && field.kind === "text") return;
      const value = readWidgetControl(field, widget, el);
      if (value === undefined) return;
      useEditorStore.getState().setFormValue(field.name, value, field.kind === "text");
    }
    root.addEventListener("input", onUserInput);
    root.addEventListener("change", onUserInput);
    return () => {
      root.removeEventListener("input", onUserInput);
      root.removeEventListener("change", onUserInput);
    };
  }, [pdf, rootRef]);
}

function applyToWidgets(
  pdf: PDFDocumentProxy,
  index: FormFieldIndex,
  root: HTMLElement | null,
  names: Iterable<string>,
  values: FormValues,
) {
  const storage = pdf.annotationStorage;
  for (const name of names) {
    const field = index.fields.get(name);
    if (!field || field.readOnly) continue;
    const explicit = values[name] !== undefined;
    const value = effectiveFormValue(field, values);
    for (const widget of field.widgets) {
      if (explicit) storage.setValue(widget.id, widgetStorageValue(field, widget, value));
      else storage.remove(widget.id);
      const el = root?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        `.annotationLayer [data-element-id="${CSS.escape(widget.id)}"]`,
      );
      if (el) writeWidgetControl(field, widget, el, value);
    }
  }
}

/** getFieldObjects() reports only the FIRST selected item of a list box; read
 * the full selection of multi-select lists from their page's annotations. */
async function readMultiSelectValues(
  pdf: PDFDocumentProxy,
  objects: Record<string, PdfJsFieldObject[]>,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const pages = new Set<number>();
  for (const entries of Object.values(objects)) {
    for (const e of entries) {
      if (e.type === "listbox" && e.multipleSelection && typeof e.page === "number" && e.page >= 0)
        pages.add(e.page);
    }
  }
  for (const p of pages) {
    const page = await pdf.getPage(p + 1);
    const annots = (await page.getAnnotations()) as { id?: string; fieldValue?: unknown }[];
    for (const a of annots) {
      if (typeof a.id === "string" && Array.isArray(a.fieldValue)) {
        out.set(
          a.id,
          a.fieldValue.filter((v): v is string => typeof v === "string"),
        );
      }
    }
  }
  return out;
}
