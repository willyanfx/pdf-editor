import { useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFPageProxy } from "pdfjs-dist";
import { EditableLayer } from "./EditableLayer";
import { ExistingTextLayer } from "./ExistingTextLayer";
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
  const selectEdit = useEditorStore((s) => s.selectEdit);
  const mode = useEditorStore((s) => s.mode);
  const [numPages, setNumPages] = useState(0);

  // Per-page pdf.js page proxies (for text extraction) and canvas refs (for
  // background-color sampling). Stored outside React state to avoid re-renders.
  const pagesRef = useRef<Map<number, PDFPageProxy>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement | null>>(new Map());
  // Bump to re-render once a page proxy lands so ExistingTextLayer gets it.
  const [, force] = useState(0);

  if (!file) {
    return (
      <section className="empty">
        <h1>Browser PDF Editor</h1>
        <p>
          Open a PDF, edit existing text, add text, signatures, images and boxes, then download the
          edited file.
        </p>
        <p className="muted">No backend. No upload. Your files never leave your browser.</p>
      </section>
    );
  }

  return (
    <section className={`pdf-wrapper mode-${mode}`}>
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
            onMouseDown={() => {
              setSelectedPageIndex(index);
              selectEdit(null);
            }}
          >
            <Page
              pageNumber={index + 1}
              width={VIEWER_WIDTH}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              canvasRef={(el) => {
                canvasRefs.current.set(index, el);
              }}
              onLoadSuccess={(page) => {
                pagesRef.current.set(index, page as unknown as PDFPageProxy);
                force((n) => n + 1);
              }}
            />
            <ExistingTextLayer
              pageIndex={index}
              page={pagesRef.current.get(index) ?? null}
              getCanvas={() => canvasRefs.current.get(index) ?? null}
            />
            <EditableLayer pageIndex={index} />
          </div>
        ))}
      </Document>
    </section>
  );
}
