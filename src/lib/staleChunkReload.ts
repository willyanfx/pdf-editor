// GitHub Pages replaces the whole artifact on every deploy, so the hashed lazy
// chunks (`dispatch-*.js`, `vlmOcr-*.js`, …) of the previous build 404. A tab
// still running the old `index-*.js` then fails its next dynamic import. Vite
// fires `vite:preloadError` for that; reloading once fetches the fresh
// `index.html` and chunk names.

const RELOAD_FLAG = "pdf-editor:stale-chunk-reload";
// A second failure inside this window means the reload didn't help (genuinely
// missing asset / offline) — surface the error instead of looping.
const RELOAD_WINDOW_MS = 10_000;

export interface StaleChunkDeps {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  reload: () => void;
  now: () => number;
}

/** Returns true when a reload was triggered (caller should preventDefault). */
export function handleStaleChunk(deps: StaleChunkDeps): boolean {
  const { storage, reload, now } = deps;
  try {
    const last = Number(storage?.getItem(RELOAD_FLAG) ?? 0);
    if (last && now() - last < RELOAD_WINDOW_MS) return false;
    storage?.setItem(RELOAD_FLAG, String(now()));
  } catch {
    // Storage blocked: reload at most once is unenforceable, so don't risk a loop.
    return false;
  }
  reload();
  return true;
}

export function installStaleChunkReload(): void {
  window.addEventListener("vite:preloadError", (event) => {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    const reloaded = handleStaleChunk({
      storage,
      reload: () => window.location.reload(),
      now: () => Date.now(),
    });
    if (reloaded) event.preventDefault();
  });
}
