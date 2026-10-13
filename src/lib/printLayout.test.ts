import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_BOOKLET,
  DEFAULT_NUP,
  bookletSides,
  gridFor,
  layoutPdf,
  layoutSheetCount,
  planBooklet,
  planNUp,
  rotatedOrigin,
  type PageSize,
} from "./printLayout";

const letter: PageSize = { width: 612, height: 792 };
const pagesOf = (n: number, size = letter) => Array.from({ length: n }, () => size);

describe("gridFor", () => {
  it("runs the long side along the long sheet edge", () => {
    expect(gridFor(2, true)).toEqual({ cols: 2, rows: 1 });
    expect(gridFor(2, false)).toEqual({ cols: 1, rows: 2 });
    expect(gridFor(6, true)).toEqual({ cols: 3, rows: 2 });
    expect(gridFor(9, false)).toEqual({ cols: 3, rows: 3 });
  });
});

describe("planNUp", () => {
  it("groups pages per sheet and leaves the last sheet short", () => {
    const plans = planNUp(pagesOf(5), { ...DEFAULT_NUP, perSheet: 4 });
    expect(plans).toHaveLength(2);
    expect(plans[0].slots.map((s) => s.src)).toEqual([0, 1, 2, 3]);
    expect(plans[1].slots.map((s) => s.src)).toEqual([4]);
  });

  it("orders slots across rows or down columns, top-left first", () => {
    const opts = { ...DEFAULT_NUP, perSheet: 4 as const, orientation: "portrait" as const };
    const [rows] = planNUp(pagesOf(4), opts);
    // 2×2: slot 1 is top-right, slot 2 bottom-left.
    expect(rows.slots[1].x).toBeGreaterThan(rows.slots[0].x);
    expect(rows.slots[1].y).toBe(rows.slots[0].y);
    expect(rows.slots[2].y).toBeLessThan(rows.slots[0].y);
    const [cols] = planNUp(pagesOf(4), { ...opts, order: "columns" });
    expect(cols.slots[1].x).toBe(cols.slots[0].x);
    expect(cols.slots[1].y).toBeLessThan(cols.slots[0].y);
  });

  it("auto-orients so the pages print larger", () => {
    // Two portrait pages side by side beat stacking them.
    const [portraitPages] = planNUp(pagesOf(2), DEFAULT_NUP);
    expect(portraitPages.width).toBeGreaterThan(portraitPages.height);
    // Two landscape pages are better stacked.
    const wide = pagesOf(2, { width: 792, height: 612 });
    const [landscapePages] = planNUp(wide, DEFAULT_NUP);
    expect(landscapePages.height).toBeGreaterThan(landscapePages.width);
  });

  it("keeps every slot inside the sheet margins", () => {
    for (const perSheet of [2, 4, 6, 9, 16] as const) {
      const [plan] = planNUp(pagesOf(perSheet), { ...DEFAULT_NUP, perSheet });
      for (const s of plan.slots) {
        expect(s.x).toBeGreaterThanOrEqual(DEFAULT_NUP.margin - 1e-6);
        expect(s.y).toBeGreaterThanOrEqual(DEFAULT_NUP.margin - 1e-6);
        expect(s.x + s.width).toBeLessThanOrEqual(plan.width - DEFAULT_NUP.margin + 1e-6);
        expect(s.y + s.height).toBeLessThanOrEqual(plan.height - DEFAULT_NUP.margin + 1e-6);
      }
    }
  });
});

describe("bookletSides", () => {
  it("imposes 8 pages for saddle stitching", () => {
    expect(bookletSides(8, false)).toEqual([
      [7, 0],
      [1, 6],
      [5, 2],
      [3, 4],
    ]);
  });

  it("pads to a multiple of four with blanks (null)", () => {
    expect(bookletSides(5, false)).toEqual([
      [null, 0],
      [1, null],
      [null, 2],
      [3, 4],
    ]);
  });

  it("swaps the sides for right-to-left binding", () => {
    expect(bookletSides(4, true)).toEqual([
      [0, 3],
      [2, 1],
    ]);
  });
});

describe("planBooklet", () => {
  it("makes a landscape sheet per printed side, two pages each", () => {
    const plans = planBooklet(pagesOf(8), DEFAULT_BOOKLET);
    expect(plans).toHaveLength(layoutSheetCount(8, DEFAULT_BOOKLET));
    expect(plans[0].width).toBeGreaterThan(plans[0].height);
    expect(plans[0].slots[0].x).toBeLessThan(plans[0].slots[1].x);
  });
});

describe("rotatedOrigin", () => {
  it("puts the displayed box's lower-left corner at the target for every rotation", () => {
    // Rotate the stored page's corners by the returned transform and take the bounding box.
    const w = 100;
    const h = 40;
    for (const rotation of [0, 90, 180, 270] as const) {
      const o = rotatedOrigin(rotation, 10, 20, w, h);
      const rad = (o.angle * Math.PI) / 180;
      const pts = [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ].map(([px, py]) => [
        o.x + px * Math.cos(rad) - py * Math.sin(rad),
        o.y + px * Math.sin(rad) + py * Math.cos(rad),
      ]);
      expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(10);
      expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(20);
    }
  });
});

describe("layoutPdf", () => {
  async function fixture(pages: number) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
    return doc.save();
  }

  it("lays pages out N-up", async () => {
    const { bytes, sheets } = await layoutPdf(await fixture(5), { ...DEFAULT_NUP, perSheet: 4 });
    expect(sheets).toBe(2);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it("builds a booklet padded to a multiple of four pages", async () => {
    const { bytes, sheets } = await layoutPdf(await fixture(5), DEFAULT_BOOKLET);
    expect(sheets).toBe(4);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(4);
  });

  it("handles rotated and cropped pages", async () => {
    const doc = await PDFDocument.create();
    const a = doc.addPage([612, 792]);
    a.setRotation(degrees(90));
    const b = doc.addPage([612, 792]);
    b.setCropBox(50, 50, 300, 400);
    const { bytes } = await layoutPdf(await doc.save(), { ...DEFAULT_NUP, perSheet: 2 });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("keeps blank pages without content in their slot", async () => {
    const { bytes } = await layoutPdf(await fixture(2), { ...DEFAULT_NUP, perSheet: 2 });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
