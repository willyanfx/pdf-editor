import { useState } from "react";
import {
  FilePlus2,
  Download,
  Loader2,
  Check,
  ChevronLeft,
  ChevronRight,
  Minimize2,
  Undo2,
  Redo2,
  Moon,
  Sun,
} from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useViewerStore } from "../store/useViewerStore";
import { buildPageRows, stepPage, visiblePages } from "../lib/pageLayout";
import { useEditorActions } from "../hooks/useEditorActions";

type DownloadState = "idle" | "exporting" | "done";

export function TopBar() {
  const file = useEditorStore((s) => s.file);
  const numPages = useEditorStore((s) => s.numPages);
  const selectedPageIndex = useEditorStore((s) => s.selectedPageIndex);
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const pageLayout = useViewerStore((s) => s.pageLayout);
  const coverPage = useViewerStore((s) => s.coverPage);
  const theme = useViewerStore((s) => s.theme);
  const toggleTheme = useViewerStore((s) => s.toggleTheme);
  const setSelectedPageIndex = useEditorStore((s) => s.setSelectedPageIndex);
  // Routes through the virtualizer in PdfViewer: a target page may not be mounted,
  // so a DOM scrollIntoView can't reach it.
  const scrollToPage = useEditorStore((s) => s.scrollToPage);
  const { pickPdf, downloadPdf, openCompressDialog } = useEditorActions();
  const canUndo = useEditorStore((s) => s._past.length > 0);
  const canRedo = useEditorStore((s) => s._future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  // Draft text for the page-jump input; null means "mirror the live page".
  const [pageDraft, setPageDraft] = useState<string | null>(null);

  function goToPage(index: number) {
    if (index < 0 || index >= numPages) return;
    setSelectedPageIndex(index);
    scrollToPage?.(index);
  }

  /** The page the previous/next controls lead to: a row away, skipping pages the
   * organizer removed (two-page view moves two pages at a time). */
  function adjacentPage(direction: 1 | -1): number | null {
    const rows = buildPageRows(visiblePages(numPages, pageOrder), pageLayout, coverPage);
    return stepPage(rows, selectedPageIndex, direction);
  }

  function stepToPage(direction: 1 | -1) {
    const target = adjacentPage(direction);
    if (target !== null) goToPage(target);
  }

  function commitPageDraft() {
    if (pageDraft === null) return;
    const n = parseInt(pageDraft, 10);
    if (!Number.isNaN(n)) goToPage(Math.min(Math.max(n, 1), numPages) - 1);
    setPageDraft(null); // snap back to mirroring the live page
  }

  function onDownload() {
    void downloadPdf({
      onStart: () => setDownloadState("exporting"),
      onSuccess: () => {
        setDownloadState("done");
        setTimeout(() => setDownloadState("idle"), 1500);
      },
      onError: () => setDownloadState("idle"),
    });
  }

  function onCompress() {
    openCompressDialog();
  }

  return (
    <header className="topbar">
      <span className="topbar-app-name">PDF Editor</span>

      {file && (
        <>
          <span className="topbar-divider" />
          <span className="topbar-file-name" title={file.name}>
            {file.name}
          </span>
        </>
      )}

      <span className="topbar-spacer" />

      <button
        type="button"
        className="topbar-btn"
        title="Undo (⌘Z)"
        aria-label="Undo"
        disabled={!file || !canUndo}
        onClick={undo}
      >
        <Undo2 size={15} />
        <span>Undo</span>
      </button>
      <button
        type="button"
        className="topbar-btn"
        title="Redo (⌘⇧Z)"
        aria-label="Redo"
        disabled={!file || !canRedo}
        onClick={redo}
      >
        <Redo2 size={15} />
        <span>Redo</span>
      </button>

      {file && numPages > 0 && (
        <div className="topbar-pages">
          <button
            type="button"
            className="topbar-page-nav"
            aria-label="Previous page"
            disabled={adjacentPage(-1) === null}
            onClick={() => stepToPage(-1)}
          >
            <ChevronLeft size={15} />
          </button>
          <form
            className="topbar-page-info"
            onSubmit={(e) => {
              e.preventDefault();
              commitPageDraft();
              (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.blur();
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              className="topbar-page-input"
              aria-label="Page number"
              value={pageDraft ?? String(selectedPageIndex + 1)}
              onChange={(e) => setPageDraft(e.target.value.replace(/[^0-9]/g, ""))}
              onFocus={(e) => e.target.select()}
              onBlur={commitPageDraft}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  stepToPage(-1);
                  setPageDraft(null);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  stepToPage(1);
                  setPageDraft(null);
                } else if (e.key === "Escape") {
                  setPageDraft(null);
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <span className="topbar-page-total"> / {numPages}</span>
          </form>
          <button
            type="button"
            className="topbar-page-nav"
            aria-label="Next page"
            disabled={adjacentPage(1) === null}
            onClick={() => stepToPage(1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      <button type="button" className="topbar-btn" title="Open PDF" onClick={pickPdf}>
        <FilePlus2 size={15} />
        <span>Open</span>
      </button>

      <button
        type="button"
        className="topbar-btn"
        title="Compress and download (smaller file)"
        disabled={!file}
        onClick={onCompress}
      >
        <Minimize2 size={15} />
        <span>Compress</span>
      </button>

      <button
        type="button"
        className="topbar-btn topbar-download"
        data-state={downloadState}
        title="Download edited PDF"
        disabled={!file || downloadState === "exporting"}
        onClick={onDownload}
      >
        {downloadState === "idle" && (
          <>
            <Download size={15} className="dl-icon" />
            <span>Download</span>
          </>
        )}
        {downloadState === "exporting" && (
          <>
            <Loader2 size={15} className="dl-icon dl-spin" />
            <span>Exporting…</span>
          </>
        )}
        {downloadState === "done" && (
          <>
            <Check size={15} className="dl-icon dl-pop" />
            <span>Done</span>
          </>
        )}
      </button>

      <button
        type="button"
        className="topbar-btn topbar-icon-btn"
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        aria-label="Dark theme"
        aria-pressed={theme === "dark"}
        onClick={toggleTheme}
      >
        {theme === "dark" ? (
          <Sun size={15} aria-hidden="true" />
        ) : (
          <Moon size={15} aria-hidden="true" />
        )}
      </button>
    </header>
  );
}
