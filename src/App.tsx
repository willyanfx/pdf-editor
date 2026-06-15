import { useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { ToolRail } from "./components/ToolRail";
import { PdfViewer } from "./components/PdfViewer";
import { BottomBar } from "./components/BottomBar";
import { Toaster } from "./components/Toaster";
import { CommandPalette } from "./components/CommandPalette";
import { SignatureModal } from "./components/SignatureModal";
import { SplitDialog } from "./components/SplitDialog";
import { FindBar } from "./components/FindBar";
import { useEditorStore } from "./store/useEditorStore";
import { useEditorActions } from "./hooks/useEditorActions";
import { openFiles } from "./lib/openFiles";

export default function App() {
  // Whole-window drag-and-drop: drop a PDF anytime to open/replace it, or drop
  // an image onto an open PDF to add it. A depth counter keeps the overlay from
  // flickering as the cursor crosses nested child elements.
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const { addText } = useEditorActions();

  function hasFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  // Global keyboard handling: ⌘K palette, tool shortcuts, and the Adobe-style
  // nudge/delete for the selected edit.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K / Ctrl+K opens the command palette from anywhere.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      // ⌘F / Ctrl+F opens find-in-page (only with a doc open).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        if (useEditorStore.getState().file) {
          e.preventDefault();
          setFindOpen(true);
          return;
        }
      }

      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);

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
          addText();
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
  }, [addText]);

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

      {findOpen && <FindBar onClose={() => setFindOpen(false)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            Drop PDF, Word, Excel, or image to open · drop image to add
          </div>
        </div>
      )}
    </main>
  );
}
