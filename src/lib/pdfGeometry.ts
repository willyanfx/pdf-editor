/** Must match the on-screen render width used by <Page width={...}> in PdfViewer. */
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
