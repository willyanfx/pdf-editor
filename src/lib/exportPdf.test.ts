import { expect, test } from "vite-plus/test";
import { mapScreenRectToPdf } from "./pdfGeometry";

test("mapScreenRectToPdf converts top-left screen coordinates to PDF coordinates", () => {
  expect(mapScreenRectToPdf({ x: 100, y: 50, width: 200, height: 40 }, 400, 600, 800)).toEqual({
    x: 50,
    y: 555,
    width: 100,
    height: 20,
    scale: 0.5,
  });
});

test("mapScreenRectToPdf supports non-letter page sizes", () => {
  expect(mapScreenRectToPdf({ x: 80, y: 120, width: 320, height: 160 }, 1000, 1400, 800)).toEqual({
    x: 100,
    y: 1050,
    width: 400,
    height: 200,
    scale: 1.25,
  });
});
