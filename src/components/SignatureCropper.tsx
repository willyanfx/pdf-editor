import { useRef } from "react";

export type CropRect = { x: number; y: number; width: number; height: number };

type Props = {
  /** The (already background-removed) image to crop, as a data URL. */
  src: string;
  /** Natural pixel dimensions of `src`, used as the crop coordinate space. */
  imageWidth: number;
  imageHeight: number;
  /** Current crop rect in image-pixel coordinates (null = whole image). */
  rect: CropRect | null;
  /** Called with the updated rect (image-pixel coords) as the user drags. */
  onChange: (rect: CropRect) => void;
};

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

const MIN_SIZE = 8; // minimum crop size, in image pixels

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * A crop overlay for the uploaded signature. The image is shown on a
 * transparency checkerboard; a draggable rectangle (with corner handles) selects
 * the region to keep. Everything outside the rect is dimmed. All geometry is
 * tracked in the image's natural pixel space and converted to/from on-screen
 * pixels via the rendered element's measured size, so the exported crop is
 * exact regardless of display scaling.
 */
export function SignatureCropper({ src, imageWidth, imageHeight, rect, onChange }: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    orig: CropRect;
    scaleX: number;
    scaleY: number;
  } | null>(null);

  const crop = rect ?? { x: 0, y: 0, width: imageWidth, height: imageHeight };

  // Convert the image-space crop into percentages for CSS positioning, so the
  // overlay tracks the image at whatever size flexbox renders it.
  const pct = {
    left: (crop.x / imageWidth) * 100,
    top: (crop.y / imageHeight) * 100,
    width: (crop.width / imageWidth) * 100,
    height: (crop.height / imageHeight) * 100,
  };

  function beginDrag(mode: DragMode, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const frame = frameRef.current;
    if (!frame) return;
    const b = frame.getBoundingClientRect();
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: crop,
      scaleX: imageWidth / b.width,
      scaleY: imageHeight / b.height,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    // Pointer delta in screen px → image px.
    const dx = (e.clientX - d.startX) * d.scaleX;
    const dy = (e.clientY - d.startY) * d.scaleY;
    let { x, y, width, height } = d.orig;

    if (d.mode === "move") {
      x = clamp(d.orig.x + dx, 0, imageWidth - width);
      y = clamp(d.orig.y + dy, 0, imageHeight - height);
    } else {
      // Resize from a corner: adjust the moved edges, keep the opposite edges.
      let left = d.orig.x;
      let top = d.orig.y;
      let right = d.orig.x + d.orig.width;
      let bottom = d.orig.y + d.orig.height;
      if (d.mode === "nw" || d.mode === "sw") left = clamp(d.orig.x + dx, 0, right - MIN_SIZE);
      if (d.mode === "ne" || d.mode === "se")
        right = clamp(right + dx, left + MIN_SIZE, imageWidth);
      if (d.mode === "nw" || d.mode === "ne") top = clamp(d.orig.y + dy, 0, bottom - MIN_SIZE);
      if (d.mode === "sw" || d.mode === "se")
        bottom = clamp(bottom + dy, top + MIN_SIZE, imageHeight);
      x = left;
      y = top;
      width = right - left;
      height = bottom - top;
    }
    onChange({ x, y, width, height });
  }

  function endDrag(e: React.PointerEvent) {
    dragRef.current = null;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already be released; ignore.
    }
  }

  return (
    <div className="sig-cropper" ref={frameRef} aria-label="Crop signature">
      <img className="sig-cropper-img" src={src} alt="Uploaded signature" draggable={false} />
      <div
        className="sig-crop-box"
        style={{
          left: `${pct.left}%`,
          top: `${pct.top}%`,
          width: `${pct.width}%`,
          height: `${pct.height}%`,
        }}
        onPointerDown={(e) => beginDrag("move", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {(["nw", "ne", "sw", "se"] as DragMode[]).map((corner) => (
          <span
            key={corner}
            className={`sig-crop-handle sig-crop-${corner}`}
            onPointerDown={(e) => beginDrag(corner, e)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        ))}
      </div>
    </div>
  );
}
