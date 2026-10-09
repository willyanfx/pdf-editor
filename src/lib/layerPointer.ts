/**
 * Pointer → page-space mapping for the overlay layers inside PdfViewer's
 * `.page-transform` div.
 *
 * Every layer is `position: absolute; inset: 0` inside that div, which is
 * rotated (PageOp rotation, `transform-origin: center`) and, further up, scaled
 * by the zoom. Stored coordinates must stay in the UNROTATED, unzoomed
 * VIEWER_WIDTH space (the single coordinate system of pdfGeometry.ts), so a
 * pointer position has to be mapped back through both transforms.
 *
 * `getBoundingClientRect()` of the layer reports the axis-aligned box of the
 * transformed element. Rotation about the element's center and a uniform
 * scale both keep that box centered on the element's center, so the mapping
 * is: offset from the box center → unscale → unrotate → offset from the
 * element's own center.
 */

export type ClientBox = { left: number; top: number; width: number; height: number };

export type LayerFrame = {
  /** The layer's getBoundingClientRect(). */
  bounds: ClientBox;
  /** The layer's layout size (offsetWidth/offsetHeight), i.e. page space. */
  size: { width: number; height: number };
  /** Clockwise CSS rotation applied around the layer's center, in degrees. */
  rotation: number;
  /** Uniform CSS scale applied by the viewer's zoom. */
  zoom: number;
};

/** Map a client (viewport) point into the layer's unrotated, unzoomed space. */
export function clientToLayerPoint(
  client: { x: number; y: number },
  frame: LayerFrame,
): { x: number; y: number } {
  const { bounds, size, rotation, zoom } = frame;
  const scale = zoom > 0 ? zoom : 1;
  const dx = (client.x - (bounds.left + bounds.width / 2)) / scale;
  const dy = (client.y - (bounds.top + bounds.height / 2)) / scale;
  // Undo a clockwise screen-space rotation (y grows downwards).
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: dx * cos - dy * sin + size.width / 2,
    y: dx * sin + dy * cos + size.height / 2,
  };
}
