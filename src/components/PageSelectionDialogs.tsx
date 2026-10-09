import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { usePageSelectionStore } from "../store/usePageSelectionStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { formatPageRanges, parsePageList } from "../lib/pageRemap";

/** Visible page numbers of the selected (or current) pages, for copy. */
function useTargetPages() {
  // Subscribe so the copy follows selection/order changes; the list itself comes
  // from the action layer so dialogs and actions agree on what's targeted.
  useEditorStore((s) => s.pageOrder);
  usePageSelectionStore((s) => s.selected);
  const actions = useEditorActions();
  const pages = actions.targetPages();
  const { pageOrder } = useEditorStore.getState();
  const numbers = pages.map((p) => pageOrder.indexOf(p) + 1);
  // "1-3,5" → "1–3, 5" for reading.
  const label = formatPageRanges(numbers).replace(/,/g, ", ").replace(/-/g, "–");
  return { actions, pages, numbers, label, all: pages.length >= pageOrder.length };
}

/** Download the selected pages as a new PDF, optionally removing them after. */
export function ExtractPagesDialog() {
  const open = usePageSelectionStore((s) => s.extractDialogOpen);
  const file = useEditorStore((s) => s.file);
  const { actions, pages, numbers, label, all } = useTargetPages();
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [busy, setBusy] = useState(false);

  const onClose = () => {
    setDeleteAfter(false);
    usePageSelectionStore.getState().setExtractDialogOpen(false);
  };
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);

  if (!open || !file || !pages.length) return null;
  const one = pages.length === 1;
  const filename = `${file.name.replace(/\.pdf$/i, "")}-pages-${formatPageRanges(numbers)}.pdf`;

  const submit = async () => {
    setBusy(true);
    try {
      await actions.extractSelectedPages(deleteAfter && !all);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="extract-pages-title"
      >
        <div className="sig-header">
          <span id="extract-pages-title">Extract {one ? "page" : "pages"}</span>
          <button type="button" className="sig-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="split-hint">
          Save {one ? "page" : "pages"} {label} as a new PDF, including your edits. It downloads as{" "}
          <code>{filename}</code>.
        </p>
        <label className="page-sel-check">
          <input
            type="checkbox"
            checked={deleteAfter && !all}
            disabled={all || busy}
            onChange={(e) => setDeleteAfter(e.target.checked)}
          />
          <span>
            Then delete {one ? "it" : "them"} from this document
            {all && <span className="page-sel-note"> (not possible — that's every page)</span>}
          </span>
        </label>
        <div className="sig-actions">
          <button type="button" className="sig-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sig-insert"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Extracting…" : "Extract"}
          </button>
        </div>
      </div>
    </>
  );
}

/** Swap the selected pages for pages picked from another PDF. */
export function ReplacePagesDialog() {
  const open = usePageSelectionStore((s) => s.replaceDialogOpen);
  const file = useEditorStore((s) => s.file);
  const { actions, pages, label } = useTargetPages();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState<{ file: File; count: number } | null>(null);
  const [spec, setSpec] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onClose = () => {
    setSource(null);
    setSpec("");
    setLoadError(null);
    usePageSelectionStore.getState().setReplaceDialogOpen(false);
  };
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);

  if (!open || !file || !pages.length) return null;
  const k = pages.length;
  const one = k === 1;
  const parsed = source ? parsePageList(spec, source.count) : null;
  const m = parsed?.pages?.length ?? 0;

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    setBusy(true);
    setLoadError(null);
    try {
      const { loadPdf } = await import("../lib/pageOrganize");
      const count = (await loadPdf(picked)).getPageCount();
      const n = Math.min(k, count);
      setSource({ file: picked, count });
      setSpec(n === 1 ? "1" : `1-${n}`);
    } catch {
      setLoadError("Couldn't read that PDF. It may be damaged or password-protected.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!source || !parsed?.pages) return;
    setBusy(true);
    try {
      await actions.replaceSelectedPages(source.file, parsed.pages);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-pages-title"
      >
        <div className="sig-header">
          <span id="replace-pages-title">Replace {one ? "page" : "pages"}</span>
          <button type="button" className="sig-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="split-hint">
          Swap {one ? "page" : "pages"} {label} for pages from another PDF.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div className="page-sel-file">
          <button
            type="button"
            className="sig-cancel"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {source ? "Choose a different PDF…" : "Choose PDF…"}
          </button>
          {source && (
            <span className="page-sel-note">
              {source.file.name} · {source.count} page{source.count === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {loadError && (
          <p className="page-sel-error" role="alert">
            {loadError}
          </p>
        )}

        {source && (
          <>
            <label className="page-sel-field">
              <span>Pages to use from that file</span>
              <input
                className="sig-type-input"
                placeholder="e.g. 1-3, 5"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && parsed?.pages && void submit()}
                aria-invalid={!!parsed?.error}
                aria-describedby="replace-pages-feedback"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </label>
            <p
              id="replace-pages-feedback"
              className={parsed?.error ? "page-sel-error" : "page-sel-note"}
              role={parsed?.error ? "alert" : undefined}
            >
              {parsed?.error ??
                (m === k
                  ? `${m} page${m === 1 ? "" : "s"} in, ${k} out.`
                  : `${k} selected page${one ? "" : "s"} will become ${m}.`)}
            </p>
          </>
        )}

        <p className="page-sel-warn">
          {one ? "The page" : "These pages"} and any edits on {one ? "it" : "them"} will be removed.
          You can undo this.
        </p>

        <div className="sig-actions">
          <button type="button" className="sig-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sig-insert"
            disabled={busy || !parsed?.pages}
            onClick={() => void submit()}
          >
            {busy && source ? "Replacing…" : "Replace"}
          </button>
        </div>
      </div>
    </>
  );
}
