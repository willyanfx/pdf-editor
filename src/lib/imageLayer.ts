import { OPS, type PDFPageProxy } from "pdfjs-dist";
import { VIEWER_WIDTH } from "./pdfGeometry";

/** An embedded PDF image projected into screen px at the viewer width, ready to
 * become a "swap this image" hit target. */
export type ScreenImageItem = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Discover the images embedded in a page and their on-screen bounding boxes by
 * replaying the page's operator list and tracking the current transform matrix.
 * Mirrors extractScreenTextItems() in textLayer.ts but for image XObjects.
 *
 * We only need geometry (where each image sits) to place a clickable hit target;
 * the actual pixels are covered and replaced on export, so we don't decode them.
 */
export async function extractScreenImageItems(
  page: PDFPageProxy,
  renderWidth = VIEWER_WIDTH,
): Promise<ScreenImageItem[]> {
  const opList = await page.getOperatorList();
  const viewport = page.getViewport({ scale: renderWidth / page.getViewport({ scale: 1 }).width });

  // CTM stack. pdf.js matrices are [a, b, c, d, e, f].
  type M = [number, number, number, number, number, number];
  let ctm: M = [1, 0, 0, 0, 1, 0] as unknown as M; // overwritten below
  ctm = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];

  const mul = (m1: M, m2: M): M => [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];

  const items: ScreenImageItem[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];

    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === OPS.transform) {
      ctm = mul(ctm, args as unknown as M);
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject
    ) {
      // A unit square (0..1) is mapped by the CTM to the image's placement.
      // Its four corners in PDF user space:
      const corners: Array<[number, number]> = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([ux, uy]) => [ctm[0] * ux + ctm[2] * uy + ctm[4], ctm[1] * ux + ctm[3] * uy + ctm[5]]);

      // Project each corner to screen (viewport) coordinates.
      const screen = corners.map(([px, py]) => viewport.convertToViewportPoint(px, py));
      const xs = screen.map((p) => p[0]);
      const ys = screen.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const width = Math.max(...xs) - x;
      const height = Math.max(...ys) - y;

      // Skip degenerate / full-page background scans (often the whole sheet).
      if (width >= 8 && height >= 8) {
        items.push({ x, y, width, height });
      }
    }
  }

  return items;
}
