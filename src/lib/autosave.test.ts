import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  AUTOSAVE_DEBOUNCE_MS,
  __testing,
  checkForRecovery,
  discardPending,
  flushAutosave,
  formatRelativeTime,
  markDocumentSaved,
  recoverPending,
  startAutosave,
  useRecoveryStore,
} from "./autosave";
import { isDocumentDirty, useEditorStore } from "../store/useEditorStore";

const pdf = (name = "a.pdf", bytes = [1, 2, 3]) =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
const rect = (id: string) =>
  ({ id, type: "rectangle", pageIndex: 0, x: 1, y: 2, width: 3, height: 4 }) as const;

/** Open `file` as if the viewer had loaded it. */
function openDocument(file: File, numPages = 2) {
  useEditorStore.getState().setFile(file);
  useEditorStore.getState().setNumPages(numPages);
}

/** Count writes to the File key vs. the meta key. */
function spyOnPuts() {
  const spy = vi.spyOn(IDBObjectStore.prototype, "put"); // calls through
  return { keys: () => spy.mock.calls.map((c) => c[1]) };
}

beforeEach(async () => {
  __testing.reset();
  await __testing.deleteRecord();
  useEditorStore.getState().setFile(pdf("seed.pdf"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a clean document is never saved", async () => {
  openDocument(pdf());
  await flushAutosave();
  expect(await __testing.readRecord()).toBeNull();
});

test("a dirty document round-trips file and snapshot through IndexedDB", async () => {
  const file = pdf("report.pdf", [9, 8, 7, 6]);
  openDocument(file);
  useEditorStore.getState().addEdit(rect("r1"));
  useEditorStore.getState().setPageOp(1, { rotation: 90 });
  await flushAutosave();

  const record = await __testing.readRecord();
  expect(record).not.toBeNull();
  expect(record!.fileName).toBe("report.pdf");
  expect(record!.file.name).toBe("report.pdf");
  expect(new Uint8Array(await record!.file.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));
  expect(record!.snapshot.edits.map((e) => e.id)).toEqual(["r1"]);
  expect(record!.snapshot.pageOps).toEqual([{ pageIndex: 1, rotation: 90 }]);
  expect(record!.snapshot.numPages).toBe(2);
  // The File is stored under its own key, not duplicated in the snapshot.
  expect(record!.snapshot.file).toBeNull();
});

test("the File is only rewritten when its identity changes", async () => {
  const file = pdf();
  openDocument(file);
  const { keys } = spyOnPuts();

  useEditorStore.getState().addEdit(rect("r1"));
  await flushAutosave();
  expect(keys()).toEqual(["file", "meta"]);

  useEditorStore.getState().addEdit(rect("r2"));
  await flushAutosave();
  expect(keys()).toEqual(["file", "meta", "meta"]);

  // An insert/merge swaps the File: it is written again, with the snapshot.
  const merged = pdf("a.pdf", [1, 2, 3, 4, 5]);
  useEditorStore.setState({ file: merged });
  useEditorStore.getState().addEdit(rect("r3"));
  await flushAutosave();
  expect(keys()).toEqual(["file", "meta", "meta", "file", "meta"]);

  const record = await __testing.readRecord();
  expect(record!.file.size).toBe(5);
  expect(record!.snapshot.edits).toHaveLength(3);
});

test("an unchanged revision is not written twice", async () => {
  openDocument(pdf());
  useEditorStore.getState().addEdit(rect("r1"));
  await flushAutosave();
  const { keys } = spyOnPuts();
  await flushAutosave();
  expect(keys()).toEqual([]);
});

test("debounces ~1.5s after the last change and flushes on hide / pagehide", async () => {
  // Leave setImmediate real: fake-indexeddb schedules its work with it.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const doc = {
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const win = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  const stop = startAutosave();
  const listener = (target: typeof doc, type: string) =>
    target.addEventListener.mock.calls.find((c) => c[0] === type)![1] as () => void;

  openDocument(pdf());
  const { keys } = spyOnPuts();
  useEditorStore.getState().addEdit(rect("r1"));
  await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 100);
  expect(keys()).toEqual([]);
  // A further change restarts the debounce window.
  useEditorStore.getState().addEdit(rect("r2"));
  await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 100);
  expect(keys()).toEqual([]);
  await vi.advanceTimersByTimeAsync(200);
  await flushAutosave(); // the timer queued the write; wait for it to settle
  expect(keys()).toEqual(["file", "meta"]);

  // Hiding the tab saves immediately, without waiting for the debounce.
  useEditorStore.getState().addEdit(rect("r3"));
  doc.visibilityState = "hidden";
  listener(doc, "visibilitychange")();
  await flushAutosave(); // awaits the queued write
  expect(keys()).toEqual(["file", "meta", "meta"]);

  useEditorStore.getState().addEdit(rect("r4"));
  listener(win as unknown as typeof doc, "pagehide")();
  await flushAutosave();
  expect(keys()).toHaveLength(4);

  stop();
  expect(doc.removeEventListener).toHaveBeenCalled();
});

test("a successful download marks the document saved and clears the slot", async () => {
  openDocument(pdf());
  useEditorStore.getState().addEdit(rect("r1"));
  await flushAutosave();
  expect(await __testing.readRecord()).not.toBeNull();

  markDocumentSaved(useEditorStore.getState().revision);
  expect(isDocumentDirty()).toBe(false);
  await flushAutosave();
  expect(await __testing.readRecord()).toBeNull();
});

test("a queued save does not resurrect the slot after a download", async () => {
  openDocument(pdf());
  useEditorStore.getState().addEdit(rect("r1"));
  void flushAutosave(); // queued, not yet settled
  markDocumentSaved(useEditorStore.getState().revision);
  await flushAutosave();
  expect(await __testing.readRecord()).toBeNull();
});

test("edits made during an export keep the document dirty and saved", async () => {
  openDocument(pdf());
  useEditorStore.getState().addEdit(rect("r1"));
  const exportedRevision = useEditorStore.getState().revision;
  useEditorStore.getState().addEdit(rect("r2"));
  markDocumentSaved(exportedRevision);
  expect(isDocumentDirty()).toBe(true);
  await flushAutosave();
  const record = await __testing.readRecord();
  expect(record!.snapshot.edits).toHaveLength(2);
});

test("IndexedDB failures warn once and never throw", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("indexedDB", undefined);
  openDocument(pdf());
  useEditorStore.getState().addEdit(rect("r1"));
  await flushAutosave();
  useEditorStore.getState().addEdit(rect("r2"));
  await flushAutosave();
  await checkForRecovery();
  // (zustand's persist middleware also warns about missing localStorage here.)
  const autosaveWarnings = warn.mock.calls.filter((c) => String(c[0]).startsWith("Autosave"));
  expect(autosaveWarnings).toHaveLength(1);
  expect(useRecoveryStore.getState().info).toBeNull();
});

// --- recovery prompt ------------------------------------------------------

/** Leave a slot behind as a previous session would, then "restart" the app. */
async function seedPreviousSession() {
  openDocument(pdf("old.pdf", [4, 4, 4]), 3);
  useEditorStore.getState().addEdit(rect("old1"));
  useEditorStore.getState().setPageOrder([2, 1, 0]);
  await flushAutosave();
  __testing.reset();
  useEditorStore.getState().setFile(pdf("seed.pdf")); // fresh app: nothing open yet
  useEditorStore.setState({ file: null });
}

test("no prompt when there is nothing to recover", async () => {
  await checkForRecovery();
  expect(useRecoveryStore.getState().info).toBeNull();
});

test("offers recovery of the stored document at startup", async () => {
  await seedPreviousSession();
  await checkForRecovery();
  const info = useRecoveryStore.getState().info;
  expect(info?.fileName).toBe("old.pdf");
  expect(typeof info?.savedAt).toBe("number");
});

test("no prompt when the user already opened another file", async () => {
  await seedPreviousSession();
  useEditorStore.getState().setFile(pdf("other.pdf"));
  await checkForRecovery();
  expect(useRecoveryStore.getState().info).toBeNull();
});

test("opening and editing another file cannot overwrite an unanswered slot", async () => {
  await seedPreviousSession();
  await checkForRecovery();

  openDocument(pdf("other.pdf"));
  useEditorStore.getState().addEdit(rect("n1"));
  await flushAutosave();
  // ...nor can downloading it delete the old work.
  markDocumentSaved(useEditorStore.getState().revision);
  await flushAutosave();

  const record = await __testing.readRecord();
  expect(record?.fileName).toBe("old.pdf");
  expect(record?.snapshot.edits.map((e) => e.id)).toEqual(["old1"]);
});

test("Discard deletes the slot and lets autosave resume", async () => {
  await seedPreviousSession();
  await checkForRecovery();
  await discardPending();
  expect(useRecoveryStore.getState().info).toBeNull();
  expect(await __testing.readRecord()).toBeNull();

  openDocument(pdf("new.pdf"));
  useEditorStore.getState().addEdit(rect("n1"));
  await flushAutosave();
  expect((await __testing.readRecord())?.fileName).toBe("new.pdf");
});

test("Recover opens the stored file, then restores the snapshot once pages are known", async () => {
  await seedPreviousSession();
  await checkForRecovery();
  recoverPending();

  const opened = useEditorStore.getState();
  expect(opened.file?.name).toBe("old.pdf");
  expect(opened.edits).toEqual([]); // not restored until the viewer reports pages
  expect(useRecoveryStore.getState().info).toBeNull();

  useEditorStore.getState().setNumPages(3); // what PdfViewer does on load
  const restored = useEditorStore.getState();
  expect(restored.edits.map((e) => e.id)).toEqual(["old1"]);
  expect(restored.pageOrder).toEqual([2, 1, 0]);
  expect(isDocumentDirty()).toBe(true);

  // The slot already has this File; saving the restored document only touches meta.
  const { keys } = spyOnPuts();
  await flushAutosave();
  expect(keys()).toEqual(["meta"]);
});

test("Recover gives up quietly if another file replaces it before it loads", async () => {
  await seedPreviousSession();
  await checkForRecovery();
  recoverPending();
  useEditorStore.getState().setFile(pdf("other.pdf"));
  useEditorStore.getState().setNumPages(1);
  expect(useEditorStore.getState().edits).toEqual([]);
});

test("formatRelativeTime", () => {
  const now = 1_000_000_000_000;
  expect(formatRelativeTime(now - 10_000, now)).toBe("a moment ago");
  expect(formatRelativeTime(now - 60_000, now)).toBe("1 minute ago");
  expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 minutes ago");
  expect(formatRelativeTime(now - 3_600_000, now)).toBe("1 hour ago");
  expect(formatRelativeTime(now - 5 * 3_600_000, now)).toBe("5 hours ago");
  expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe("3 days ago");
  expect(formatRelativeTime(now + 5000, now)).toBe("a moment ago");
});
