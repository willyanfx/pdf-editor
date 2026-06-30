import { expect, test } from "vite-plus/test";
import { keyOutBackground, detectInkBounds, cropImageData } from "./removeSignatureBackground";

// The Node test environment has no DOM, so polyfill the minimal ImageData shape
// cropImageData constructs. Browsers (and the real app) use the native class.
if (typeof globalThis.ImageData === "undefined") {
  class TestImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace = "srgb";
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  globalThis.ImageData = TestImageData as unknown as typeof ImageData;
}

/** Build a WxH ImageData-shaped buffer; `fill(x,y)` returns [r,g,b,a]. */
function grid(
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number?],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

/** Build a 1xN ImageData-shaped buffer from [r,g,b,a] pixels (a defaults to 255). */
function makeImageData(pixels: Array<[number, number, number, number?]>): ImageData {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a = 255], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  });
  return { data, width: pixels.length, height: 1, colorSpace: "srgb" } as ImageData;
}

test("white paper becomes fully transparent", () => {
  const out = keyOutBackground(makeImageData([[255, 255, 255]]));
  expect(out.data[3]).toBe(0);
});

test("black ink stays fully opaque", () => {
  const out = keyOutBackground(makeImageData([[0, 0, 0]]));
  expect(out.data[3]).toBe(255);
});

test("ink is recolored to the ink color, preserving the signature shape via alpha", () => {
  const out = keyOutBackground(makeImageData([[0, 0, 0]]), { inkColor: "#112233" });
  expect([out.data[0], out.data[1], out.data[2]]).toEqual([0x11, 0x22, 0x33]);
});

test("mid-gray near the threshold gets partial (feathered) alpha, not a hard clip", () => {
  // Luminance ~0.5 with default threshold 0.6 / softness 0.25 (band 0.35..0.6).
  const out = keyOutBackground(makeImageData([[128, 128, 128]]));
  expect(out.data[3]).toBeGreaterThan(0);
  expect(out.data[3]).toBeLessThan(255);
});

test("raising the threshold removes more of a light-gray background", () => {
  const lightGray: Array<[number, number, number]> = [[210, 210, 210]];
  const low = keyOutBackground(makeImageData(lightGray), { threshold: 0.4 });
  const high = keyOutBackground(makeImageData(lightGray), { threshold: 0.95 });
  expect(high.data[3]).toBeGreaterThan(low.data[3]);
});

test("a transparent source pixel stays transparent (source alpha respected)", () => {
  const out = keyOutBackground(makeImageData([[0, 0, 0, 0]]));
  expect(out.data[3]).toBe(0);
});

test("higher contrast darkens a faint mid-tone stroke without touching solid ink", () => {
  const faint: Array<[number, number, number]> = [[150, 150, 150]];
  const none = keyOutBackground(makeImageData(faint), { contrast: 0 });
  const boosted = keyOutBackground(makeImageData(faint), { contrast: 1 });
  expect(boosted.data[3]).toBeGreaterThan(none.data[3]);
  // Solid black ink stays fully opaque at any contrast.
  const solid = keyOutBackground(makeImageData([[0, 0, 0]]), { contrast: 1 });
  expect(solid.data[3]).toBe(255);
});

test("detectInkBounds finds the tight box around opaque pixels", () => {
  // 6x4 transparent image with a 2x2 opaque block at (2,1).
  const img = grid(6, 4, (x, y) =>
    x >= 2 && x <= 3 && y >= 1 && y <= 2 ? [0, 0, 0, 255] : [0, 0, 0, 0],
  );
  expect(detectInkBounds(img)).toEqual({ x: 2, y: 1, width: 2, height: 2 });
});

test("detectInkBounds returns null for an empty (all-transparent) image", () => {
  expect(detectInkBounds(grid(4, 4, () => [0, 0, 0, 0]))).toBeNull();
});

test("detectInkBounds ignores faint noise below the alpha floor", () => {
  const img = grid(5, 5, (x, y) => {
    if (x === 2 && y === 2) return [0, 0, 0, 255]; // real ink
    if (x === 0 && y === 0) return [0, 0, 0, 3]; // noise below floor (8)
    return [0, 0, 0, 0];
  });
  expect(detectInkBounds(img)).toEqual({ x: 2, y: 2, width: 1, height: 1 });
});

test("cropImageData extracts the requested region and clamps to bounds", () => {
  const img = grid(4, 4, (x, y) => [x * 10, y * 10, 0, 255]);
  const out = cropImageData(img, { x: 1, y: 1, width: 2, height: 2 });
  expect([out.width, out.height]).toEqual([2, 2]);
  // top-left of the crop is the source pixel (1,1).
  expect([out.data[0], out.data[1]]).toEqual([10, 10]);
  // a crop overflowing the right edge is clamped, not out-of-bounds.
  const clamped = cropImageData(img, { x: 3, y: 0, width: 5, height: 1 });
  expect(clamped.width).toBe(1);
});
