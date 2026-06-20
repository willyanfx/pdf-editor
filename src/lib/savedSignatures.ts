/**
 * Persist a small library of signature images (transparent PNG data URLs) in
 * localStorage so a repeat signer can re-insert a previous signature instead of
 * re-drawing it each time. Capped at MAX_SAVED most-recent entries; writes that
 * exceed the storage quota are dropped silently (returns false) rather than
 * throwing, so signing still works when storage is full or unavailable.
 */

const STORAGE_KEY = "pdf-editor:saved-signatures";
export const MAX_SAVED = 10;

export type SavedSignature = {
  id: string;
  /** Transparent PNG data URL. */
  dataUrl: string;
};

/** Read the saved signatures, newest first. Returns [] on any parse/access error. */
export function loadSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SavedSignature => s && typeof s.id === "string" && typeof s.dataUrl === "string",
    );
  } catch {
    return [];
  }
}

/** Persist the given list (already ordered newest-first). False if the write failed. */
function persist(list: SavedSignature[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a signature data URL to the front of the library, capped at MAX_SAVED.
 * Exact-duplicate data URLs are moved to the front rather than duplicated.
 * Returns the updated list (unchanged if the write hit the quota).
 */
export function addSignature(dataUrl: string): SavedSignature[] {
  const current = loadSignatures().filter((s) => s.dataUrl !== dataUrl);
  const entry: SavedSignature = { id: crypto.randomUUID(), dataUrl };
  const next = [entry, ...current].slice(0, MAX_SAVED);
  return persist(next) ? next : loadSignatures();
}

/** Remove one signature by id. Returns the updated list. */
export function removeSignature(id: string): SavedSignature[] {
  const next = loadSignatures().filter((s) => s.id !== id);
  persist(next);
  return next;
}
