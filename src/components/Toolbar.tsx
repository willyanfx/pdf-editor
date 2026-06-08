import { useRef } from "react";
import { FilePlus2, Type, ImagePlus, Square, Download, MousePointer2, Pencil } from "lucide-react";
import { useEditorStore, makeTextEdit } from "../store/useEditorStore";
import { exportEditedPdf } from "../lib/exportPdf";
import { fileToDataUrl } from "../lib/file";

export function Toolbar() {
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const file = useEditorStore((s) => s.file);
  const edits = useEditorStore((s) => s.edits);
  const selectedPageIndex = useEditorStore((s) => s.selectedPageIndex);
  const mode = useEditorStore((s) => s.mode);
  const setFile = useEditorStore((s) => s.setFile);
  const addEdit = useEditorStore((s) => s.addEdit);
  const setMode = useEditorStore((s) => s.setMode);

  function openPdf(picked: File) {
    setFile(picked);
  }

  function addText() {
    addEdit(
      makeTextEdit({
        pageIndex: selectedPageIndex,
        x: 80,
        y: 80,
        width: 220,
        height: 60,
      }),
    );
  }

  function addRectangle() {
    addEdit({
      id: crypto.randomUUID(),
      type: "rectangle",
      pageIndex: selectedPageIndex,
      x: 100,
      y: 120,
      width: 180,
      height: 80,
    });
  }

  async function addImage(picked: File) {
    const dataUrl = await fileToDataUrl(picked);
    addEdit({
      id: crypto.randomUUID(),
      type: "image",
      pageIndex: selectedPageIndex,
      x: 100,
      y: 100,
      width: 220,
      height: 120,
      dataUrl,
    });
  }

  async function downloadPdf() {
    if (!file) return;
    const bytes = await exportEditedPdf(file, edits);
    // Copy into a fresh ArrayBuffer so the Blob owns standalone bytes.
    const blob = new Blob([bytes.slice()], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = file.name.replace(/\.pdf$/i, "") + ".edited.pdf";
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <header className="toolbar">
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) openPdf(picked);
          event.target.value = "";
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) void addImage(picked);
          event.target.value = "";
        }}
      />

      <button onClick={() => pdfInputRef.current?.click()}>
        <FilePlus2 size={16} /> Open PDF
      </button>

      <div className="toolbar-divider" />

      {/* Mode toggle: Select vs. Edit existing text */}
      <button
        className={mode === "select" ? "mode active" : "mode"}
        onClick={() => setMode("select")}
        disabled={!file}
        title="Select & move your edits"
      >
        <MousePointer2 size={16} /> Select
      </button>
      <button
        className={mode === "editText" ? "mode active" : "mode"}
        onClick={() => setMode("editText")}
        disabled={!file}
        title="Click existing PDF text to edit it"
      >
        <Pencil size={16} /> Edit Text
      </button>

      <div className="toolbar-divider" />

      <button onClick={addText} disabled={!file}>
        <Type size={16} /> Add Text
      </button>
      <button onClick={() => imageInputRef.current?.click()} disabled={!file}>
        <ImagePlus size={16} /> Add Image / Signature
      </button>
      <button onClick={addRectangle} disabled={!file}>
        <Square size={16} /> Add Box
      </button>

      <div className="toolbar-spacer" />

      <button className="primary" onClick={() => void downloadPdf()} disabled={!file}>
        <Download size={16} /> Download PDF
      </button>
    </header>
  );
}
