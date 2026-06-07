import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { EditableLayer } from "./EditableLayer";
import { useEditorStore } from "../store/useEditorStore";
import { VIEWER_WIDTH } from "../lib/exportPdf";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Load the worker bundled with our single pdfjs-dist copy so the worker version
// always matches the API version react-pdf was built against.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export function PdfViewer() {
  // `file` is a stable reference (changes only when a new PDF is opened), so
  // react-pdf won't re-load on every render.
  const file = useEditorStore((s) => s.file);
  const setSelectedPageIndex = useEditorStore((s) => s.setSelectedPageIndex);
  const [numPages, setNumPages] = useState(0);

  if (!file) {
    return (
      <section className="empty">
        <h1>Browser PDF Editor</h1>
        <p>Open a PDF, add text, signatures, images and boxes, then download the edited file.</p>
        <p className="muted">No backend. No upload. Your files never leave your browser.</p>
      </section>
    );
  }

  return (
    <section className="pdf-wrapper">
      <Document
        file={file}
        onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
        loading={<p className="muted">Loading PDF…</p>}
        error={<p className="muted">Could not open this PDF.</p>}
      >
        {Array.from({ length: numPages }, (_, index) => (
          <div
            className="page-shell"
            key={index}
            onMouseDown={() => setSelectedPageIndex(index)}
          >
            <Page
              pageNumber={index + 1}
              width={VIEWER_WIDTH}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
            <EditableLayer pageIndex={index} />
          </div>
        ))}
      </Document>
    </section>
  );
}
