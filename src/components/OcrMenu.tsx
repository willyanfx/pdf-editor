import { useState } from "react";
import { ScanText, ScanLine, ScanSearch, X, Loader2 } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { isWebGpuAvailable } from "../lib/vlmOcr/env";
import { RailButton } from "./RailButton";

/**
 * Single OCR entry point in the tool rail. Clicking the rail button opens a
 * popover that surfaces engine choice (Standard vs AI) and three scope actions
 * (region select, this page, all pages). Live progress is shown inline when
 * ocrBusy is true, replacing the separate full-viewport overlay in PdfViewer.
 */
export function OcrMenu() {
  const [open, setOpen] = useState(false);

  const file = useEditorStore((s) => s.file);
  const mode = useEditorStore((s) => s.mode);
  const ocrEngine = useEditorStore((s) => s.ocrEngine);
  const setOcrEngine = useEditorStore((s) => s.setOcrEngine);
  const ocrBusy = useEditorStore((s) => s.ocrBusy);
  const ocrProgress = useEditorStore((s) => s.ocrProgress);
  const ocrAllProgress = useEditorStore((s) => s.ocrAllProgress);
  const cancelOcrAll = useEditorStore((s) => s.cancelOcrAll);
  const selectedPageIndex = useEditorStore((s) => s.selectedPageIndex);
  const requestOcrPage = useEditorStore((s) => s.requestOcrPage);
  const requestOcrAll = useEditorStore((s) => s.requestOcrAll);
  const setMode = useEditorStore((s) => s.setMode);
  // Model-load progress lives in the global store so both this popover and the
  // live toast can read the same fraction without the popover needing to be open.
  const ocrModelLoad = useEditorStore((s) => s.ocrModelLoad);
  const setOcrModelLoad = useEditorStore((s) => s.setOcrModelLoad);

  const webgpu = isWebGpuAvailable();
  const noFile = !file;

  function closePopover() {
    setOpen(false);
  }

  // Focus trap attaches to the popover div; Escape calls closePopover, Tab
  // cycles among the focusable elements inside. Same usage as SplitDialog.
  const trapRef = useFocusTrap<HTMLDivElement>(open, closePopover);

  async function toggleVlmEngine() {
    if (ocrEngine === "florence2") {
      setOcrEngine("tesseract");
      return;
    }
    if (!webgpu) return;
    // Guard: if a load is already in flight (e.g. keyboard/programmatic call
    // while the pill is disabled), ignore — preloadVlmOcr would race anyway.
    if (ocrModelLoad !== null) return;

    setOcrEngine("florence2");

    const { preloadVlmOcr } = await import("../lib/vlmOcr");
    const { addProgressToast, updateToast, dismissToast, addToast } = useToastStore.getState();

    // Open a sticky progress toast at 0%; it will update live via onProgress.
    const toastId = addProgressToast("Loading AI OCR model (first time ~275 MB)…", "info");

    // Signal the popover bar to appear at 0.
    setOcrModelLoad({ fraction: 0 });

    try {
      await preloadVlmOcr((fraction) => {
        // Both consumers update from the same callback — one set() call each.
        setOcrModelLoad({ fraction });
        updateToast(toastId, {
          progress: fraction,
          message:
            fraction < 1
              ? `Loading AI OCR model… ${Math.round(fraction * 100)}%`
              : "AI OCR model ready",
        });
      });

      // Model is ready. If onProgress never fired (already cached), the fraction
      // stays at 0 — push it to 1 so the bar doesn't flash a stuck state.
      updateToast(toastId, { progress: 1, message: "AI OCR model ready" });

      // Brief display of the "ready" state, then auto-dismiss.
      setTimeout(() => dismissToast(toastId), 1800);

      // Clear the popover bar — no loading in flight any more.
      setOcrModelLoad(null);
    } catch {
      dismissToast(toastId);
      setOcrModelLoad(null);
      addToast("Could not load the AI OCR model; reverting to standard OCR.", "error");
      setOcrEngine("tesseract");
    }
  }

  async function togglePaddleEngine() {
    if (ocrEngine === "paddle") {
      setOcrEngine("tesseract");
      return;
    }
    // A load already in flight (e.g. switching engines mid-download) — ignore.
    if (ocrModelLoad !== null) return;

    setOcrEngine("paddle");

    const { preloadPaddleOcr } = await import("../lib/vlmOcr/paddleOcr");
    const { addProgressToast, updateToast, dismissToast, addToast } = useToastStore.getState();

    // PaddleOCR models are small but loading is not granularly reported, so this
    // is an indeterminate-style toast that fills once on ready.
    const toastId = addProgressToast("Loading PaddleOCR models…", "info");
    setOcrModelLoad({ fraction: 0 });

    try {
      await preloadPaddleOcr((fraction) => {
        setOcrModelLoad({ fraction });
        updateToast(toastId, {
          progress: fraction,
          message: fraction < 1 ? "Loading PaddleOCR models…" : "PaddleOCR ready",
        });
      });
      updateToast(toastId, { progress: 1, message: "PaddleOCR ready" });
      setTimeout(() => dismissToast(toastId), 1800);
      setOcrModelLoad(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[paddleocr] model load failed:", err);
      dismissToast(toastId);
      setOcrModelLoad(null);
      addToast("Could not load PaddleOCR models; reverting to standard OCR.", "error");
      setOcrEngine("tesseract");
    }
  }

  return (
    <div className="ocr-menu-anchor">
      {/* Rail trigger — active while popover is open OR while OCR is running. */}
      <RailButton
        icon={<ScanText size={18} />}
        tip="OCR"
        active={open || ocrBusy || mode === "ocr"}
        toggle
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      />

      {open && (
        <>
          {/* Transparent backdrop so clicking outside closes the popover.
              z-index 90 matches .palette-backdrop; popover is z-index 95. */}
          <div
            className="palette-backdrop"
            style={{ background: "transparent" }}
            onClick={closePopover}
          />

          <div
            ref={trapRef}
            className="ocr-menu-popover"
            role="dialog"
            aria-modal="false"
            aria-label="OCR options"
            // Stop clicks inside from bubbling to the transparent backdrop above.
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ─────────────────────────────── */}
            <div className="sig-header">
              <span>
                <ScanText size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                OCR
              </span>
              <button
                type="button"
                className="sig-close"
                onClick={closePopover}
                aria-label="Close OCR menu"
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Engine section ─────────────────────── */}
            <span className="ocr-menu-label">Engine</span>
            <div className="ocr-engine-pills">
              <button
                type="button"
                className={ocrEngine === "tesseract" ? "ocr-engine-pill active" : "ocr-engine-pill"}
                aria-pressed={ocrEngine === "tesseract"}
                disabled={ocrBusy}
                onClick={() => setOcrEngine("tesseract")}
              >
                Standard
              </button>
              <button
                type="button"
                className={ocrEngine === "florence2" ? "ocr-engine-pill active" : "ocr-engine-pill"}
                aria-pressed={ocrEngine === "florence2"}
                // Disable during load so the user cannot cancel/double-toggle mid-download.
                disabled={!webgpu || ocrBusy || ocrModelLoad !== null}
                aria-disabled={!webgpu || ocrModelLoad !== null || undefined}
                title={!webgpu ? "Requires WebGPU (unavailable in this browser)" : undefined}
                onClick={() => void toggleVlmEngine()}
              >
                {ocrModelLoad !== null && ocrEngine === "florence2" ? (
                  <>
                    <Loader2 size={11} className="ocr-spinner" aria-hidden="true" />
                    {Math.round(ocrModelLoad.fraction * 100)}%
                  </>
                ) : (
                  "AI (Florence-2)"
                )}
              </button>
              <button
                type="button"
                className={ocrEngine === "paddle" ? "ocr-engine-pill active" : "ocr-engine-pill"}
                aria-pressed={ocrEngine === "paddle"}
                // PaddleOCR has a WASM fallback, so it works without WebGPU.
                disabled={ocrBusy || ocrModelLoad !== null}
                aria-disabled={ocrModelLoad !== null || undefined}
                title="PaddleOCR.js — small detection+recognition models (beta)"
                onClick={() => void togglePaddleEngine()}
              >
                {ocrModelLoad !== null && ocrEngine === "paddle" ? (
                  <>
                    <Loader2 size={11} className="ocr-spinner" aria-hidden="true" />
                    Loading…
                  </>
                ) : (
                  "PaddleOCR (beta)"
                )}
              </button>
            </div>

            {/* Model-load progress bar — shown between engine pills and divider
                only while the Florence-2 model is downloading/loading. */}
            {ocrModelLoad !== null && (
              <div className="ocr-model-load">
                <div
                  className="ocr-model-load-bar"
                  style={{ width: `${Math.round(ocrModelLoad.fraction * 100)}%` }}
                  role="progressbar"
                  aria-valuenow={Math.round(ocrModelLoad.fraction * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="AI model download progress"
                />
              </div>
            )}

            {/* Hint shown only when WebGPU is absent so the user knows why AI is grayed. */}
            {!webgpu && (
              <p className="ocr-menu-hint">AI OCR needs WebGPU, unavailable in this browser.</p>
            )}

            <div className="ocr-menu-divider" />

            {/* ── Scope section ──────────────────────── */}
            <span className="ocr-menu-label">Recognize</span>

            {/* Select a region — enters ocr drag mode and closes the popover. */}
            <button
              type="button"
              className="ocr-scope-btn"
              disabled={noFile || ocrBusy}
              onClick={() => {
                setMode("ocr");
                closePopover();
              }}
            >
              <ScanLine size={15} aria-hidden="true" />
              Select a region…
            </button>

            {/* This page — triggers single-page OCR; progress appears below. */}
            <button
              type="button"
              className="ocr-scope-btn"
              disabled={noFile || ocrBusy}
              onClick={() => requestOcrPage(selectedPageIndex)}
            >
              <ScanText size={15} aria-hidden="true" />
              This page
            </button>

            {/* All pages — triggers whole-document OCR; progress + cancel appear below. */}
            <button
              type="button"
              className="ocr-scope-btn"
              disabled={noFile || ocrBusy}
              onClick={() => requestOcrAll()}
            >
              <ScanSearch size={15} aria-hidden="true" />
              All pages
            </button>

            {/* ── Inline progress (shown only while OCR recognition is running) ─ */}
            {ocrBusy && (
              <div className="ocr-menu-progress">
                <Loader2 size={14} className="ocr-spinner" aria-hidden="true" />
                {/* Live region so screen readers announce progress updates. */}
                <span aria-live="polite" aria-atomic="true">
                  {ocrAllProgress !== null
                    ? `Reading page ${ocrAllProgress.current} of ${ocrAllProgress.total}…`
                    : `Reading text… ${Math.round(ocrProgress * 100)}%`}
                </span>
                {/* Cancel is only meaningful for all-pages runs (the loop can be interrupted).
                    Single-page / region OCR is a single async call with no abort path. */}
                {ocrAllProgress !== null && (
                  <button
                    type="button"
                    className="ocr-cancel"
                    aria-label="Cancel OCR"
                    onClick={cancelOcrAll}
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
