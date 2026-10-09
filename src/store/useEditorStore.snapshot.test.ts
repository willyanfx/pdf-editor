import { beforeEach, expect, test } from "vite-plus/test";
import {
  getDocumentSnapshot,
  isDocumentDirty,
  makeTextEdit,
  restoreDocumentSnapshot,
  useEditorStore,
} from "./useEditorStore";

const pdf = () => new File([new Uint8Array([1, 2, 3])], "a.pdf", { type: "application/pdf" });
const rect = (id: string) =>
  ({ id, type: "rectangle", pageIndex: 0, x: 1, y: 2, width: 3, height: 4 }) as const;

beforeEach(() => {
  useEditorStore.getState().setFile(pdf());
  useEditorStore.getState().setNumPages(2);
});

test("a freshly opened document is clean", () => {
  expect(isDocumentDirty()).toBe(false);
  expect(isDocumentDirty({ file: null, revision: 5, savedRevision: 0 })).toBe(false);
});

test("every history-recorded mutation marks the document dirty", () => {
  const s = useEditorStore.getState();
  s.addEdit(rect("r1"));
  expect(isDocumentDirty()).toBe(true);
  s.markSaved();
  expect(isDocumentDirty()).toBe(false);

  s.setPageOp(0, { rotation: 90 });
  expect(isDocumentDirty()).toBe(true);
  s.markSaved();
  s.setPageOrder([1, 0]);
  expect(isDocumentDirty()).toBe(true);
  s.markSaved();
  s.deletePage(1);
  expect(isDocumentDirty()).toBe(true);
  s.markSaved();
  s.deleteEdit("r1");
  expect(isDocumentDirty()).toBe(true);
});

test("coalesced updateEdit bursts still bump the revision", () => {
  const s = useEditorStore.getState();
  const edit = makeTextEdit({ pageIndex: 0, x: 0, y: 0, width: 50, height: 20 });
  s.addEdit(edit);
  s.markSaved();
  s.updateEdit(edit.id, { x: 1 });
  const afterFirst = useEditorStore.getState().revision;
  s.updateEdit(edit.id, { x: 2 }); // coalesced into the same history burst
  expect(useEditorStore.getState().revision).toBeGreaterThan(afterFirst);
  expect(isDocumentDirty()).toBe(true);
});

test("undo and redo count as changes since the last save", () => {
  const s = useEditorStore.getState();
  s.addEdit(rect("r1"));
  s.markSaved();
  s.undo();
  expect(isDocumentDirty()).toBe(true);
  s.markSaved();
  s.redo();
  expect(isDocumentDirty()).toBe(true);
});

test("markSaved(revision) leaves later changes dirty", () => {
  const s = useEditorStore.getState();
  s.addEdit(rect("r1"));
  const rev = useEditorStore.getState().revision;
  s.addEdit(rect("r2")); // edit made while an export was running
  s.markSaved(rev);
  expect(isDocumentDirty()).toBe(true);
});

test("setFile resets the revision counters", () => {
  useEditorStore.getState().addEdit(rect("r1"));
  useEditorStore.getState().setFile(pdf());
  const { revision, savedRevision } = useEditorStore.getState();
  expect(revision).toBe(0);
  expect(savedRevision).toBe(0);
  expect(isDocumentDirty()).toBe(false);
});

test("snapshot round-trips through restoreDocumentSnapshot", () => {
  const s = useEditorStore.getState();
  s.addEdit(rect("r1"));
  s.setPageOp(1, { rotation: 180 });
  s.setPageOrder([1, 0]);
  const snap = getDocumentSnapshot();
  expect(snap.edits).toHaveLength(1);

  // Diverge, then restore.
  s.addEdit(rect("r2"));
  s.deletePage(0);
  const pastLength = useEditorStore.getState()._past.length;
  s.selectEdit("r2");
  restoreDocumentSnapshot(snap);

  const after = useEditorStore.getState();
  expect(after.edits.map((e) => e.id)).toEqual(["r1"]);
  expect(after.pageOps).toEqual(snap.pageOps);
  expect(after.pageOrder).toEqual([1, 0]);
  expect(after.file).toBe(snap.file);
  expect(after.numPages).toBe(snap.numPages);
  expect(after.selectedEditId).toBeNull();
  // No history entry added, and the restored document counts as changed.
  expect(after._past).toHaveLength(pastLength);
  expect(isDocumentDirty()).toBe(true);
});

test("getDocumentSnapshot deep-clones so later edits don't mutate it", () => {
  const s = useEditorStore.getState();
  s.addEdit(rect("r1"));
  const snap = getDocumentSnapshot();
  s.updateEdit("r1", { x: 999 });
  expect(snap.edits[0].x).toBe(1);
});

test("restoring a snapshot taken before the outline loaded keeps the file's outline", () => {
  const loaded = [{ id: "b1", title: "Intro", pageIndex: 0, children: [] }];
  useEditorStore.setState({ outlineStatus: "pending", bookmarks: [] });
  const snap = getDocumentSnapshot();
  expect(snap.outlineStatus).toBe("pending");

  // The viewer reads the file's outline after the snapshot was taken.
  useEditorStore.setState({ outlineStatus: "ready", bookmarks: loaded });
  restoreDocumentSnapshot(snap);

  const after = useEditorStore.getState();
  expect(after.bookmarks).toEqual(loaded);
  expect(after.outlineStatus).toBe("ready");
});

test("restoring a snapshot with read bookmarks applies them and marks the outline ready", () => {
  const edited = [{ id: "b2", title: "Renamed", pageIndex: 1, children: [] }];
  useEditorStore.setState({ outlineStatus: "ready", bookmarks: edited });
  const snap = getDocumentSnapshot();

  useEditorStore.setState({ outlineStatus: "pending", bookmarks: [] });
  restoreDocumentSnapshot(snap);

  const after = useEditorStore.getState();
  expect(after.bookmarks).toEqual(edited);
  expect(after.outlineStatus).toBe("ready");
});
