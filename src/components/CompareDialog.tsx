import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronUp, FileText, X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  CompareLoadError,
  compareDocuments,
  comparePage,
  openCompareDoc,
  type CompareDoc,
  type CompareSummary,
  type PageComparison,
  type PageDetail,
  type PageStatus,
} from "../lib/comparePdf";
import { buildDiffOverlay, type RgbaImage } from "../lib/compareDiff";
import type { ScreenRect } from "../lib/pdfGeometry";

type Tab = "side" | "diff" | "text";
type Phase = "setup" | "running" | "done";

const STATUS_LABEL: Record<PageStatus, string> = {
  identical: "Identical",
  changed: "Changed",
  added: "Added",
  removed: "Removed",
};

/** A rendered page bitmap with optional highlight rects (given in the bitmap's
 * own pixel space) layered on top. Sized by percentage so it scales freely. */
function PagePane({
  label,
  image,
  rects,
  rectClass,
  emptyText,
}: {
  label: string;
  image: RgbaImage | null;
  rects?: ScreenRect[];
  rectClass?: string;
  emptyText: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas
      .getContext("2d")
      ?.putImageData(
        new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height),
        0,
        0,
      );
  }, [image]);

  return (
    <figure className="cmp-pane">
      <figcaption>{label}</figcaption>
      {image ? (
        <div className="cmp-page" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
          <canvas ref={canvasRef} aria-label={label} />
          {rects?.map((r, i) => (
            <span
              key={i}
              className={`cmp-rect ${rectClass ?? ""}`}
              style={{
                left: `${(r.x / image.width) * 100}%`,
                top: `${(r.y / image.height) * 100}%`,
                width: `${(r.width / image.width) * 100}%`,
                height: `${(r.height / image.height) * 100}%`,
              }}
            />
          ))}
        </div>
      ) : (
        <div className="cmp-page cmp-page-empty">{emptyText}</div>
      )}
    </figure>
  );
}

function FileSlot({
  role,
  file,
  note,
  onPick,
}: {
  role: "Original" | "Revised";
  file: File | null;
  note?: string;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="cmp-slot">
      <span className="cmp-slot-role">{role}</span>
      <span className="cmp-slot-name" title={file?.name}>
        <FileText size={15} aria-hidden />
        {file ? file.name : "No file chosen"}
      </span>
      {note && <span className="cmp-slot-note">{note}</span>}
      <button type="button" className="sig-cancel" onClick={() => inputRef.current?.click()}>
        {file ? "Change…" : "Choose PDF…"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        aria-label={`${role} PDF`}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function pageChip(p: PageComparison): string {
  if (p.status !== "changed") return STATUS_LABEL[p.status];
  if (p.textChanged && p.visualChanged) return "Text + visual";
  return p.textChanged ? "Text" : "Visual";
}

/**
 * Compare two PDFs: pick an original and a revised file, then browse a
 * page-by-page report of word-level text changes and pixel-level visual changes.
 * Everything runs in the browser; the open document is offered as the original.
 */
export function CompareDialog() {
  const open = useEditorStore((s) => s.compareDialogOpen);
  const onClose = () => useEditorStore.getState().setCompareDialogOpen(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);

  const [original, setOriginal] = useState<File | null>(null);
  const [revised, setRevised] = useState<File | null>(null);
  const [originalIsOpenDoc, setOriginalIsOpenDoc] = useState(false);
  const [phase, setPhase] = useState<Phase>("setup");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CompareSummary | null>(null);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<Tab>("side");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const docs = useRef<{ a: CompareDoc; b: CompareDoc } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const detailCache = useRef(new Map<number, PageDetail>());

  const release = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    docs.current?.a.destroy();
    docs.current?.b.destroy();
    docs.current = null;
    detailCache.current.clear();
  }, []);

  // Each time the dialog opens: start fresh, offering the open document as the original.
  useEffect(() => {
    if (!open) return;
    const openFile = useEditorStore.getState().file;
    setOriginal(openFile);
    setOriginalIsOpenDoc(!!openFile);
    setRevised(null);
    setPhase("setup");
    setError(null);
    setSummary(null);
    setSelected(0);
    setTab("side");
    setOnlyChanged(false);
    setDetail(null);
    return release;
  }, [open, release]);

  const run = async () => {
    if (!original || !revised) return;
    release();
    setError(null);
    setPhase("running");
    setProgress({ done: 0, total: 0 });
    const controller = new AbortController();
    abort.current = controller;
    const openState = useEditorStore.getState();
    const passwordFor = (f: File) =>
      f === openState.file ? (openState.documentPassword ?? undefined) : undefined;
    // This run's documents: tracked locally so a stale run (dialog closed and
    // reopened mid-load) can never destroy or overwrite a newer run's, and a
    // load that succeeds while its sibling fails still gets cleaned up.
    const own: CompareDoc[] = [];
    try {
      const settled = await Promise.allSettled([
        openCompareDoc(original, passwordFor(original)),
        openCompareDoc(revised, passwordFor(revised)),
      ]);
      for (const r of settled) if (r.status === "fulfilled") own.push(r.value);
      const failed = settled.find((r) => r.status === "rejected");
      if (failed) throw failed.reason;
      if (controller.signal.aborted) {
        own.forEach((d) => d.destroy());
        return;
      }
      const [a, b] = own;
      docs.current = { a, b };
      const result = await compareDocuments(
        a,
        b,
        (done, total) => setProgress({ done, total }),
        controller.signal,
      );
      const firstChanged = result.pages.find((p) => p.status !== "identical");
      setSummary(result);
      setSelected(firstChanged?.pageIndex ?? 0);
      setPhase("done");
    } catch (err) {
      const stale = controller.signal.aborted;
      if (!stale) release();
      own.forEach((d) => d.destroy());
      if (stale || (err instanceof DOMException && err.name === "AbortError")) return;
      setError(err instanceof CompareLoadError ? err.message : "Could not compare those PDFs.");
      setPhase("setup");
    }
  };

  // Load the full-detail view (bitmaps + highlights) for the selected page.
  useEffect(() => {
    if (!open || phase !== "done" || !docs.current) return;
    const cached = detailCache.current.get(selected);
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    // Drop the previous page's bitmaps so they aren't shown under this page's header.
    setDetail(null);
    setDetailLoading(true);
    void comparePage(docs.current.a, docs.current.b, selected, true)
      .then((c) => {
        if (cancelled || !c.detail) return;
        // Keep a handful of pages so flipping back and forth is instant.
        if (detailCache.current.size >= 6) {
          detailCache.current.delete(detailCache.current.keys().next().value as number);
        }
        detailCache.current.set(selected, c.detail);
        setDetail(c.detail);
        setDetailLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDetail(null);
        setDetailLoading(false);
        useToastStore.getState().addToast("Could not render that page.", "error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, phase, selected]);

  const changedIndexes = useMemo(
    () => summary?.pages.filter((p) => p.status !== "identical").map((p) => p.pageIndex) ?? [],
    [summary],
  );
  const step = (dir: 1 | -1) => {
    const next =
      dir === 1
        ? changedIndexes.find((i) => i > selected)
        : [...changedIndexes].reverse().find((i) => i < selected);
    if (next !== undefined) setSelected(next);
  };

  const diffOverlay = useMemo<RgbaImage | null>(() => {
    if (!detail) return null;
    const { pixels, revised: rev } = detail;
    const blank: RgbaImage = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    return {
      width: pixels.width,
      height: pixels.height,
      data: buildDiffOverlay(rev ?? blank, pixels),
    };
  }, [detail]);

  if (!open) return null;

  const current = summary?.pages[selected];
  const visiblePages = summary?.pages.filter((p) => !onlyChanged || p.status !== "identical") ?? [];
  const identical = summary && summary.changedPages === 0;

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        className={`compare-dialog${phase === "done" ? "" : " cmp-narrow"}`}
        role="dialog"
        aria-modal="true"
        aria-label="Compare PDFs"
      >
        <div className="sig-header">
          <span>Compare PDFs</span>
          <button type="button" className="sig-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {phase !== "done" && (
          <div className="cmp-setup">
            <p className="split-hint">
              Pick two versions of a document. Pages are compared in order: words that were added or
              removed, and anything that looks different on the page.
            </p>
            <div className="cmp-slots">
              <FileSlot
                role="Original"
                file={original}
                note={
                  originalIsOpenDoc
                    ? "Open document, as loaded (unsaved edits excluded)"
                    : undefined
                }
                onPick={(f) => {
                  setOriginal(f);
                  setOriginalIsOpenDoc(false);
                }}
              />
              <button
                type="button"
                className="cmp-swap"
                aria-label="Swap original and revised"
                title="Swap"
                disabled={phase === "running"}
                onClick={() => {
                  setOriginal(revised);
                  setRevised(original);
                  setOriginalIsOpenDoc(false);
                }}
              >
                <ArrowLeftRight size={15} />
              </button>
              <FileSlot role="Revised" file={revised} onPick={setRevised} />
            </div>
            {error && (
              <p className="cmp-error" role="alert">
                {error}
              </p>
            )}
            {phase === "running" && (
              <div className="cmp-progress" role="status">
                <progress
                  value={progress.done}
                  max={Math.max(progress.total, 1)}
                  aria-label="Comparison progress"
                />
                <span>
                  {progress.total
                    ? `Comparing page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                    : "Reading documents…"}
                </span>
              </div>
            )}
            <div className="sig-actions">
              <button type="button" className="sig-cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="sig-insert"
                disabled={!original || !revised || phase === "running"}
                onClick={() => void run()}
              >
                Compare
              </button>
            </div>
          </div>
        )}

        {phase === "done" && summary && (
          <div className="cmp-results">
            <div className="cmp-summary" role="status">
              <strong>
                {identical
                  ? "No differences found"
                  : `${summary.changedPages} of ${summary.pages.length} page${summary.pages.length === 1 ? "" : "s"} differ`}
              </strong>
              <span>
                {original?.name} → {revised?.name}
              </span>
              {!identical && (
                <span>
                  {summary.textChangedPages} with text changes · {summary.visualChangedPages} with
                  visual changes · <span className="cmp-ins-count">+{summary.addedWords}</span>{" "}
                  <span className="cmp-del-count">−{summary.removedWords}</span> words
                </span>
              )}
              <button
                type="button"
                className="sig-cancel"
                onClick={() => {
                  release();
                  setPhase("setup");
                }}
              >
                New comparison
              </button>
            </div>

            <div className="cmp-body">
              <nav className="cmp-pages" aria-label="Pages">
                <label className="cmp-filter">
                  <input
                    type="checkbox"
                    checked={onlyChanged}
                    onChange={(e) => setOnlyChanged(e.target.checked)}
                  />
                  Only changed pages
                </label>
                <ul>
                  {visiblePages.map((p) => (
                    <li key={p.pageIndex}>
                      <button
                        type="button"
                        className={`cmp-page-item cmp-status-${p.status}${p.pageIndex === selected ? " active" : ""}`}
                        aria-current={p.pageIndex === selected ? "true" : undefined}
                        onClick={() => setSelected(p.pageIndex)}
                      >
                        <span>Page {p.pageIndex + 1}</span>
                        <span className="cmp-chip">{pageChip(p)}</span>
                        {(p.addedWords > 0 || p.removedWords > 0) && (
                          <span className="cmp-words">
                            <span className="cmp-ins-count">+{p.addedWords}</span>{" "}
                            <span className="cmp-del-count">−{p.removedWords}</span>
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                  {visiblePages.length === 0 && <li className="cmp-none">No changed pages</li>}
                </ul>
              </nav>

              <section className="cmp-detail" aria-label={`Page ${selected + 1} comparison`}>
                <div className="cmp-toolbar">
                  <div className="sig-tabs" role="tablist" aria-label="Comparison view">
                    {(
                      [
                        ["side", "Side by side"],
                        ["diff", "Differences"],
                        ["text", "Text"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        className={tab === id ? "active" : ""}
                        onClick={() => setTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="cmp-nav">
                    <span>
                      Page {selected + 1}
                      {current && current.status !== "identical" ? ` · ${pageChip(current)}` : ""}
                      {current?.sizeMismatch ? " · page sizes differ" : ""}
                    </span>
                    <button
                      type="button"
                      className="cmp-step"
                      aria-label="Previous changed page"
                      title="Previous changed page"
                      disabled={!changedIndexes.some((i) => i < selected)}
                      onClick={() => step(-1)}
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="cmp-step"
                      aria-label="Next changed page"
                      title="Next changed page"
                      disabled={!changedIndexes.some((i) => i > selected)}
                      onClick={() => step(1)}
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                </div>

                <div className="cmp-stage" aria-busy={detailLoading}>
                  {!detail ? (
                    <p className="cmp-loading">{detailLoading ? "Rendering page…" : ""}</p>
                  ) : tab === "side" ? (
                    <div className="cmp-pair">
                      <PagePane
                        label="Original — removed text"
                        image={detail.original}
                        rects={detail.text.removedRects}
                        rectClass="cmp-rect-del"
                        emptyText="Page not in original"
                      />
                      <PagePane
                        label="Revised — added text"
                        image={detail.revised}
                        rects={detail.text.addedRects}
                        rectClass="cmp-rect-ins"
                        emptyText="Page not in revised"
                      />
                    </div>
                  ) : tab === "diff" ? (
                    <div className="cmp-single">
                      <PagePane
                        label={`Visual differences — ${detail.pixels.changedPixels.toLocaleString()} px changed (${(detail.pixels.ratio * 100).toFixed(2)}%)`}
                        image={diffOverlay}
                        emptyText="Nothing to compare"
                      />
                    </div>
                  ) : (
                    <div className="cmp-text">
                      <p className="cmp-legend">
                        <span className="cmp-key-del">removed</span>{" "}
                        <span className="cmp-key-ins">added</span>
                      </p>
                      {detail.text.inline.length === 0 ? (
                        <p className="cmp-none">No text on this page in either file.</p>
                      ) : (
                        <p className="cmp-inline">
                          {detail.text.inline.map((w, i) => (
                            <span key={i}>
                              {i > 0 && (w.lineStart ? <br /> : " ")}
                              {w.kind === "delete" ? (
                                <del>{w.text}</del>
                              ) : w.kind === "insert" ? (
                                <ins>{w.text}</ins>
                              ) : (
                                w.text
                              )}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
