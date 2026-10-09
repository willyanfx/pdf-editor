import { expect, test } from "vite-plus/test";
import {
  buildFieldIndex,
  changedFormNames,
  defaultFormValues,
  effectiveFormValue,
  formValueEquals,
  normalizeFormValue,
  readWidgetControl,
  summarizeFields,
  widgetStorageValue,
  writeWidgetControl,
  type PdfJsFieldObject,
} from "./formFields";

/** Shaped like pdf.js 5.4.296 `getFieldObjects()` output. */
const FIELD_OBJECTS: Record<string, PdfJsFieldObject[]> = {
  "person.name": [
    { id: "10R", type: "text", value: "Ada", defaultValue: "", editable: true, page: 0 },
    { id: "11R", type: "text", value: "Ada", defaultValue: "", editable: true, page: 2 },
  ],
  agree: [
    {
      id: "12R",
      type: "checkbox",
      value: "Ja",
      defaultValue: "Off",
      exportValues: "Ja",
      editable: true,
      page: 0,
    },
  ],
  color: ["0", "1", "2"].map((s, i) => ({
    id: `2${i}R`,
    type: "radiobutton",
    value: "Off",
    defaultValue: "1",
    exportValues: s,
    editable: true,
    page: 1,
  })),
  toppings: [
    {
      id: "30R",
      type: "listbox",
      value: "cheese", // pdf.js truncates to the first selected item
      defaultValue: null,
      multipleSelection: true,
      editable: true,
      page: 1,
    },
  ],
  size: [{ id: "31R", type: "combobox", value: null, defaultValue: "M", editable: true, page: 1 }],
  locked: [{ id: "40R", type: "text", value: "x", defaultValue: "", editable: false, page: 0 }],
  submit: [{ id: "50R", type: "button", page: 0 }],
  parent: [{ id: "60R", type: "", page: -1 }],
};

const index = buildFieldIndex(FIELD_OBJECTS, new Map([["30R", ["cheese", "peppers"]]]));

test("builds one entry per fillable field, with every widget and its page", () => {
  expect([...index.fields.keys()].sort()).toEqual(
    ["agree", "color", "locked", "person.name", "size", "toppings"].sort(),
  );
  const name = index.fields.get("person.name")!;
  expect(name.widgets.map((w) => [w.id, w.page])).toEqual([
    ["10R", 0],
    ["11R", 2],
  ]);
  expect(index.widgetToField.get("11R")).toBe("person.name");
  expect(index.fields.get("color")!.widgets.map((w) => w.exportValue)).toEqual(["0", "1", "2"]);
});

test("normalizes original and default values per kind", () => {
  const f = (n: string) => index.fields.get(n)!;
  expect(f("agree").originalValue).toBe(true);
  expect(f("agree").defaultValue).toBe(false);
  expect(f("color").originalValue).toBe("");
  expect(f("color").defaultValue).toBe("1");
  // Full multi-select original comes from the page annotations, not getFieldObjects.
  expect(f("toppings").originalValue).toEqual(["cheese", "peppers"]);
  expect(f("toppings").defaultValue).toEqual([]);
  expect(f("size").originalValue).toBe("");
  expect(f("size").defaultValue).toBe("M");
  expect(f("locked").readOnly).toBe(true);
});

test("reset defaults skip read-only fields", () => {
  const defaults = defaultFormValues(summarizeFields(index));
  expect(defaults).toEqual({
    "person.name": "",
    agree: false,
    color: "1",
    toppings: [],
    size: "M",
  });
});

test("no form → empty index", () => {
  expect(buildFieldIndex(null).fields.size).toBe(0);
});

test("value helpers", () => {
  expect(normalizeFormValue("checkbox", "Off")).toBe(false);
  expect(normalizeFormValue("listbox", "a")).toEqual(["a"]);
  expect(normalizeFormValue("radio", "Off")).toBe("");
  expect(formValueEquals(["a", "b"], ["b", "a"])).toBe(true);
  expect(formValueEquals("a", "b")).toBe(false);
  expect(changedFormNames({ a: "1", b: "2" }, { a: "1", c: "3" }).sort()).toEqual(["b", "c"]);
  const name = index.fields.get("person.name")!;
  expect(effectiveFormValue(name, {})).toBe("Ada");
  expect(effectiveFormValue(name, { "person.name": "Grace" })).toBe("Grace");
});

test("annotationStorage entries mirror pdf.js widget shapes", () => {
  const color = index.fields.get("color")!;
  expect(widgetStorageValue(color, color.widgets[1], "1")).toEqual({ value: true });
  expect(widgetStorageValue(color, color.widgets[0], "1")).toEqual({ value: false });
  const text = index.fields.get("person.name")!;
  expect(widgetStorageValue(text, text.widgets[0], "Hi")).toEqual({
    value: "Hi",
    formattedValue: "Hi",
  });
  const size = index.fields.get("size")!;
  // Choice values are arrays so pdf.js's `.includes` is an exact match.
  expect(widgetStorageValue(size, size.widgets[0], "M")).toEqual({ value: ["M"] });
  expect(widgetStorageValue(size, size.widgets[0], "")).toEqual({ value: [] });
});

test("reads and writes widget controls", () => {
  const color = index.fields.get("color")!;
  expect(readWidgetControl(color, color.widgets[2], { checked: true })).toBe("2");
  expect(readWidgetControl(color, color.widgets[2], { checked: false })).toBeUndefined();

  const toppings = index.fields.get("toppings")!;
  const options = [
    { value: "cheese", selected: false },
    { value: "olives", selected: true },
    { value: "peppers", selected: true },
  ];
  expect(readWidgetControl(toppings, toppings.widgets[0], { options })).toEqual([
    "olives",
    "peppers",
  ]);
  writeWidgetControl(toppings, toppings.widgets[0], { options }, ["cheese"]);
  expect(options.map((o) => o.selected)).toEqual([true, false, false]);

  const size = index.fields.get("size")!;
  expect(readWidgetControl(size, size.widgets[0], { value: " " })).toBe("");

  const radio = { checked: false };
  writeWidgetControl(color, color.widgets[1], radio, "1");
  expect(radio.checked).toBe(true);
});
