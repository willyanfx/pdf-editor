import { useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { ToolRail } from "./components/ToolRail";
import { PdfViewer } from "./components/PdfViewer";
import { BottomBar } from "./components/BottomBar";
import { Toaster } from "./components/Toaster";
import { CommandPalette } from "./components/CommandPalette";
import { SignatureModal } from "./components/SignatureModal";
import { SplitDialog } from "./components/SplitDialog";
import { CompareDialog } from "./components/CompareDialog";
import { MetadataModal } from "./components/MetadataModal";
import { UrlDialog } from "./components/UrlDialog";
import { CompressDialog } from "./components/CompressDialog";
import { PageStampsDialogs } from "./components/PageStampsDialogs";
import { PasswordModal } from "./components/PasswordModal";
import { ExtractPagesDialog, ReplacePagesDialog } from "./components/PageSelectionDialogs";
import { FindBar } from "./components/FindBar";
import { RecoveryBanner } from "./components/RecoveryBanner";
import { isDocumentDirty, useEditorStore } from "./store/useEditorStore";
import { RedactSearchDialog } from "./components/RedactSearchDialog";
import { RedactConfirmDialog } from "./components/RedactConfirmDialog";
import { openFiles } from "./lib/openFiles";
import { checkForRecovery, startAutosave } from "./lib/autosave";
import { addBookmarkForCurrentPage } from "./lib/bookmarkActions";
import { useBookmarksUiStore } from "./store/useBookmarksUiStore";

export default function App() {
  // Whole-window drag-and-drop: drop a PDF anytime to open/replace it, or drop
  // an image onto an open PDF to add it. A depth counter keeps the overlay from
  // flickering as the cursor crosses nested child elements.
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);

  function hasFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  // Global keyboard handling: ⌘K palette, tool shortcuts, and the Adobe-style
  // nudge/delete for the selected edit.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          // Form dropdowns/list boxes use type-ahead and arrow keys.
          target.tagName === "SELECT" ||
          target.isContentEditable);

      // ⌘K / Ctrl+K opens the command palette from anywhere (even while typing).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      // Undo / Redo — only when NOT in a text field; let the browser's native
      // undo/redo win inside contentEditable and input elements.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
        if (typing) return; // native browser undo/redo handles contentEditable and inputs
        e.preventDefault();
        if (e.shiftKey) {
          useEditorStore.getState().redo();
        } else {
          useEditorStore.getState().undo();
        }
        return;
      }
      // Ctrl+Y as alternate redo (Windows convention).
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "y") {
        if (typing) return;
        e.preventDefault();
        useEditorStore.getState().redo();
        return;
      }

      // The remaining shortcuts must not hijack keystrokes inside text fields
      // (the page-jump input, find box, comment textareas, rich-text editor).
      if (typing) return;

      // ⌘F / Ctrl+F toggles find-in-page (only with a doc open). Close the
      // palette first so its focus trap doesn't swallow keys meant for FindBar.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        if (useEditorStore.getState().file) {
          e.preventDefault();
          setPaletteOpen(false);
          setFindOpen((v) => !v);
          return;
        }
      }

      // ⌘B / Ctrl+B bookmarks the current page (inside text fields it stays bold).
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        if (useEditorStore.getState().file) {
          e.preventDefault();
          addBookmarkForCurrentPage();
          return;
        }
      }

      // ⌘/Ctrl + +/-/0 zoom (the browser-PDF-viewer convention). These clear any
      // active fit preset via the store's manual zoom actions.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && useEditorStore.getState().file) {
        const store = useEditorStore.getState();
        // "=" is the unshifted "+" key; accept both, plus the numpad variants.
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          store.zoomIn();
          return;
        }
        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          store.zoomOut();
          return;
        }
        if (e.key === "0") {
          e.preventDefault();
          store.resetZoom();
          return;
        }
      }

      const store = useEditorStore.getState();

      // Single-key tool shortcuts (only when a file is open and not typing).
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && store.file) {
        const k = e.key.toLowerCase();
        if (k === "v") {
          e.preventDefault();
          store.setMode("select");
          return;
        }
        if (k === "e") {
          e.preventDefault();
          store.setMode("editText");
          return;
        }
        if (k === "t") {
          e.preventDefault();
          store.setMode("addText");
          return;
        }
        if (k === "h") {
          e.preventDefault();
          store.setMode("highlight");
          return;
        }
        if (k === "u") {
          e.preventDefault();
          store.setMode("underline");
          return;
        }
        if (k === "c") {
          e.preventDefault();
          store.setMode("comment");
          return;
        }
        if (k === "d") {
          e.preventDefault();
          store.setMode("ink");
          return;
        }
        if (k === "r") {
          e.preventDefault();
          store.setMode("redact");
          return;
        }
        if (k === "w") {
          e.preventDefault();
          store.setZoomPreset("fit-width");
          return;
        }
        if (k === "p") {
          e.preventDefault();
          store.setZoomPreset("fit-page");
          return;
        }
      }

      // Nudge / delete the selected edit.
      const { selectedEditId, edits, updateEdit, deleteEdit } = store;
      if (!selectedEditId) return;
      const edit = edits.find((ed) => ed.id === selectedEditId);
      if (!edit) return;

      if (!typing && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        deleteEdit(selectedEditId);
        return;
      }

      if (typing) return; // don't hijack arrows while editing text

      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") updateEdit(selectedEditId, { x: edit.x - step });
      else if (e.key === "ArrowRight") updateEdit(selectedEditId, { x: edit.x + step });
      else if (e.key === "ArrowUp") updateEdit(selectedEditId, { y: edit.y - step });
      else if (e.key === "ArrowDown") updateEdit(selectedEditId, { y: edit.y + step });
      else return;
      e.preventDefault();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Autosave to IndexedDB while the document is dirty, and offer to recover last
  // session's unsaved work if the tab was closed or crashed.
  useEffect(() => {
    void checkForRecovery();
    return startAutosave();
  }, []);

  // Bookmark actions (⌘B, the command palette) ask for the sidebar to open.
  useEffect(
    () =>
      useBookmarksUiStore.subscribe((s, prev) => {
        if (s.openRequest !== prev.openRequest) setPagesOpen(true);
      }),
    [],
  );

  // Warn before leaving if the open document has changed since it was opened or
  // last downloaded (autosave is a safety net, not a substitute for exporting).
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (isDocumentDirty()) {
        e.preventDefault();
        // Legacy requirement for some browsers to show the prompt.
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <main
      className="app"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setIsDragging(false);
        openFiles(e.dataTransfer.files);
      }}
    >
      <TopBar />
      <ToolRail
        onOpenPalette={() => setPaletteOpen(true)}
        onTogglePages={() => setPagesOpen((v) => !v)}
        pagesActive={pagesOpen}
      />
      <PdfViewer pagePanelOpen={pagesOpen} />
      <BottomBar />

      <Toaster />
      <SignatureModal />
      <SplitDialog />
      <CompareDialog />
      <MetadataModal />
      <UrlDialog />
      <CompressDialog />
      <PageStampsDialogs />
      <PasswordModal />
      <RecoveryBanner />
      <ExtractPagesDialog />
      <ReplacePagesDialog />
      <RedactSearchDialog />
      <RedactConfirmDialog />

      {findOpen && <FindBar onClose={() => setFindOpen(false)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            Drop PDF, Word, Excel, HTML, image, or HEIC to open · drop image to add
          </div>
        </div>
      )}
    </main>
  );
}
