/**
 * Annotation export: every annotation type written both ways (flattened into
 * the page, and as native PDF annotations). The structure tests read the
 * output with pdf-lib; the pixel tests render it with pdf.js (through the
 * @napi-rs/canvas that pdfjs-dist depends on) so we know real viewers actually
 * draw the appearance streams we write.
 */
import { beforeAll, expect, test } from "vite-plus/test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { exportEditedPdf } from "./exportPdf";
import { boxFromPoints, stampPreset, type AnnotationEdit } from "./annotations";
import type { PdfEdit } from "../store/useEditorStore";

type LoadingTask = { promise: Promise<PDFDocumentProxy>; destroy(): Promise<void> };
type PdfJsModule = { getDocument(params: Record<string, unknown>): LoadingTask };
type NapiCanvas = {
  getContext(kind: "2d"): {
    fillStyle: string;
    fillRect(x: number, y: number, w: number, h: number): void;
    getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  };
  toBuffer(mime: "image/png"): Uint8Array;
};

const req = createRequire(import.meta.url);
const pdfjsPath = req.resolve("pdfjs-dist/legacy/build/pdf.mjs");
const standardFontDataUrl = path.resolve(path.dirname(pdfjsPath), "../../standard_fonts") + "/";
let pdfjs: PdfJsModule;
let createCanvas: (w: number, h: number) => NapiCanvas;

beforeAll(async () => {
  pdfjs = (await import(/* @vite-ignore */ pathToFileURL(pdfjsPath).href)) as PdfJsModule;
  createCanvas = (
    createRequire(pdfjsPath)("@napi-rs/canvas") as { createCanvas: typeof createCanvas }
  ).createCanvas;
});

// A 400x400pt page renders at 800px width => scale 2 => screen px == canvas px
// when rendered at viewport scale 2.
const PAGE = 400;
const SCALE = 2;

async function blankPdf(): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE, PAGE]);
  return new File([(await doc.save()).slice()], "blank.pdf", { type: "application/pdf" });
}

/** Render page 1 at 800px wide and return a pixel probe (screen coordinates). */
async function render(bytes: Uint8Array, dump?: string) {
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    // "print" intent paints annotation appearances flagged Print, like the app.
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
      intent: "print",
    }).promise;
    if (dump && process.env.ANNOT_DUMP) {
      mkdirSync(process.env.ANNOT_DUMP, { recursive: true });
      writeFileSync(path.join(process.env.ANNOT_DUMP, dump), canvas.toBuffer("image/png"));
    }
    return {
      /** RGB at a screen-space point. */
      at(x: number, y: number): [number, number, number] {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return [d[0], d[1], d[2]];
      },
      /** True if anything non-white sits within `r` px of the point. */
      inked(x: number, y: number, r = 3): boolean {
        const d = ctx.getImageData(Math.round(x) - r, Math.round(y) - r, r * 2 + 1, r * 2 + 1).data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) return true;
        }
        return false;
      },
    };
  } finally {
    await task.destroy();
  }
}

const base = { pageIndex: 0, author: "Ada", createdAt: Date.UTC(2026, 0, 2, 3, 4, 5) } as const;

function allShapes(): AnnotationEdit[] {
  const line = boxFromPoints(
    [
      { x: 40, y: 60 },
      { x: 200, y: 60 },
    ],
    8,
  );
  const arrow = boxFromPoints(
    [
      { x: 40, y: 120 },
      { x: 200, y: 160 },
    ],
    12,
  );
  const poly = boxFromPoints(
    [
      { x: 300, y: 40 },
      { x: 380, y: 90 },
      { x: 340, y: 140 },
      { x: 290, y: 100 },
    ],
    8,
  );
  const stamp = stampPreset("Approved")!;
  return [
    { ...base, id: "line", type: "line", ...line, color: "#e03131", strokeWidth: 3 },
    { ...base, id: "arrow", type: "arrow", ...arrow, color: "#1971c2", strokeWidth: 3 },
    { ...base, id: "poly", type: "polygon", ...poly, color: "#2f9e44", strokeWidth: 3 },
    {
      ...base,
      id: "oval",
      type: "oval",
      x: 40,
      y: 220,
      width: 160,
      height: 90,
      color: "#e8590c",
      strokeWidth: 3,
    },
    {
      ...base,
      id: "cloud",
      type: "cloud",
      x: 240,
      y: 220,
      width: 200,
      height: 110,
      color: "#7048e8",
      strokeWidth: 2,
    },
    {
      ...base,
      id: "stamp",
      type: "stamp",
      x: 40,
      y: 360,
      width: 170,
      height: 40,
      stamp: stamp.id,
      label: stamp.label,
      color: stamp.color,
    },
    {
      ...base,
      id: "rect",
      type: "rectangle",
      x: 460,
      y: 60,
      width: 120,
      height: 60,
      color: "#e03131",
      strokeWidth: 3,
    },
    {
      ...base,
      id: "hl",
      type: "highlight",
      x: 460,
      y: 160,
      width: 140,
      height: 24,
      color: "#ffe066",
    },
    {
      ...base,
      id: "ul",
      type: "underline",
      x: 460,
      y: 220,
      width: 140,
      height: 24,
      color: "#e03131",
    },
    {
      ...base,
      id: "so",
      type: "strikeout",
      x: 460,
      y: 280,
      width: 140,
      height: 24,
      color: "#e03131",
    },
    {
      ...base,
      id: "ink",
      type: "ink",
      ...boxFromPoints(
        [
          { x: 480, y: 360 },
          { x: 520, y: 340 },
          { x: 560, y: 380 },
          { x: 600, y: 350 },
        ],
        3,
      ),
      color: "#1971c2",
      strokeWidth: 3,
    },
    {
      ...base,
      id: "note",
      type: "comment",
      x: 700,
      y: 40,
      width: 20,
      height: 20,
      text: "Check this",
      color: "#ffd43b",
    },
  ];
}

/** Probe points (screen px) that must be inked when every shape is drawn. */
const PROBES: Record<string, [number, number][]> = {
  line: [[120, 60]],
  arrow: [[120, 140]],
  poly: [[340, 65]],
  oval: [[120, 220]],
  cloud: [[340, 222]],
  stamp: [[40, 380]],
  rect: [[520, 60]],
  hl: [[520, 172]],
  ul: [[520, 242]],
  so: [[520, 292]],
  ink: [[520, 340]],
  note: [[708, 50]],
};

async function exportWith(edits: PdfEdit[], mode: "flatten" | "native") {
  return exportEditedPdf(await blankPdf(), edits, { annotations: mode });
}

for (const mode of ["flatten", "native"] as const) {
  test(`${mode}: every annotation type is painted`, async () => {
    const bytes = await exportWith(allShapes(), mode);
    const view = await render(bytes, `${mode}.png`);
    for (const [id, points] of Object.entries(PROBES)) {
      for (const [x, y] of points) {
        expect(view.inked(x, y), `${mode} ${id} at ${x},${y}`).toBe(true);
      }
    }
    // Empty areas stay empty.
    expect(view.inked(700, 700, 5)).toBe(false);
  });
}

test("flatten writes no annotation dictionaries", async () => {
  const bytes = await exportWith(allShapes(), "flatten");
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
});

test("default (no option) is flatten", async () => {
  const bytes = await exportEditedPdf(await blankPdf(), allShapes());
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
});

/** All annotation dicts on page 1, keyed by /NM. */
async function annotsOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots();
  const out = new Map<string, PDFDict>();
  if (!annots) return out;
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookup(i, PDFDict);
    out.set((dict.lookup(PDFName.of("NM")) as PDFHexString | PDFString).decodeText(), dict);
  }
  return out;
}

const subtypeOf = (d: PDFDict) => (d.get(PDFName.of("Subtype")) as PDFName).asString();

test("native: each type becomes the matching annotation subtype", async () => {
  const annots = await annotsOf(await exportWith(allShapes(), "native"));
  const subtypes = Object.fromEntries([...annots].map(([id, d]) => [id, subtypeOf(d)]));
  expect(subtypes).toEqual({
    line: "/Line",
    arrow: "/Line",
    poly: "/Polygon",
    oval: "/Circle",
    cloud: "/Square",
    stamp: "/Stamp",
    rect: "/Square",
    hl: "/Highlight",
    ul: "/Underline",
    so: "/StrikeOut",
    ink: "/Ink",
    note: "/Text",
  });
  // Cloud is a Square with a cloudy border effect.
  expect(annots.get("cloud")!.has(PDFName.of("BE"))).toBe(true);
  expect(annots.get("rect")!.has(PDFName.of("BE"))).toBe(false);
  // Arrow has an arrowhead line ending; plain line does not.
  const ends = (id: string) =>
    (annots.get(id)!.lookup(PDFName.of("LE"), PDFArray) as PDFArray)
      .asArray()
      .map((n) => (n as PDFName).asString());
  expect(ends("arrow")).toEqual(["/None", "/OpenArrow"]);
  expect(ends("line")).toEqual(["/None", "/None"]);
  expect((annots.get("stamp")!.get(PDFName.of("Name")) as PDFName).asString()).toBe("/Approved");
});

test("native: every annotation has an appearance and a page reference", async () => {
  const doc = await PDFDocument.load(await exportWith(allShapes(), "native"));
  const annots = doc.getPage(0).node.Annots()!;
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookup(i, PDFDict);
    expect(dict.has(PDFName.of("AP"))).toBe(true);
    expect(dict.get(PDFName.of("P"))).toBe(doc.getPage(0).ref);
  }
});

test("native: author, contents, dates and opacity are written", async () => {
  const edits = allShapes().map((e) => (e.id === "hl" ? { ...e, text: "Résumé — “quoted”" } : e));
  const annots = await annotsOf(await exportWith(edits, "native"));
  const hl = annots.get("hl")!;
  const text = (key: string) =>
    (hl.lookup(PDFName.of(key)) as PDFHexString | PDFString).decodeText();
  expect(text("Contents")).toBe("Résumé — “quoted”");
  expect(text("T")).toBe("Ada");
  expect(text("CreationDate")).toBe("D:20260102030405Z");
  expect(hl.get(PDFName.of("CA"))?.toString()).toBe("0.4");
});

test("native: replies and review status are Text annotations in reply to the parent", async () => {
  const edits = allShapes().map((e) =>
    e.id === "hl"
      ? {
          ...e,
          text: "Why this?",
          status: "accepted" as const,
          replies: [
            { id: "r1", author: "Bob", text: "Because.", createdAt: Date.UTC(2026, 0, 3) },
            { id: "r2", author: "Ada", text: "OK", createdAt: Date.UTC(2026, 0, 4) },
          ],
        }
      : e,
  );
  const annots = await annotsOf(await exportWith(edits, "native"));
  const parent = annots.get("hl")!;
  for (const id of ["r1", "r2", "hl-status"]) {
    const d = annots.get(id)!;
    expect(subtypeOf(d)).toBe("/Text");
    // /IRT resolves to the parent dict, and the relationship is a reply.
    expect(d.lookup(PDFName.of("IRT"))).toBe(parent);
    expect((d.get(PDFName.of("RT")) as PDFName).asString()).toBe("/R");
  }
  const status = annots.get("hl-status")!;
  expect((status.get(PDFName.of("State")) as PDFString).decodeText()).toBe("Accepted");
  expect((status.get(PDFName.of("StateModel")) as PDFString).decodeText()).toBe("Review");
  expect((annots.get("r1")!.lookup(PDFName.of("Contents")) as PDFHexString).decodeText()).toBe(
    "Because.",
  );
  // Replies must not paint anything of their own.
  const view = await render(await exportWith(edits, "native"));
  expect(view.inked(100, 700, 5)).toBe(false);
});

test("native: a 'none' status writes no state annotation", async () => {
  const edits = allShapes().map((e) => (e.id === "hl" ? { ...e, status: "none" as const } : e));
  const annots = await annotsOf(await exportWith(edits, "native"));
  expect(annots.has("hl-status")).toBe(false);
});

test("native: existing annotations on the page are kept", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE, PAGE]);
  const existing = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [0, 0, 10, 10],
      NM: PDFString.of("old"),
    }),
  );
  page.node.addAnnot(existing);
  const file = new File([(await doc.save()).slice()], "x.pdf");
  const out = await exportEditedPdf(file, allShapes().slice(0, 1), { annotations: "native" });
  const annots = await annotsOf(out);
  expect(annots.has("old")).toBe(true);
  expect(annots.has("line")).toBe(true);
});

test("a deleted page's annotations are dropped, others land on the right output page", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE, PAGE]);
  doc.addPage([PAGE, PAGE]);
  const file = new File([(await doc.save()).slice()], "two.pdf");
  const [first] = allShapes();
  const out = await exportEditedPdf(
    file,
    [
      { ...first, id: "gone", pageIndex: 0 },
      { ...first, id: "kept", pageIndex: 1 },
    ],
    { annotations: "native", pageOrder: [1] },
  );
  const loaded = await PDFDocument.load(out);
  expect(loaded.getPageCount()).toBe(1);
  const annots = loaded.getPage(0).node.Annots()!;
  expect(annots.size()).toBe(1);
  expect((annots.lookup(0, PDFDict).lookup(PDFName.of("NM")) as PDFHexString).decodeText()).toBe(
    "kept",
  );
});

test("native: names with PDF syntax characters are written as safe strings", async () => {
  const evil = "a) /A << /S /JavaScript /JS (app.alert\\(1\\)) >> /X (";
  const edits = [{ ...allShapes()[0], id: evil }];
  const doc = await PDFDocument.load(await exportWith(edits, "native"));
  const dict = doc.getPage(0).node.Annots()!.lookup(0, PDFDict);
  expect(dict.has(PDFName.of("A"))).toBe(false);
  expect((dict.lookup(PDFName.of("NM")) as PDFHexString).decodeText()).toBe(evil);
});
