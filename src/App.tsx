import { useEffect } from "react";
import { Toolbar } from "./components/Toolbar";
import { PdfViewer } from "./components/PdfViewer";
import { useEditorStore } from "./store/useEditorStore";

export default function App() {
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
    <main className="app">
      <Toolbar />
      <PdfViewer />
    </main>
  );
}
