import { describe, expect, test } from "vite-plus/test";
import { PDFDocument, PDFDict, PDFName, PDFStream, StandardFonts, degrees } from "pdf-lib";
import { exportEditedPdf } from "./exportPdf";
import {
  defaultHeaderFooter,
  defaultWatermark,
  type HeaderFooterSettings,
  type PageStamps,
  type WatermarkSettings,
} from "./pageStampsModel";
import type { PageOp } from "../store/useEditorStore";

// --- helpers ------------------------------------------------------------------

/** A source PDF whose page n carries the marker text "SRC<n>" (1-based). */
async function makeSource(
  count: number,
  opts: { size?: [number, number]; rotate?: number } = {},
): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) {
    const page = doc.addPage(opts.size ?? [600, 800]);
    page.drawText(`SRC${i + 1}`, { x: 280, y: 400, size: 12, font });
    if (opts.rotate) page.setRotation(degrees(opts.rotate));
  }
  const bytes = await doc.save();
  return new File([bytes.slice()], "contract.pdf", { type: "application/pdf" });
}

function hf(p: Partial<HeaderFooterSettings> = {}): HeaderFooterSettings {
  return { ...defaultHeaderFooter(), ...p };
}

function slots(p: Partial<HeaderFooterSettings["slots"]>): HeaderFooterSettings["slots"] {
  return { ...defaultHeaderFooter().slots, ...p };
}

function stamps(p: Partial<PageStamps>): PageStamps {
  return { headerFooter: null, watermark: null, ...p };
}

type PlacedText = {
  str: string;
  /** Baseline origin in the page's viewport (reader space: y down, rotation +
   * crop applied by pdf.js). */
  x: number;
  y: number;
  /** Visual angle of the baseline, degrees counter-clockwise (0 = upright). */
  angle: number;
  width: number;
};

type ExtractedPage = { width: number; height: number; items: PlacedText[] };

/** Extract text with reader-space positions using the pdf.js legacy build. */
async function extract(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`,
  });
  const doc = await task.promise;
  const pages: ExtractedPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const [va, vb, vc, vd, ve, vf] = vp.transform;
      const content = await page.getTextContent();
      const items: PlacedText[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const [a, b, , , e, f] = it.transform as number[];
        // viewport.transform × item.transform (only the parts we need).
        const ma = va * a + vc * b;
        const mb = vb * a + vd * b;
        items.push({
          str: it.str,
          x: va * e + vc * f + ve,
          y: vb * e + vd * f + vf,
          // Viewport y points down, so a CCW baseline has a negative mb.
          angle: Math.round((Math.atan2(-mb, ma) * 180) / Math.PI) || 0,
          width: it.width,
        });
      }
      pages.push({ width: vp.width, height: vp.height, items });
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

const texts = (p: ExtractedPage) => p.items.map((i) => i.str);
const find = (p: ExtractedPage, str: string) => {
  const item = p.items.find((i) => i.str === str);
  if (!item) throw new Error(`"${str}" not found on page; got ${texts(p).join(" | ")}`);
  return item;
};

/** Expect a stamp to sit upright inside the visible box, near a given spot. */
function expectUprightNear(
  item: PlacedText,
  page: ExtractedPage,
  at: { x?: number; y?: number; centerX?: number },
  tol = 2,
) {
  expect(item.angle).toBe(0);
  expect(item.x).toBeGreaterThanOrEqual(0);
  expect(item.x + item.width).toBeLessThanOrEqual(page.width + 0.01);
  expect(item.y).toBeGreaterThan(0);
  expect(item.y).toBeLessThan(page.height);
  if (at.x !== undefined) expect(Math.abs(item.x - at.x)).toBeLessThan(tol);
  if (at.y !== undefined) expect(Math.abs(item.y - at.y)).toBeLessThan(tol);
  if (at.centerX !== undefined)
    expect(Math.abs(item.x + item.width / 2 - at.centerX)).toBeLessThan(tol);
}

// Baselines for 10pt Helvetica with the default 24pt top/bottom margins:
// top slots hang the ascender (0.718em) from the margin; bottom slots stand
// the descender (0.207em) on it.
const TOP_BASELINE = 24 + 7.18;
const bottomBaseline = (h: number) => h - 24 - 2.07;

/** Indirect dictionaries of the saved PDF (object streams make raw-byte
 * matching useless, so inspect the parsed structure instead). */
async function dicts(bytes: Uint8Array): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .map(([, obj]) => (obj instanceof PDFStream ? obj.dict : obj))
    .filter((obj): obj is PDFDict => obj instanceof PDFDict);
}

const nameOf = (d: PDFDict, key: string) => d.lookup(PDFName.of(key))?.toString();

// --- numbering ------------------------------------------------------------------

describe("page numbers and Bates follow output order", () => {
  test("after reorder + delete, numbers count output positions", async () => {
    const file = await makeSource(4);
    const bytes = await exportEditedPdf(file, [], {
      // Page 3 deleted; remaining pages reversed.
      pageOrder: [3, 1, 0],
      pageStamps: stamps({
        headerFooter: hf({
          slots: slots({ bottomCenter: "Page {page} of {total}", bottomRight: "{bates}" }),
          bates: { prefix: "DOC-", suffix: "", start: 100, digits: 4 },
        }),
      }),
    });
    const pages = await extract(bytes);
    expect(pages).toHaveLength(3);
    expect(texts(pages[0])).toEqual(expect.arrayContaining(["SRC4", "Page 1 of 3", "DOC-0100"]));
    expect(texts(pages[1])).toEqual(expect.arrayContaining(["SRC2", "Page 2 of 3", "DOC-0101"]));
    expect(texts(pages[2])).toEqual(expect.arrayContaining(["SRC1", "Page 3 of 3", "DOC-0102"]));
  });

  test("start-number offset and a custom range", async () => {
    const file = await makeSource(4);
    const bytes = await exportEditedPdf(file, [], {
      pageStamps: stamps({
        headerFooter: hf({
          slots: slots({ topRight: "p{page}/{total} {filename}" }),
          startNumber: 10,
          pageRange: "custom",
          customRange: "2-3",
        }),
      }),
    });
    const pages = await extract(bytes);
    const stamped = pages.map((p) =>
      p.items.filter((i) => i.str.startsWith("p")).map((i) => i.str),
    );
    expect(stamped).toEqual([[], ["p11/4 contract.pdf"], ["p12/4 contract.pdf"], []]);
  });

  test("odd / even ranges use 1-based output positions", async () => {
    const file = await makeSource(4);
    const bytes = await exportEditedPdf(file, [], {
      pageStamps: stamps({
        headerFooter: hf({ slots: slots({ bottomLeft: "#{page}" }), pageRange: "even" }),
      }),
    });
    const pages = await extract(bytes);
    expect(pages.map((p) => texts(p).filter((s) => s.startsWith("#")))).toEqual([
      [],
      ["#2"],
      [],
      ["#4"],
    ]);
  });
});

// --- placement ------------------------------------------------------------------

describe("stamps land upright inside the visible box", () => {
  const corners = stamps({
    headerFooter: hf({
      slots: slots({ topLeft: "HEAD-L", topRight: "HEAD-R", bottomCenter: "FOOT-C" }),
    }),
  });

  function expectCorners(page: ExtractedPage) {
    expectUprightNear(find(page, "HEAD-L"), page, { x: 36, y: TOP_BASELINE });
    const right = find(page, "HEAD-R");
    expectUprightNear(right, page, { y: TOP_BASELINE });
    expect(Math.abs(right.x + right.width - (page.width - 36))).toBeLessThan(2);
    expectUprightNear(find(page, "FOOT-C"), page, {
      centerX: page.width / 2,
      y: bottomBaseline(page.height),
    });
  }

  test("plain page (control)", async () => {
    const pages = await extract(
      await exportEditedPdf(await makeSource(1), [], { pageStamps: corners }),
    );
    expect([pages[0].width, pages[0].height]).toEqual([600, 800]);
    expectCorners(pages[0]);
  });

  test("page rotated 90° in the editor (PageOp)", async () => {
    const pageOps: PageOp[] = [{ pageIndex: 0, rotation: 90 }];
    const pages = await extract(
      await exportEditedPdf(await makeSource(1), [], { pageOps, pageStamps: corners }),
    );
    // Portrait page now reads landscape.
    expect([pages[0].width, pages[0].height]).toEqual([800, 600]);
    expectCorners(pages[0]);
  });

  test("source page that already carries /Rotate 270", async () => {
    const pages = await extract(
      await exportEditedPdf(await makeSource(1, { rotate: 270 }), [], { pageStamps: corners }),
    );
    expect([pages[0].width, pages[0].height]).toEqual([800, 600]);
    expectCorners(pages[0]);
  });

  test("cropped page uses the crop box, not the media box", async () => {
    // 600pt-wide page renders 800px wide → 0.75 pt/px.
    const pageOps: PageOp[] = [
      { pageIndex: 0, rotation: 0, crop: { left: 100, top: 50, right: 100, bottom: 150 } },
    ];
    const pages = await extract(
      await exportEditedPdf(await makeSource(1), [], { pageOps, pageStamps: corners }),
    );
    expect(pages[0].width).toBeCloseTo(450);
    expect(pages[0].height).toBeCloseTo(650);
    expectCorners(pages[0]);
  });

  test("cropped page with a non-zero crop origin and /Rotate 180", async () => {
    const src = await PDFDocument.create();
    const page = src.addPage([600, 800]);
    page.setCropBox(50, 100, 400, 500);
    page.setRotation(degrees(180));
    const file = new File([(await src.save()).slice()], "x.pdf");
    const pages = await extract(await exportEditedPdf(file, [], { pageStamps: corners }));
    expect([pages[0].width, pages[0].height]).toEqual([400, 500]);
    expectCorners(pages[0]);
  });
});

// --- watermark ------------------------------------------------------------------

function wm(p: Partial<WatermarkSettings> = {}): WatermarkSettings {
  return { ...defaultWatermark(), text: "DRAFT", ...p };
}

describe("watermark", () => {
  test("diagonal text is centred and turns 45° as the reader sees it, even on a rotated page", async () => {
    const pageOps: PageOp[] = [{ pageIndex: 0, rotation: 90 }];
    const bytes = await exportEditedPdf(await makeSource(1), [], {
      pageOps,
      pageStamps: stamps({ watermark: wm({ rotation: 45, fontSize: 60 }) }),
    });
    const [page] = await extract(bytes);
    const item = find(page, "DRAFT");
    expect(item.angle).toBe(45);
    // Middle of the baseline, then up by the font's mid-band offset, = centre.
    const t = Math.PI / 4;
    const mid = ((718 - 207) / 2 / 1000) * 60;
    const cx = item.x + Math.cos(t) * (item.width / 2) - Math.sin(t) * mid;
    const cy = item.y - Math.sin(t) * (item.width / 2) - Math.cos(t) * mid;
    expect(Math.abs(cx - page.width / 2)).toBeLessThan(2);
    expect(Math.abs(cy - page.height / 2)).toBeLessThan(2);
    // Opacity is applied through an ExtGState.
    const out = await PDFDocument.load(bytes);
    const gs = out.getPage(0).node.Resources()?.lookup(PDFName.of("ExtGState"), PDFDict);
    const alphas = (gs?.keys() ?? []).map((k) =>
      gs?.lookup(k, PDFDict).lookup(PDFName.of("ca"))?.toString(),
    );
    expect(alphas).toContain("0.25");
  });

  test("page range limits the watermark; header/footer is independent", async () => {
    const bytes = await exportEditedPdf(await makeSource(3), [], {
      pageStamps: stamps({
        watermark: wm({ pageRange: "custom", customRange: "2" }),
        headerFooter: hf({ slots: slots({ bottomCenter: "{page}" }) }),
      }),
    });
    const pages = await extract(bytes);
    expect(pages.map((p) => texts(p).includes("DRAFT"))).toEqual([false, true, false]);
    expect(pages.map((p) => texts(p).includes(String(pages.indexOf(p) + 1)))).toEqual([
      true,
      true,
      true,
    ]);
  });

  test("image watermark is embedded once and drawn on every page", async () => {
    // 1×1 red PNG.
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
    const bytes = await exportEditedPdf(await makeSource(3), [], {
      pageStamps: stamps({ watermark: wm({ source: "image", imageDataUrl: png }) }),
    });
    const out = await PDFDocument.load(bytes);
    const images = (await dicts(bytes)).filter((d) => nameOf(d, "Subtype") === "/Image");
    expect(images).toHaveLength(1);
    for (const page of out.getPages()) {
      const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
      expect(xobjects?.keys().length).toBe(1);
    }
  });
});

describe("export details", () => {
  test("fonts are embedded once for the whole document", async () => {
    const bytes = await exportEditedPdf(await makeSource(5), [], {
      pageStamps: stamps({
        headerFooter: hf({ slots: slots({ topLeft: "A", bottomRight: "{page}" }) }),
        watermark: wm(),
      }),
    });
    const fonts = (await dicts(bytes))
      .filter((d) => nameOf(d, "Type") === "/Font")
      .map((d) => nameOf(d, "BaseFont"));
    // One Helvetica from the source + one for the stamps; one Helvetica-Bold.
    expect([...fonts].sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "/Helvetica",
      "/Helvetica",
      "/Helvetica-Bold",
    ]);
  });

  test("characters the standard fonts can't encode print as ? instead of failing", async () => {
    const bytes = await exportEditedPdf(await makeSource(1), [], {
      pageStamps: stamps({ headerFooter: hf({ slots: slots({ topCenter: "Café ✓ 日本" }) }) }),
    });
    const [page] = await extract(bytes);
    expect(texts(page)).toContain("Café ? ??");
  });

  test("no stamps leaves the export untouched", async () => {
    const file = await makeSource(2);
    const plain = await exportEditedPdf(file, [], {});
    const empty = await exportEditedPdf(file, [], {
      pageStamps: stamps({ headerFooter: hf(), watermark: wm({ text: "  " }) }),
    });
    expect(texts((await extract(empty))[0])).toEqual(texts((await extract(plain))[0]));
  });
});
