import type { PDFPageProxy } from "pdfjs-dist";
import { useEditorStore } from "../store/useEditorStore";
import { usePageStampsUi } from "../store/usePageStampsUi";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";
import { cssFontFamily } from "../lib/fonts";
import {
  fitWatermarkImage,
  layoutHeaderFooter,
  makeRangeTest,
  normalizeQuarterTurn,
  toStandardFontText,
  watermarkMidOffset,
} from "../lib/pageStampsModel";

type Props = {
  pageIndex: number;
  page: PDFPageProxy | null;
};

/**
 * Live, non-interactive preview of the document's header/footer and watermark
 * on one page, drawn the way the export bakes them. While a stamps dialog is
 * open its draft is shown instead of the applied settings.
 *
 * Lives inside PdfViewer's page-transform div, so it inherits that div's
 * PageOp rotation and crop clip. The layer covers the kept (cropped) region
 * and its SVG is counter-rotated, giving an upright "reader space" canvas the
 * size of the visible page — the same frame pageStamps.ts lays out against.
 */
export function PageStampsLayer({ pageIndex, page }: Props) {
  const applied = useEditorStore((s) => s.pageStamps);
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const numPages = useEditorStore((s) => s.numPages);
  const fileName = useEditorStore((s) => s.file?.name ?? "");
  const op = useEditorStore((s) => s.pageOps.find((o) => o.pageIndex === pageIndex));
  const dialog = usePageStampsUi((s) => s.dialog);
  const hfDraft = usePageStampsUi((s) => s.headerFooterDraft);
  const wmDraft = usePageStampsUi((s) => s.watermarkDraft);

  const hf = dialog === "headerFooter" ? hfDraft : applied.headerFooter;
  const wm = dialog === "watermark" ? wmDraft : applied.watermark;
  if (!page || (!hf && !wm)) return null;

  // Numbering is by OUTPUT position, after organizer reorder/delete.
  const order = pageOrder.length ? pageOrder : Array.from({ length: numPages }, (_, i) => i);
  const outIdx = order.indexOf(pageIndex);
  if (outIdx < 0) return null;
  const total = order.length;

  // pdf.js's viewport already includes the page's own /Rotate, matching how the
  // canvas is drawn at VIEWER_WIDTH; k converts points → viewer px.
  const vp = page.getViewport({ scale: 1 });
  const k = VIEWER_WIDTH / vp.width;
  const crop = op?.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const boxW = VIEWER_WIDTH - crop.left - crop.right;
  const boxH = vp.height * k - crop.top - crop.bottom;
  if (boxW <= 0 || boxH <= 0) return null;
  const rotation = normalizeQuarterTurn(op?.rotation ?? 0);
  const quarter = rotation % 180 !== 0;
  // The reader's view of the kept region, in px and in points.
  const readerW = quarter ? boxH : boxW;
  const readerH = quarter ? boxW : boxH;
  const frame = { width: readerW / k, height: readerH / k };

  const ctx = { outIdx, total, date: new Date(), fileName };
  const hfItems = hf
    ? layoutHeaderFooter(hf, ctx, frame, makeRangeTest(hf.pageRange, hf.customRange, total))
    : [];
  const showWm =
    !!wm &&
    makeRangeTest(wm.pageRange, wm.customRange, total)(outIdx) &&
    (wm.source === "image" ? !!wm.imageDataUrl : wm.text.trim() !== "");

  if (hfItems.length === 0 && !showWm) return null;

  const cx = frame.width / 2;
  const cy = frame.height / 2;

  return (
    <div
      className="page-stamps-layer"
      aria-hidden="true"
      style={{ left: crop.left, top: crop.top, width: boxW, height: boxH }}
    >
      <svg
        className="page-stamps-svg"
        width={readerW}
        height={readerH}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        style={{ transform: `translate(-50%, -50%) rotate(${-rotation}deg)` }}
      >
        {hf &&
          hfItems.map((item) => (
            <text
              key={item.slot}
              x={item.x}
              y={item.y}
              textAnchor={item.anchor}
              fontFamily={cssFontFamily(hf.font)}
              fontSize={hf.fontSize}
              fill={hf.color}
            >
              {toStandardFontText(item.text)}
            </text>
          ))}
        {wm && showWm && wm.source === "text" && (
          <text
            x={cx}
            y={cy + watermarkMidOffset(wm.font, wm.fontSize)}
            textAnchor="middle"
            fontFamily={cssFontFamily(wm.font)}
            fontWeight={wm.bold ? 700 : 400}
            fontSize={wm.fontSize}
            fill={wm.color}
            fillOpacity={wm.opacity}
            transform={`rotate(${-wm.rotation} ${cx} ${cy})`}
          >
            {toStandardFontText(wm.text)}
          </text>
        )}
        {wm && showWm && wm.source === "image" && wm.imageDataUrl && (
          <WatermarkImage
            href={wm.imageDataUrl}
            frame={frame}
            scale={wm.imageScale}
            opacity={wm.opacity}
            rotation={wm.rotation}
          />
        )}
      </svg>
    </div>
  );
}

/** The image fits inside `scale` of the page, centred — the same box the export
 * computes from the image's pixel size, reproduced here by aspect-fit. */
function WatermarkImage({
  href,
  frame,
  scale,
  opacity,
  rotation,
}: {
  href: string;
  frame: { width: number; height: number };
  scale: number;
  opacity: number;
  rotation: number;
}) {
  // Fitting the frame's own aspect yields the full scaled box; the SVG's
  // aspect-fit ("meet") then shrinks the real image inside it exactly as the
  // export's fitWatermarkImage does with the image's pixel size.
  const box = fitWatermarkImage(frame.width, frame.height, frame, scale);
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  return (
    <image
      href={href}
      x={cx - box.width / 2}
      y={cy - box.height / 2}
      width={box.width}
      height={box.height}
      opacity={opacity}
      preserveAspectRatio="xMidYMid meet"
      transform={`rotate(${-rotation} ${cx} ${cy})`}
    />
  );
}
