import { useState } from "react";
import { FilePlus2, Download, Loader2, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";

type DownloadState = "idle" | "exporting" | "done";

export function TopBar() {
  const file = useEditorStore((s) => s.file);
  const numPages = useEditorStore((s) => s.numPages);
  const selectedPageIndex = useEditorStore((s) => s.selectedPageIndex);
  const setSelectedPageIndex = useEditorStore((s) => s.setSelectedPageIndex);
  // Routes through the virtualizer in PdfViewer: a target page may not be mounted,
  // so a DOM scrollIntoView can't reach it.
  const scrollToPage = useEditorStore((s) => s.scrollToPage);
  const { pickPdf, downloadPdf } = useEditorActions();

  const [downloadState, setDownloadState] = useState<DownloadState>("idle");

  function goToPage(index: number) {
    if (index < 0 || index >= numPages) return;
    setSelectedPageIndex(index);
    scrollToPage?.(index);
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

      {file && numPages > 0 && (
        <div className="topbar-pages">
          <button
            type="button"
            className="topbar-page-nav"
            aria-label="Previous page"
            disabled={selectedPageIndex <= 0}
            onClick={() => goToPage(selectedPageIndex - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="topbar-page-info">
            {selectedPageIndex + 1} / {numPages}
          </span>
          <button
            type="button"
            className="topbar-page-nav"
            aria-label="Next page"
            disabled={selectedPageIndex >= numPages - 1}
            onClick={() => goToPage(selectedPageIndex + 1)}
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
    </header>
  );
}
