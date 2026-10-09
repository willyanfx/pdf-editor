import { create } from "zustand";
import {
  getDocumentSnapshot,
  isDocumentDirty,
  restoreDocumentSnapshot,
  useEditorStore,
  type DocumentSnapshot,
} from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";

/**
 * Autosave + crash recovery. While a document is dirty we keep a single recovery
 * slot in IndexedDB: the source File (stored once, rewritten only when the File
 * identity changes — insert/merge swap it) plus a small meta record holding the
 * undoable snapshot. On the next start the user is offered to restore it.
 *
 * Everything here fails soft: IndexedDB can be missing (private mode, old
 * browsers) or full, and autosave is a convenience, so errors only produce a
 * single console.warn.
 */

/** Debounce after the last change, and the longest a steady stream of changes
 * (e.g. typing) may postpone a save. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;
const AUTOSAVE_MAX_WAIT_MS = 10_000;

const DB_NAME = "pdf-editor-recovery";
const STORE = "slots";
const KEY_FILE = "file";
const KEY_META = "meta";

/** What's stored under KEY_META. `snapshot.file` is nulled — the File lives under
 * its own key so it isn't rewritten on every save. */
type RecoveryMeta = { fileName: string; savedAt: number; snapshot: DocumentSnapshot };

export type RecoveryRecord = RecoveryMeta & { file: File };

// ---------------------------------------------------------------------------
// IndexedDB wrapper (raw, promise-based)
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB open was blocked"));
  });
}

/** Run `work` in one transaction and resolve with each request's result once
 * the transaction has committed. */
async function withStore(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest[],
): Promise<unknown[]> {
  const db = await openDb();
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const requests = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(requests.map((r) => r.result));
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

async function putRecord(file: File | null, meta: RecoveryMeta): Promise<void> {
  // Both keys go in one transaction so a reader never sees a new file with an
  // old snapshot (or vice versa).
  await withStore("readwrite", (store) => {
    const reqs: IDBRequest[] = [];
    if (file) reqs.push(store.put(file, KEY_FILE));
    reqs.push(store.put(meta, KEY_META));
    return reqs;
  });
}

async function readRecord(): Promise<RecoveryRecord | null> {
  const [file, meta] = await withStore("readonly", (store) => [
    store.get(KEY_FILE),
    store.get(KEY_META),
  ]);
  if (!(file instanceof Blob) || !meta || typeof meta !== "object") return null;
  const m = meta as RecoveryMeta;
  // Blobs round-trip as Blob in some engines; normalise back to a File.
  const asFile =
    file instanceof File ? file : new File([file], m.fileName, { type: "application/pdf" });
  return { ...m, file: asFile };
}

async function deleteRecord(): Promise<void> {
  await withStore("readwrite", (store) => [store.clear()]);
}

let warned = false;
function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn("Autosave unavailable; unsaved changes won't survive a crash.", err);
}

// ---------------------------------------------------------------------------
// Autosave scheduling
// ---------------------------------------------------------------------------

/** The File currently stored in IDB, so an unchanged File isn't rewritten. */
let fileInDb: File | null = null;
/** The (file, revision) last written, so a redundant flush is skipped. */
let lastWritten: { file: File; revision: number } | null = null;
/** Bumped by clear/reset so writes queued before it are dropped. */
let generation = 0;
/** Writes are serialised so a delete can't be overtaken by an older save. */
let queue: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | null = null;
let firstPendingAt: number | null = null;
/** True from startup until the user answers the recovery prompt: the slot still
 * holds last session's work, so we must not overwrite or delete it. */
let recoveryPending = false;
let pendingRecord: RecoveryRecord | null = null;
/** Whether the user has been told that autosave is paused behind the prompt. */
let pausedNoticeShown = false;

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  firstPendingAt = null;
}

/** Save the open document now (no-op when clean, already saved, or while the
 * recovery prompt is unanswered). Resolves once the write has settled. */
export function flushAutosave(): Promise<void> {
  clearTimer();
  const state = useEditorStore.getState();
  if (recoveryPending || !isDocumentDirty(state) || !state.file) return queue;
  const file = state.file;
  if (lastWritten && lastWritten.file === file && lastWritten.revision === state.revision) {
    return queue;
  }
  // Capture synchronously: the store keeps moving while the write is queued.
  const snapshot = { ...getDocumentSnapshot(), file: null };
  const revision = state.revision;
  const gen = generation;
  // Recorded up front so a flush that arrives while this write is in flight
  // (timer + pagehide) doesn't queue a duplicate.
  lastWritten = { file, revision };
  queue = queue.then(async () => {
    if (gen !== generation) return;
    try {
      await putRecord(fileInDb === file ? null : file, {
        fileName: file.name,
        savedAt: Date.now(),
        snapshot,
      });
      fileInDb = file;
    } catch (err) {
      // The File may or may not have landed; rewrite it next time.
      fileInDb = null;
      if (gen === generation) lastWritten = null;
      warnOnce(err);
    }
  });
  return queue;
}

function scheduleAutosave(): void {
  const now = Date.now();
  if (firstPendingAt === null) firstPendingAt = now;
  if (timer !== null) clearTimeout(timer);
  const wait = Math.min(
    AUTOSAVE_DEBOUNCE_MS,
    Math.max(0, firstPendingAt + AUTOSAVE_MAX_WAIT_MS - now),
  );
  timer = setTimeout(() => void flushAutosave(), wait);
}

/**
 * Wire autosave to the store and page lifecycle. Call once; returns a cleanup.
 * Saves ~1.5s after the last change and immediately when the tab is hidden or
 * the page is being unloaded.
 */
export function startAutosave(): () => void {
  const unsubscribe = useEditorStore.subscribe((state, prev) => {
    if (state.revision === prev.revision || !isDocumentDirty(state)) return;
    // Saving now would overwrite last session's unanswered work, so autosave
    // waits for the prompt — say so once rather than silently not saving.
    if (recoveryPending && pendingRecord && !pausedNoticeShown) {
      pausedNoticeShown = true;
      useToastStore
        .getState()
        .addToast(
          "Autosave is paused until you recover or discard your earlier unsaved changes.",
          "info",
        );
    }
    scheduleAutosave();
  });
  const onVisibility = () => {
    if (document.visibilityState === "hidden") void flushAutosave();
  };
  const onPageHide = () => void flushAutosave();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    clearTimer();
  };
}

/**
 * Call after the document was successfully downloaded: drop the recovery slot
 * (the work is saved). Leaves the slot alone while last session's recovery
 * prompt is still unanswered — that work isn't what was just downloaded.
 */
export function clearRecoveryAfterSave(): Promise<void> {
  clearTimer();
  generation += 1;
  if (!recoveryPending) {
    fileInDb = null;
    lastWritten = null;
    queue = queue.then(() => deleteRecord().catch(warnOnce));
  }
  // Edits made while the export ran are still unsaved; keep protecting them.
  if (isDocumentDirty()) scheduleAutosave();
  return queue;
}

/** Mark the document saved as of `revision` (a successful download of the edited
 * PDF) and drop the recovery slot. */
export function markDocumentSaved(revision: number): void {
  useEditorStore.getState().markSaved(revision);
  void clearRecoveryAfterSave();
}

// ---------------------------------------------------------------------------
// Recovery prompt
// ---------------------------------------------------------------------------

type RecoveryInfo = { fileName: string; savedAt: number };

/** What the banner renders; null when there's nothing to offer. */
export const useRecoveryStore = create<{ info: RecoveryInfo | null }>(() => ({ info: null }));

/** Look for a recovery slot at startup and, if found, show the prompt. Skipped
 * when the user has already opened a document. */
export async function checkForRecovery(): Promise<void> {
  if (pendingRecord) return;
  // Hold off autosave writes until we know whether the slot has something to protect.
  recoveryPending = true;
  let record: RecoveryRecord | null = null;
  try {
    record = await readRecord();
  } catch (err) {
    warnOnce(err);
  }
  if (!record || useEditorStore.getState().file) {
    recoveryPending = false;
    if (isDocumentDirty()) scheduleAutosave();
    return;
  }
  pendingRecord = record;
  useRecoveryStore.setState({ info: { fileName: record.fileName, savedAt: record.savedAt } });
}

/** Open the stored file the normal way, then re-apply the saved edits once the
 * viewer has loaded it (an encrypted PDF still asks for its password first). */
export function recoverPending(): void {
  const record = pendingRecord;
  if (!record) return;
  pendingRecord = null;
  recoveryPending = false;
  useRecoveryStore.setState({ info: null });

  const { file } = record;
  // The slot already holds exactly this File; don't write it again.
  fileInDb = file;
  lastWritten = null;
  const snapshot: DocumentSnapshot = { ...record.snapshot, file };

  useEditorStore.getState().setFile(file);
  const unsubscribe = useEditorStore.subscribe((state) => {
    // The user opened something else before this finished: give up quietly.
    if (state.file !== file) return unsubscribe();
    if (state.numPages > 0) {
      unsubscribe();
      restoreDocumentSnapshot(snapshot);
      useToastStore.getState().addToast("Recovered your unsaved changes", "success");
    }
  });
}

/** Throw the stored work away. */
export async function discardPending(): Promise<void> {
  if (!pendingRecord) return;
  pendingRecord = null;
  recoveryPending = false;
  useRecoveryStore.setState({ info: null });
  generation += 1;
  fileInDb = null;
  lastWritten = null;
  queue = queue.then(() => deleteRecord().catch(warnOnce));
  await queue;
  // Whatever is open now may have been waiting on this decision to be saved.
  if (isDocumentDirty()) scheduleAutosave();
}

/** Human-friendly age: "a moment ago", "5 minutes ago", "2 hours ago", "3 days ago". */
export function formatRelativeTime(then: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return "a moment ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

/** Exposed for unit tests only. */
export const __testing = {
  readRecord,
  deleteRecord,
  reset(): void {
    clearTimer();
    generation += 1;
    fileInDb = null;
    lastWritten = null;
    queue = Promise.resolve();
    recoveryPending = false;
    pendingRecord = null;
    pausedNoticeShown = false;
    warned = false;
    useRecoveryStore.setState({ info: null });
  },
  /** The File the module believes is stored in the slot. */
  getFileInDb: () => fileInDb,
};
