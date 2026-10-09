import { expect, test } from "vite-plus/test";
import { clientToLayerPoint, type LayerFrame } from "./layerPointer";

const size = { width: 800, height: 1000 };

/** Where the browser would report the bounding box of an 800×1000 layer
 * rotated by `rotation` around its center and zoomed, with its (unrotated)
 * top-left at (100, 50) before rotation. */
function frame(rotation: number, zoom: number): LayerFrame {
  const quarter = rotation % 180 !== 0;
  const w = (quarter ? size.height : size.width) * zoom;
  const h = (quarter ? size.width : size.height) * zoom;
  const cx = 100 + (size.width * zoom) / 2;
  const cy = 50 + (size.height * zoom) / 2;
  return {
    bounds: { left: cx - w / 2, top: cy - h / 2, width: w, height: h },
    size,
    rotation,
    zoom,
  };
}

const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

test("no rotation: subtract the origin and divide by zoom", () => {
  near(clientToLayerPoint({ x: 100, y: 50 }, frame(0, 1)), 0, 0);
  near(clientToLayerPoint({ x: 300, y: 450 }, frame(0, 1)), 200, 400);
  near(clientToLayerPoint({ x: 100 + 400, y: 50 + 800 }, frame(0, 2)), 200, 400);
});

test("90° clockwise: the page's top-left corner is at the box's top-right", () => {
  const f = frame(90, 1);
  const right = f.bounds.left + f.bounds.width;
  near(clientToLayerPoint({ x: right, y: f.bounds.top }, f), 0, 0);
  // Page's bottom-left corner lands at the box's top-left.
  near(clientToLayerPoint({ x: f.bounds.left, y: f.bounds.top }, f), 0, size.height);
  // Moving down the screen moves along the page's x axis.
  near(clientToLayerPoint({ x: right, y: f.bounds.top + 300 }, f), 300, 0);
});

test("180°: both axes flip", () => {
  const f = frame(180, 1.5);
  const right = f.bounds.left + f.bounds.width;
  const bottom = f.bounds.top + f.bounds.height;
  near(clientToLayerPoint({ x: right, y: bottom }, f), 0, 0);
  near(clientToLayerPoint({ x: right - 150, y: bottom - 300 }, f), 100, 200);
});

test("270° (= -90°): the page's top-left corner is at the box's bottom-left", () => {
  for (const rotation of [270, -90]) {
    const f = frame(rotation, 1);
    const bottom = f.bounds.top + f.bounds.height;
    near(clientToLayerPoint({ x: f.bounds.left, y: bottom }, f), 0, 0);
    near(clientToLayerPoint({ x: f.bounds.left + 120, y: bottom - 40 }, f), 40, 120);
  }
});

test("the center maps to the center at any rotation and zoom", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const f = frame(rotation, 0.75);
    near(
      clientToLayerPoint(
        { x: f.bounds.left + f.bounds.width / 2, y: f.bounds.top + f.bounds.height / 2 },
        f,
      ),
      size.width / 2,
      size.height / 2,
    );
  }
});
