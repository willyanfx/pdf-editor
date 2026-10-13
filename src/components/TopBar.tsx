import { useState } from "react";
import {
  FileText,
  FolderOpen,
  Download,
  Loader2,
  Check,
  Minimize2,
  Lock,
  Undo2,
  Redo2,
  Moon,
  Sun,
  Search,
  TextSearch,
} from "lucide-react";
import { isDocumentDirty, useEditorStore } from "../store/useEditorStore";
import { useViewerStore } from "../store/useViewerStore";
import { useEditorActions } from "../hooks/useEditorActions";

type DownloadState = "idle" | "exporting" | "done";

type Props = {
  onOpenPalette: () => void;
  onFind: () => void;
};

/** "⌘" on Apple platforms, "Ctrl+" elsewhere — for visible shortcut hints. */
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function TopBar({ onOpenPalette, onFind }: Props) {
  const file = useEditorStore((s) => s.file);
  const dirty = useEditorStore((s) => isDocumentDirty(s));
  const theme = useViewerStore((s) => s.theme);
  const toggleTheme = useViewerStore((s) => s.toggleTheme);
  const { pickPdf, downloadPdf, openCompressDialog, openProtectDialog } = useEditorActions();
  const canUndo = useEditorStore((s) => s._past.length > 0);
  const canRedo = useEditorStore((s) => s._future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const [downloadState, setDownloadState] = useState<DownloadState>("idle");

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
      <div className="topbar-start">
        <div className="topbar-brand">
          <span className="topbar-logo" aria-hidden="true">
            <span>
              <FileText size={17} strokeWidth={2.2} />
            </span>
          </span>
          <span className="topbar-app-name">PDF Editor</span>
        </div>

        {file && (
          <>
            <span className="topbar-divider" aria-hidden="true" />
            <div className="topbar-file">
              <span className="topbar-file-name" title={file.name}>
                {file.name}
              </span>
              {dirty && (
                <span className="topbar-status" title="Changes not yet downloaded">
                  Edited
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        className="topbar-search"
        aria-label="Search tools and commands"
        title={`Search tools and commands (${MOD}K)`}
        onClick={onOpenPalette}
      >
        <Search size={15} aria-hidden="true" />
        <span className="topbar-search-label">Search tools &amp; commands</span>
        <kbd>{MOD}K</kbd>
      </button>

      <div className="topbar-end">
        <div className="topbar-group">
          <button
            type="button"
            className="topbar-btn topbar-icon-btn"
            title={`Undo (${MOD}Z)`}
            aria-label="Undo"
            disabled={!file || !canUndo}
            onClick={undo}
          >
            <Undo2 size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="topbar-btn topbar-icon-btn"
            title={`Redo (${MOD}⇧Z)`}
            aria-label="Redo"
            disabled={!file || !canRedo}
            onClick={redo}
          >
            <Redo2 size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="topbar-btn topbar-icon-btn"
            title={`Find in document (${MOD}F)`}
            aria-label="Find in document"
            disabled={!file}
            onClick={onFind}
          >
            <TextSearch size={17} aria-hidden="true" />
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
              <Sun size={17} aria-hidden="true" />
            ) : (
              <Moon size={17} aria-hidden="true" />
            )}
          </button>
        </div>

        <span className="topbar-divider" aria-hidden="true" />

        <button
          type="button"
          className="topbar-btn is-collapsible"
          title="Open a PDF"
          aria-label="Open"
          onClick={pickPdf}
        >
          <FolderOpen size={16} aria-hidden="true" />
          <span>Open</span>
        </button>
        <button
          type="button"
          className="topbar-btn is-collapsible"
          title="Compress and download (smaller file)"
          aria-label="Compress"
          disabled={!file}
          onClick={openCompressDialog}
        >
          <Minimize2 size={16} aria-hidden="true" />
          <span>Compress</span>
        </button>
        <button
          type="button"
          className="topbar-btn is-collapsible"
          title="Protect with a password and permissions"
          aria-label="Protect"
          disabled={!file}
          onClick={openProtectDialog}
        >
          <Lock size={16} aria-hidden="true" />
          <span>Protect</span>
        </button>

        <button
          type="button"
          className="topbar-btn topbar-download is-primary"
          data-state={downloadState}
          title="Download edited PDF"
          disabled={!file || downloadState === "exporting"}
          onClick={onDownload}
        >
          {downloadState === "idle" && (
            <>
              <Download size={16} className="dl-icon" aria-hidden="true" />
              <span>Download</span>
            </>
          )}
          {downloadState === "exporting" && (
            <>
              <Loader2 size={16} className="dl-icon dl-spin" aria-hidden="true" />
              <span>Exporting…</span>
            </>
          )}
          {downloadState === "done" && (
            <>
              <Check size={16} className="dl-icon dl-pop" aria-hidden="true" />
              <span>Saved</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}
