import { expect, test } from "vite-plus/test";
import { linesFromData, ocrLineToScreenItem, paragraphsFromData } from "./ocr";

/** Build a minimal blocks tree from lines of { text, y0, y1, x0, words? }. */
function tree(
  lines: { text: string; x0: number; y0: number; y1?: number; x1?: number }[],
) {
  return {
    blocks: [
      {
        paragraphs: [
          {
            lines: lines.map((l) => {
              const y1 = l.y1 ?? l.y0 + 20;
              const x1 = l.x1 ?? l.x0 + 200;
              return {
                text: l.text + "\n",
                bbox: { x0: l.x0, y0: l.y0, x1, y1 },
                rowAttributes: { row_height: y1 - l.y0 },
                words: [{ text: l.text.split(" ")[0], bbox: { x0: l.x0, y0: l.y0, x1: l.x0 + 30, y1 } }],
              };
            }),
          },
        ],
      },
    ],
  };
}

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

test("paragraphsFromData merges soft-wrapped lines into one paragraph", () => {
  const paras = paragraphsFromData(
    tree([
      { text: "The quick brown fox jumps", x0: 10, y0: 0 },
      { text: "over the lazy dog today.", x0: 10, y0: 22 }, // tight gap → same para
    ]),
  );
  expect(paras).toHaveLength(1);
  expect(paras[0].text).toBe("The quick brown fox jumps over the lazy dog today.");
  expect(paras[0].isListItem).toBe(false);
});

test("paragraphsFromData splits paragraphs separated by a large vertical gap", () => {
  const paras = paragraphsFromData(
    tree([
      { text: "First paragraph line.", x0: 10, y0: 0 },
      { text: "Second paragraph after a gap.", x0: 10, y0: 80 }, // big gap → split
    ]),
  );
  expect(paras).toHaveLength(2);
  expect(paras[0].text).toBe("First paragraph line.");
  expect(paras[1].text).toBe("Second paragraph after a gap.");
});

test("paragraphsFromData keeps each bullet as its own item", () => {
  const paras = paragraphsFromData(
    tree([
      { text: "Shopping list:", x0: 10, y0: 0 },
      { text: "• apples", x0: 10, y0: 22 },
      { text: "• bananas", x0: 10, y0: 44 },
      { text: "1. first numbered", x0: 10, y0: 66 },
    ]),
  );
  expect(paras.map((p) => p.text)).toEqual([
    "Shopping list:",
    "• apples",
    "• bananas",
    "1. first numbered",
  ]);
  expect(paras.slice(1).every((p) => p.isListItem)).toBe(true);
});

test("paragraphsFromData splits a bold heading sitting just above its bullet list", () => {
  // Real Rapha layout: "Past medical history" heading with only a small gap above
  // its first "• ..." bullet. Without the lookahead the heading merges into the
  // bullet; with it, the heading gets its own block.
  const paras = paragraphsFromData(
    tree([
      { text: "Past medical history", x0: 60, y0: 0, y1: 26 },
      { text: "• Right calf strain 2 years ago.", x0: 60, y0: 40, y1: 66 },
      { text: "• Required to participate in drills.", x0: 60, y0: 80, y1: 106 },
    ]),
  );
  expect(paras.map((p) => p.text)).toEqual([
    "Past medical history",
    "• Right calf strain 2 years ago.",
    "• Required to participate in drills.",
  ]);
  expect(paras[0].isListItem).toBe(false);
  expect(paras[1].isListItem).toBe(true);
});

test("paragraphsFromData splits a heading from the body paragraph below it", () => {
  // Real geometry seen in-browser: 33px row, ~37px gap heading→body (just over
  // the 1.3× threshold), then a tightly-wrapped 26px body paragraph.
  const paras = paragraphsFromData(
    tree([
      { text: "Quarterly Report", x0: 60, y0: 40, y1: 73 },
      { text: "The team delivered strong results this quarter", x0: 60, y0: 110, y1: 136 },
      { text: "and exceeded the revenue target.", x0: 60, y0: 145, y1: 171 },
    ]),
  );
  expect(paras).toHaveLength(2);
  expect(paras[0].text).toBe("Quarterly Report");
  expect(paras[1].text).toBe(
    "The team delivered strong results this quarter and exceeded the revenue target.",
  );
});

test("paragraphsFromData recovers misread bullet glyphs and splits each item", () => {
  // Tesseract often reads a round bullet (•) as «. Each list line sits at the
  // body's left edge with only a small gap, so the marker — not geometry — must
  // split them, and the glyph is canonicalized back to •.
  const paras = paragraphsFromData(
    tree([
      { text: "Key highlights:", x0: 60, y0: 220, y1: 246 },
      { text: "« Revenue grew", x0: 62, y0: 265, y1: 291 },
      { text: "« Two new markets", x0: 62, y0: 300, y1: 326 },
    ]),
  );
  expect(paras.map((p) => p.text)).toEqual([
    "Key highlights:",
    "• Revenue grew",
    "• Two new markets",
  ]);
  expect(paras[1].isListItem).toBe(true);
});

test("paragraphsFromData de-hyphenates words split across a wrap", () => {
  const paras = paragraphsFromData(
    tree([
      { text: "This is an inter-", x0: 10, y0: 0 },
      { text: "national agreement.", x0: 10, y0: 22 },
    ]),
  );
  expect(paras[0].text).toBe("This is an international agreement.");
});
