import { expect, test } from "vite-plus/test";
import { linesFromData, ocrLineToScreenItem } from "./ocr";

test("linesFromData extracts non-empty line results from Tesseract blocks", () => {
  expect(
    linesFromData({
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                { text: "Hello\n", bbox: { x0: 10, y0: 20, x1: 90, y1: 44 } },
                { text: "   ", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
              ],
            },
          ],
        },
      ],
    }),
  ).toEqual([{ text: "Hello", bbox: { x0: 10, y0: 20, x1: 90, y1: 44 } }]);
});

test("ocrLineToScreenItem projects OCR bboxes into screen coordinates", () => {
  expect(
    ocrLineToScreenItem(
      { text: "Total", bbox: { x0: 20, y0: 30, x1: 120, y1: 90 } },
      2,
      0.5,
      0.25,
      10,
      5,
    ),
  ).toEqual({
    id: "ocr-2",
    str: "Total",
    x: 20,
    y: 12.5,
    width: 50,
    height: 15,
    fontSize: 12.5,
    fontFamily: "Helvetica",
    bold: false,
    italic: false,
  });
});
