import { beforeEach, expect, test } from "vite-plus/test";
import { useEditorStore } from "./useEditorStore";

beforeEach(() => {
  useEditorStore.getState().setFile(new File([], "a.pdf", { type: "application/pdf" }));
});

test("typing into one field coalesces into a single undo step", () => {
  const s = useEditorStore.getState();
  s.setFormValue("name", "A", true);
  s.setFormValue("name", "Ad", true);
  s.setFormValue("name", "Ada", true);
  expect(useEditorStore.getState().formValues).toEqual({ name: "Ada" });
  expect(useEditorStore.getState()._past).toHaveLength(1);

  useEditorStore.getState().undo();
  expect(useEditorStore.getState().formValues).toEqual({});
  useEditorStore.getState().redo();
  expect(useEditorStore.getState().formValues).toEqual({ name: "Ada" });
});

test("discrete changes (checkbox, other field) are separate steps; no-ops add none", () => {
  const s = useEditorStore.getState();
  s.setFormValue("name", "Ada", true);
  s.setFormValue("agree", true);
  s.setFormValue("agree", true); // unchanged → no history
  s.setFormValue("toppings", ["b", "a"]);
  s.setFormValue("toppings", ["a", "b"]); // same set → no history
  expect(useEditorStore.getState()._past).toHaveLength(3);
  useEditorStore.getState().undo();
  expect(useEditorStore.getState().formValues).toEqual({ name: "Ada", agree: true });
});

test("reset replaces all values in one undoable step; opening a file clears them", () => {
  const s = useEditorStore.getState();
  s.setFormValue("name", "Ada", true);
  s.replaceFormValues({ name: "", agree: false });
  expect(useEditorStore.getState().formValues).toEqual({ name: "", agree: false });
  useEditorStore.getState().undo();
  expect(useEditorStore.getState().formValues).toEqual({ name: "Ada" });

  useEditorStore
    .getState()
    .setFormFields([{ name: "name", kind: "text", readOnly: false, defaultValue: "" }]);
  useEditorStore.getState().setFile(new File([], "b.pdf", { type: "application/pdf" }));
  expect(useEditorStore.getState().formValues).toEqual({});
  expect(useEditorStore.getState().formFields).toBeNull();
});
