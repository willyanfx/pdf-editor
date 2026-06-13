/** Must match the on-screen render width used by <Page width={...}> in PdfViewer.
 *
 * Intentionally a fixed constant: every stored edit coordinate and OCR bbox is
 * expressed in screen px at this width, so changing it at runtime (e.g. for a
 * zoom control) would require re-scaling all existing edits and the OCR mapping.
 * Real zoom is therefore deferred; the top bar offers page navigation instead. */
export const VIEWER_WIDTH = 800;

export type ScreenRect = { x: number; y: number; width: number; height: number };
export type PdfRect = ScreenRect & { scale: number };

export function mapScreenRectToPdf(
  rect: ScreenRect,
  pageWidth: number,
  pageHeight: number,
  renderWidth = VIEWER_WIDTH,
): PdfRect {
  const scale = pageWidth / renderWidth;
  return {
    x: rect.x * scale,
    y: pageHeight - (rect.y + rect.height) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
    scale,
  };
}
