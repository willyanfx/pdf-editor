import { useEffect, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { PdfViewer } from "./components/PdfViewer";
import { useEditorStore } from "./store/useEditorStore";
import { openFiles } from "./lib/openFiles";

export default function App() {
  // Whole-window drag-and-drop: drop a PDF anytime to open/replace it, or drop
  // an image onto an open PDF to add it. A depth counter keeps the overlay from
  // flickering as the cursor crosses nested child elements.
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const errorMessage = useEditorStore((s) => s.errorMessage);
  const setErrorMessage = useEditorStore((s) => s.setErrorMessage);

  function hasFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  // Keyboard nudge & delete for the selected edit (Adobe-style).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const { selectedEditId, edits, updateEdit, deleteEdit } = useEditorStore.getState();
      if (!selectedEditId) return;

      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);

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
      <Toolbar />
      <PdfViewer />
      {errorMessage && (
        <div className="error-toast" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage(null)}>
            Dismiss
          </button>
        </div>
      )}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">Drop PDF to open · drop image to add</div>
        </div>
      )}
    </main>
  );
}
