import { useEffect, useRef, useState } from "react";
import { X, Trash2, Upload } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { addImageDataUrl } from "../lib/openFiles";
import {
  addSignature,
  loadSignatures,
  removeSignature,
  type SavedSignature,
} from "../lib/savedSignatures";
import { fileToDataUrl } from "../lib/file";
import {
  decodeToImageData,
  keyOutBackground,
  imageDataToPngDataUrl,
  detectInkBounds,
  cropImageData,
} from "../lib/removeSignatureBackground";
import { SignatureCropper, type CropRect } from "./SignatureCropper";
import { useFocusTrap } from "../hooks/useFocusTrap";

type Tab = "draw" | "type" | "saved" | "upload";

const CANVAS_W = 500;
const CANVAS_H = 180;

/**
 * Signature dialog with creation modes: freehand Draw (pointer drawing on a
 * canvas), Type (renders a name in a cursive font), and Upload (import a photo
 * or scan of a real signature: key out the paper background, auto-crop to the
 * detected ink with adjustable manual handles, and boost stroke contrast).
 * Either way the result is a transparent PNG dropped onto the current page as an
 * image edit.
 */
const DEFAULT_THRESHOLD = 0.6;
const DEFAULT_CONTRAST = 0.35;
/** Pad the auto-detected ink box by this fraction so strokes aren't clipped. */
const AUTO_CROP_PAD = 0.04;
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

  // Upload tab: the decoded source image is held so the live preview can
  // re-key the background on every slider change without re-reading the file.
  const sourceRef = useRef<ImageData | null>(null);
  // The current keyed (background-removed) full-size result, kept so Insert can
  // crop it to the chosen rect without re-deriving from the slider values.
  const keyedRef = useRef<ImageData | null>(null);
  // Bumped each time a new source image is decoded, to re-fire the preview effect.
  const [sourceVersion, setSourceVersion] = useState(0);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [contrast, setContrast] = useState(DEFAULT_CONTRAST);
  const [autoCrop, setAutoCrop] = useState(true);
  // Crop rectangle in the keyed image's natural pixel coordinates.
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  // Reset transient state whenever the modal opens, and refresh the saved list.
  useEffect(() => {
    if (!open) return;
    const list = loadSignatures();
    setSaved(list);
    // Default to the Saved tab when there's something to pick from.
    setTab(list.length ? "saved" : "draw");
    setTyped("");
    setHasInk(false);
    sourceRef.current = null;
    keyedRef.current = null;
    setSourceVersion(0);
    setUploadPreview(null);
    setPreviewSize(null);
    setThreshold(DEFAULT_THRESHOLD);
    setContrast(DEFAULT_CONTRAST);
    setAutoCrop(true);
    setCropRect(null);
    setUploadError(null);
    setProcessing(false);
    const c = canvasRef.current;
    if (c) {
      const ctx = c.getContext("2d");
      ctx?.clearRect(0, 0, c.width, c.height);
    }
  }, [open]);

  // Re-key the upload preview whenever the source, threshold, or contrast change.
  // Produces the full background-removed image; cropping is applied separately at
  // insert time so the user can keep adjusting the crop box over a stable preview.
  useEffect(() => {
    const source = sourceRef.current;
    if (tab !== "upload" || !source) return;
    const copy = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    const keyed = keyOutBackground(copy, { threshold, contrast });
    keyedRef.current = keyed;
    setPreviewSize({ width: keyed.width, height: keyed.height });
    setUploadPreview(imageDataToPngDataUrl(keyed));
  }, [tab, threshold, contrast, sourceVersion]);

  // When auto-crop is on (and on each new image), snap the crop box to the
  // detected ink bounds, padded slightly so stroke ends aren't clipped.
  useEffect(() => {
    const keyed = keyedRef.current;
    if (tab !== "upload" || !keyed || !autoCrop) return;
    const bounds = detectInkBounds(keyed);
    if (!bounds) {
      setCropRect({ x: 0, y: 0, width: keyed.width, height: keyed.height });
      return;
    }
    const padX = bounds.width * AUTO_CROP_PAD;
    const padY = bounds.height * AUTO_CROP_PAD;
    setCropRect({
      x: Math.max(0, bounds.x - padX),
      y: Math.max(0, bounds.y - padY),
      width: Math.min(keyed.width - Math.max(0, bounds.x - padX), bounds.width + padX * 2),
      height: Math.min(keyed.height - Math.max(0, bounds.y - padY), bounds.height + padY * 2),
    });
  }, [tab, autoCrop, sourceVersion, threshold]);

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

  /** Decode a picked image file into the source buffer used by the live preview. */
  async function handleUploadFile(file: File | undefined | null) {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setUploadError("Please choose a PNG or JPEG image.");
      return;
    }
    setUploadError(null);
    setProcessing(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const { imageData } = await decodeToImageData(dataUrl);
      sourceRef.current = imageData;
      // A fresh image should re-run auto-crop from scratch.
      setAutoCrop(true);
      setCropRect(null);
      setSourceVersion((v) => v + 1);
    } catch {
      sourceRef.current = null;
      setUploadPreview(null);
      setUploadError("Could not read that image.");
    } finally {
      setProcessing(false);
    }
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
    } else if (tab === "upload") {
      // Crop the keyed (background-removed, contrast-boosted) image to the chosen
      // rectangle, then export that as the signature PNG.
      const keyed = keyedRef.current;
      if (!keyed) return;
      const region = cropRect ?? { x: 0, y: 0, width: keyed.width, height: keyed.height };
      dataUrl = imageDataToPngDataUrl(cropImageData(keyed, region));
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
          <button
            type="button"
            role="tab"
            aria-selected={tab === "upload"}
            className={tab === "upload" ? "active" : ""}
            onClick={() => setTab("upload")}
          >
            Upload
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

        {tab === "upload" && (
          <div className="sig-upload-wrap" role="tabpanel" aria-label="Upload signature image">
            {!uploadPreview && !processing && (
              <label className="sig-upload-drop">
                <Upload size={22} />
                <span>Choose a photo or scan of your signature</span>
                <small>PNG or JPEG · the paper background is removed automatically</small>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sig-upload-input"
                  onChange={(e) => void handleUploadFile(e.target.files?.[0])}
                />
              </label>
            )}

            {processing && <div className="sig-upload-status">Processing…</div>}

            {uploadPreview && previewSize && (
              <>
                <SignatureCropper
                  src={uploadPreview}
                  imageWidth={previewSize.width}
                  imageHeight={previewSize.height}
                  rect={cropRect}
                  onChange={(r) => {
                    // Manual drag turns off auto-crop so it won't snap back.
                    setAutoCrop(false);
                    setCropRect(r);
                  }}
                />

                <label className="sig-upload-toggle">
                  <input
                    type="checkbox"
                    checked={autoCrop}
                    onChange={(e) => setAutoCrop(e.target.checked)}
                  />
                  Auto-crop to signature
                </label>

                <label className="sig-upload-threshold">
                  Background removal
                  <input
                    type="range"
                    min={0.2}
                    max={0.95}
                    step={0.01}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    aria-label="Background removal strength"
                  />
                </label>

                <label className="sig-upload-threshold">
                  Line contrast
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={contrast}
                    onChange={(e) => setContrast(Number(e.target.value))}
                    aria-label="Signature line contrast"
                  />
                  <span className="sig-upload-hint">
                    Removal: drag right if paper shows. Contrast: drag right to darken faint ink.
                  </span>
                </label>

                <label className="sig-upload-replace">
                  Choose a different image
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sig-upload-input"
                    onChange={(e) => void handleUploadFile(e.target.files?.[0])}
                  />
                </label>
              </>
            )}

            {uploadError && (
              <div className="sig-upload-status sig-upload-error" role="alert">
                {uploadError}
              </div>
            )}
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
            <button
              type="button"
              className="sig-insert"
              onClick={insert}
              disabled={tab === "upload" && !uploadPreview}
            >
              Insert
            </button>
          )}
        </div>
      </div>
    </>
  );
}
