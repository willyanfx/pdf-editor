import { useEffect, useRef, useState } from "react";
import { X, Trash2 } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { addImageDataUrl } from "../lib/openFiles";
import {
  addSignature,
  loadSignatures,
  removeSignature,
  type SavedSignature,
} from "../lib/savedSignatures";
import { useFocusTrap } from "../hooks/useFocusTrap";

type Tab = "draw" | "type" | "saved";

const CANVAS_W = 500;
const CANVAS_H = 180;

/**
 * Signature dialog with two creation modes: freehand Draw (pointer drawing on a
 * canvas) and Type (renders a name in a cursive font). Either way the result is
 * a transparent PNG dropped onto the current page as an image edit. Upload reuses
 * the existing "Add Image" path, so it's not duplicated here.
 */
export function SignatureModal() {
  const open = useEditorStore((s) => s.signatureModalOpen);
  // Closing without placing must also drop any auto-detected signature zone the
  // user clicked to open this modal. Otherwise a stale signaturePlacement would
  // force the *next* image (picker/drop/modal) onto that old page+coords. The
  // place() path already consumes the placement before close(), so clearing here
  // is a no-op on success and a cleanup on cancel.
  const close = () => {
    useEditorStore.getState().setSignatureModalOpen(false);
    useEditorStore.getState().setSignaturePlacement(null);
  };
  const trapRef = useFocusTrap<HTMLDivElement>(open, close);

  const [tab, setTab] = useState<Tab>("draw");
  const [typed, setTyped] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [saved, setSaved] = useState<SavedSignature[]>([]);

  // Reset transient state whenever the modal opens, and refresh the saved list.
  useEffect(() => {
    if (!open) return;
    const list = loadSignatures();
    setSaved(list);
    // Default to the Saved tab when there's something to pick from.
    setTab(list.length ? "saved" : "draw");
    setTyped("");
    setHasInk(false);
    const c = canvasRef.current;
    if (c) {
      const ctx = c.getContext("2d");
      ctx?.clearRect(0, 0, c.width, c.height);
    }
  }, [open]);

  if (!open) return null;

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const b = c.getBoundingClientRect();
    return {
      x: ((e.clientX - b.left) / b.width) * c.width,
      y: ((e.clientY - b.top) / b.height) * c.height,
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    drawingRef.current = true;
    lastRef.current = pos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    const last = lastRef.current!;
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    setHasInk(true);
  }

  function onPointerUp() {
    drawingRef.current = false;
    lastRef.current = null;
  }

  function clearCanvas() {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  /** Render the typed name into a transparent canvas and return its data URL. */
  function typedToDataUrl(): string | null {
    if (!typed.trim()) return null;
    const c = document.createElement("canvas");
    c.width = CANVAS_W;
    c.height = CANVAS_H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#111827";
    ctx.font = "64px 'Brush Script MT', 'Segoe Script', cursive";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(typed, c.width / 2, c.height / 2);
    return c.toDataURL("image/png");
  }

  /** Drop a signature data URL onto the page and close. */
  function place(dataUrl: string) {
    addImageDataUrl(dataUrl, { width: 220, height: 80 });
    close();
  }

  function insert() {
    let dataUrl: string | null = null;
    if (tab === "draw") {
      if (!hasInk) return close();
      dataUrl = canvasRef.current!.toDataURL("image/png");
    } else {
      dataUrl = typedToDataUrl();
    }
    if (!dataUrl) return close();
    // Remember newly created signatures so they're reusable next time.
    addSignature(dataUrl);
    place(dataUrl);
  }

  function deleteSaved(id: string) {
    setSaved(removeSignature(id));
  }

  return (
    <>
      <div className="sig-backdrop" onClick={close} />
      <div
        ref={trapRef}
        className="sig-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add signature"
      >
        <div className="sig-header">
          <span>Add signature</span>
          <button type="button" className="sig-close" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="sig-tabs" role="tablist" aria-label="Signature input method">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "draw"}
            className={tab === "draw" ? "active" : ""}
            onClick={() => setTab("draw")}
          >
            Draw
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "type"}
            className={tab === "type" ? "active" : ""}
            onClick={() => setTab("type")}
          >
            Type
          </button>
          {saved.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "saved"}
              className={tab === "saved" ? "active" : ""}
              onClick={() => setTab("saved")}
            >
              Saved
            </button>
          )}
        </div>

        {tab === "draw" && (
          <div className="sig-canvas-wrap" role="tabpanel" aria-label="Draw signature">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className="sig-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <button type="button" className="sig-clear" onClick={clearCanvas}>
              Clear
            </button>
          </div>
        )}

        {tab === "type" && (
          <div className="sig-type-wrap" role="tabpanel" aria-label="Type signature">
            <input
              className="sig-type-input"
              aria-label="Your name"
              placeholder="Type your name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="name"
              autoFocus
            />
            <div className="sig-type-preview">{typed || "Preview"}</div>
          </div>
        )}

        {tab === "saved" && (
          <div className="sig-saved-grid" role="tabpanel" aria-label="Saved signatures">
            {saved.map((s) => (
              <div key={s.id} className="sig-saved-item">
                <button
                  type="button"
                  className="sig-saved-pick"
                  aria-label="Use this signature"
                  onClick={() => place(s.dataUrl)}
                >
                  <img src={s.dataUrl} alt="Saved signature" />
                </button>
                <button
                  type="button"
                  className="sig-saved-del"
                  aria-label="Delete this signature"
                  onClick={() => deleteSaved(s.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="sig-actions">
          <button type="button" className="sig-cancel" onClick={close}>
            {tab === "saved" ? "Close" : "Cancel"}
          </button>
          {tab !== "saved" && (
            <button type="button" className="sig-insert" onClick={insert}>
              Insert
            </button>
          )}
        </div>
      </div>
    </>
  );
}
