import {
  PDFArray,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFFont,
  type PDFObject,
  type PDFPage,
  type PDFRef,
} from "pdf-lib";
import {
  absolutePoints,
  arrowBarbs,
  arrowHeadLength,
  cloudOutline,
  type AnnotationEdit,
  type Pt,
} from "./annotations";
import { VIEWER_WIDTH } from "./pdfGeometry";

/*
 * Writes annotations into a PDF two ways from ONE appearance builder:
 *
 *  - "native": a real annotation dictionary (/Highlight, /Ink, /Line, /Square,
 *    /Stamp, ...) with its own appearance stream, plus reply and review-status
 *    annotations. Acrobat, Preview and pdf.js list and edit these as comments.
 *  - "flatten": the same appearance stream drawn straight into the page
 *    content, so the mark is part of the page and not a comment anymore.
 *
 * Appearance streams are written in page space (BBox = annotation Rect, no
 * Matrix), so the content stream uses page coordinates directly.
 */

export type AnnotationMode = "flatten" | "native";

type Rect4 = [number, number, number, number]; // x1 y1 x2 y2 (PDF space)

type Appearance = {
  rect: Rect4;
  content: string;
  /** Constant opacity applied to the whole appearance. */
  opacity?: number;
  /** Fonts the content stream references by resource name. */
  fonts?: Record<string, PDFRef>;
};

type NativeFields = {
  subtype: string;
  /** Extra annotation-dictionary entries beyond the common ones. */
  entries: Record<string, PDFObject>;
  /** Annotation flags; default Print. */
  flags?: number;
  /** Annotation color (/C) as RGB 0..1. */
  color: [number, number, number];
  opacity?: number;
};

type Geometry = { pageWidth: number; pageHeight: number; scale: number };

const FLAG_PRINT = 4;
const FLAG_NO_ZOOM = 8;
const FLAG_NO_ROTATE = 16;

// ── Small PDF-content helpers ──────────────────────────────────────────────

const f = (n: number) => String(+n.toFixed(3));

export function hexToUnitRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? Array.from(h, (c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const rgbOp = (c: [number, number, number], stroke: boolean) =>
  `${c.map(f).join(" ")} ${stroke ? "RG" : "rg"}`;

function ellipsePath(x: number, y: number, w: number, h: number): string {
  const k = 0.5523;
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  return [
    `${f(cx + rx)} ${f(cy)} m`,
    `${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c`,
    `${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c`,
    `${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c`,
    `${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c`,
    "h",
  ].join("\n");
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const k = 0.5523 * r;
  return [
    `${f(x + r)} ${f(y)} m`,
    `${f(x + w - r)} ${f(y)} l`,
    `${f(x + w - r + k)} ${f(y)} ${f(x + w)} ${f(y + r - k)} ${f(x + w)} ${f(y + r)} c`,
    `${f(x + w)} ${f(y + h - r)} l`,
    `${f(x + w)} ${f(y + h - r + k)} ${f(x + w - r + k)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} c`,
    `${f(x + r)} ${f(y + h)} l`,
    `${f(x + r - k)} ${f(y + h)} ${f(x)} ${f(y + h - r + k)} ${f(x)} ${f(y + h - r)} c`,
    `${f(x)} ${f(y + r)} l`,
    `${f(x)} ${f(y + r - k)} ${f(x + r - k)} ${f(y)} ${f(x + r)} ${f(y)} c`,
    "h",
  ].join("\n");
}

function boundsOf(points: Pt[], pad: number): Rect4 {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ];
}

const polyline = (pts: Pt[], close = false) =>
  pts.map((p, i) => `${f(p.x)} ${f(p.y)} ${i === 0 ? "m" : "l"}`).join("\n") + (close ? "\nh" : "");

// ── Per-document context ───────────────────────────────────────────────────

/** Per-export state: the page-independent resources shared across annotations. */
export type AnnotationContext = {
  pdfDoc: PDFDocument;
  stampFont?: PDFFont;
};

export function createAnnotationContext(pdfDoc: PDFDocument): AnnotationContext {
  return { pdfDoc };
}

async function stampFontOf(ctx: AnnotationContext): Promise<PDFFont> {
  ctx.stampFont ??= await ctx.pdfDoc.embedFont(StandardFonts.HelveticaBold);
  return ctx.stampFont;
}

// ── Appearance + native fields per annotation type ─────────────────────────

type Built = { appearance: Appearance; native: NativeFields };

async function build(
  edit: AnnotationEdit,
  g: Geometry,
  ctx: AnnotationContext,
): Promise<Built | null> {
  const { pageHeight, scale } = g;
  const P = (p: Pt): Pt => ({ x: p.x * scale, y: pageHeight - p.y * scale });
  const x = edit.x * scale;
  const w = edit.width * scale;
  const h = edit.height * scale;
  const y = pageHeight - (edit.y + edit.height) * scale;
  const boxRect: Rect4 = [x, y, x + w, y + h];
  const stroke = (hex: string) => hexToUnitRgb(hex);
  const dict = (obj: Record<string, unknown>) => ctx.pdfDoc.context.obj(obj as never);

  switch (edit.type) {
    case "highlight": {
      const color = stroke(edit.color);
      return {
        appearance: {
          rect: boxRect,
          content: `${rgbOp(color, false)} ${f(x)} ${f(y)} ${f(w)} ${f(h)} re f`,
          opacity: 0.4,
        },
        native: {
          subtype: "Highlight",
          color,
          opacity: 0.4,
          entries: { QuadPoints: quad(boxRect, ctx) },
        },
      };
    }
    case "underline":
    case "strikeout": {
      const color = stroke(edit.color);
      const t = Math.max(1, h * 0.08);
      const ruleY = edit.type === "underline" ? y + t : y + h / 2;
      return {
        appearance: {
          rect: boxRect,
          content: `${rgbOp(color, true)} ${f(t)} w ${f(x)} ${f(ruleY)} m ${f(x + w)} ${f(ruleY)} l S`,
        },
        native: {
          subtype: edit.type === "underline" ? "Underline" : "StrikeOut",
          color,
          entries: { QuadPoints: quad(boxRect, ctx) },
        },
      };
    }
    case "comment": {
      const color = stroke(edit.color);
      const size = Math.min(Math.max(w, 14), 22);
      const top = y + h;
      const rect: Rect4 = [x, top - size, x + size, top];
      const lines = [0.3, 0.5, 0.7]
        .map((k) => {
          const ly = top - size * k;
          return `${f(x + size * 0.2)} ${f(ly)} m ${f(x + size * 0.8)} ${f(ly)} l S`;
        })
        .join(" ");
      return {
        appearance: {
          rect,
          content: [
            `${rgbOp(color, false)} 0.2 0.2 0.2 RG 0.75 w`,
            `${f(rect[0])} ${f(rect[1])} ${f(size)} ${f(size)} re B`,
            `0.25 0.25 0.25 RG 0.6 w ${lines}`,
          ].join("\n"),
        },
        native: {
          subtype: "Text",
          color,
          flags: FLAG_PRINT | FLAG_NO_ZOOM | FLAG_NO_ROTATE,
          entries: { Name: PDFName.of("Comment"), Open: ctx.pdfDoc.context.obj(false) },
        },
      };
    }
    case "ink": {
      const color = stroke(edit.color);
      const pts = absolutePoints(edit).map(P);
      if (pts.length < 2) return null;
      const sw = edit.strokeWidth * scale;
      const rect = boundsOf(pts, sw / 2 + 1);
      return {
        appearance: {
          rect,
          content: `${rgbOp(color, true)} ${f(sw)} w 1 J 1 j\n${polyline(pts)}\nS`,
        },
        native: {
          subtype: "Ink",
          color,
          entries: {
            InkList: ctx.pdfDoc.context.obj([pts.flatMap((p) => [p.x, p.y])]),
            BS: dict({ W: sw }),
          },
        },
      };
    }
    case "rectangle": {
      const color = stroke(edit.color ?? "#000000");
      const sw = (edit.strokeWidth ?? 1) * (edit.strokeWidth ? scale : 1);
      return {
        appearance: {
          rect: boxRect,
          content: `${rgbOp(color, true)} ${f(sw)} w ${f(x + sw / 2)} ${f(y + sw / 2)} ${f(
            Math.max(0, w - sw),
          )} ${f(Math.max(0, h - sw))} re S`,
        },
        native: { subtype: "Square", color, entries: { BS: dict({ W: sw }) } },
      };
    }
    case "oval": {
      const color = stroke(edit.color);
      const sw = edit.strokeWidth * scale;
      return {
        appearance: {
          rect: boxRect,
          content: `${rgbOp(color, true)} ${f(sw)} w\n${ellipsePath(
            x + sw / 2,
            y + sw / 2,
            Math.max(0, w - sw),
            Math.max(0, h - sw),
          )}\nS`,
        },
        native: { subtype: "Circle", color, entries: { BS: dict({ W: sw }) } },
      };
    }
    case "cloud": {
      const color = stroke(edit.color);
      const sw = edit.strokeWidth * scale;
      const { start, segments } = cloudOutline(edit.width, edit.height);
      const at = (p: Pt) => P({ x: edit.x + p.x, y: edit.y + p.y });
      const s0 = at(start);
      const path =
        `${f(s0.x)} ${f(s0.y)} m\n` +
        segments
          .map((s) => {
            const c1 = at(s.c1);
            const c2 = at(s.c2);
            const to = at(s.to);
            return `${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(to.x)} ${f(to.y)} c`;
          })
          .join("\n") +
        "\nh";
      return {
        appearance: {
          rect: boxRect,
          content: `${rgbOp(color, true)} ${f(sw)} w 1 j\n${path}\nS`,
        },
        native: {
          subtype: "Square",
          color,
          entries: {
            BS: dict({ W: sw }),
            // Border effect "cloudy": how Acrobat marks a cloud rectangle.
            BE: dict({ S: PDFName.of("C"), I: 1 }),
          },
        },
      };
    }
    case "line":
    case "arrow": {
      const color = stroke(edit.color);
      const [a, b] = absolutePoints(edit);
      if (!a || !b) return null;
      const A = P(a);
      const B = P(b);
      const sw = edit.strokeWidth * scale;
      const head = edit.type === "arrow" ? arrowHeadLength(edit.strokeWidth) * scale : 0;
      let content = `${rgbOp(color, true)} ${f(sw)} w 1 J 1 j\n${polyline([A, B])}\nS`;
      if (head) {
        const [b1, b2] = arrowBarbs(A, B, head);
        content += `\n${polyline([b1, B, b2])}\nS`;
      }
      return {
        appearance: { rect: boundsOf([A, B], sw / 2 + head), content },
        native: {
          subtype: "Line",
          color,
          entries: {
            L: ctx.pdfDoc.context.obj([A.x, A.y, B.x, B.y]),
            LE: ctx.pdfDoc.context.obj([
              PDFName.of("None"),
              PDFName.of(edit.type === "arrow" ? "OpenArrow" : "None"),
            ]),
            BS: dict({ W: sw }),
          },
        },
      };
    }
    case "polygon": {
      const color = stroke(edit.color);
      const pts = absolutePoints(edit).map(P);
      if (pts.length < 3) return null;
      const sw = edit.strokeWidth * scale;
      return {
        appearance: {
          rect: boundsOf(pts, sw / 2 + 1),
          content: `${rgbOp(color, true)} ${f(sw)} w 1 J 1 j\n${polyline(pts, true)}\nS`,
        },
        native: {
          subtype: "Polygon",
          color,
          entries: {
            Vertices: ctx.pdfDoc.context.obj(pts.flatMap((p) => [p.x, p.y])),
            BS: dict({ W: sw }),
          },
        },
      };
    }
    case "stamp": {
      const color = stroke(edit.color);
      const font = await stampFontOf(ctx);
      const supported = new Set(font.getCharacterSet());
      const label = Array.from(edit.label)
        .filter((ch) => supported.has(ch.codePointAt(0)!))
        .join("");
      const bw = Math.max(1.5, h * 0.07);
      const pad = bw + h * 0.12;
      const natural = Math.max(font.widthOfTextAtSize(label, 1), 0.01);
      const fontSize = Math.min(h * 0.5, (w - 2 * pad) / natural);
      const textW = font.widthOfTextAtSize(label, fontSize);
      const tx = x + (w - textW) / 2;
      const ty = y + (h - font.heightAtSize(fontSize, { descender: false })) / 2;
      return {
        appearance: {
          rect: boxRect,
          content: [
            `${rgbOp(color, true)} ${f(bw)} w`,
            roundedRectPath(x + bw / 2, y + bw / 2, w - bw, h - bw, Math.min(h * 0.2, 8)),
            "S",
            `BT /StampFont ${f(fontSize)} Tf ${rgbOp(color, false)} ${f(tx)} ${f(ty)} Td ${font
              .encodeText(label)
              .toString()} Tj ET`,
          ].join("\n"),
          fonts: { StampFont: font.ref },
        },
        native: { subtype: "Stamp", color, entries: { Name: PDFName.of(edit.stamp) } },
      };
    }
  }
}

function quad(r: Rect4, ctx: AnnotationContext): PDFArray {
  const [x1, y1, x2, y2] = r;
  return ctx.pdfDoc.context.obj([x1, y2, x2, y2, x1, y1, x2, y1]);
}

/** Register the appearance as a form XObject and return its reference. */
function appearanceStream(ctx: AnnotationContext, ap: Appearance): PDFRef {
  const { context } = ctx.pdfDoc;
  const resources: Record<string, unknown> = {};
  let content = ap.content;
  if (ap.opacity !== undefined) {
    resources.ExtGState = { GS0: { Type: "ExtGState", ca: ap.opacity, CA: ap.opacity } };
    content = `/GS0 gs\n${content}`;
  }
  if (ap.fonts) resources.Font = ap.fonts;
  const stream = context.stream(content, {
    Type: "XObject",
    Subtype: "Form",
    FormType: 1,
    BBox: ap.rect,
    Resources: context.obj(resources as never),
  });
  return context.register(stream);
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Draw an annotation into the page content (no annotation dictionary). */
export async function flattenAnnotation(
  ctx: AnnotationContext,
  page: PDFPage,
  edit: AnnotationEdit,
): Promise<void> {
  const built = await build(edit, geometryOf(page), ctx);
  if (!built) return;
  const ref = appearanceStream(ctx, built.appearance);
  const name = page.node.newXObject("Annot", ref);
  page.pushOperators(pushGraphicsState(), drawObject(name), popGraphicsState());
}

/** Write an annotation as a native PDF annotation, with replies and status. */
export async function writeNativeAnnotation(
  ctx: AnnotationContext,
  page: PDFPage,
  edit: AnnotationEdit,
): Promise<void> {
  const built = await build(edit, geometryOf(page), ctx);
  if (!built) return;
  const { context } = ctx.pdfDoc;
  const { appearance, native } = built;

  const modified = edit.modifiedAt ?? edit.createdAt ?? Date.now();
  const common: Record<string, PDFObject> = {
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of(native.subtype),
    Rect: context.obj(appearance.rect),
    F: PDFNumber.of(native.flags ?? FLAG_PRINT),
    C: context.obj(native.color),
    NM: PDFHexString.fromText(edit.id),
    M: PDFString.of(pdfDateString(modified)),
    P: page.ref,
    AP: context.obj({ N: appearanceStream(ctx, appearance) }),
    ...native.entries,
  };
  if (edit.createdAt) common.CreationDate = PDFString.of(pdfDateString(edit.createdAt));
  if (native.opacity !== undefined) common.CA = PDFNumber.of(native.opacity);
  if (edit.text?.trim()) common.Contents = PDFHexString.fromText(edit.text);
  if (edit.author) common.T = PDFHexString.fromText(edit.author);

  const parentRef = context.register(context.obj(common as never));
  page.node.addAnnot(parentRef);

  // Replies and the review status are Text annotations "in reply to" the
  // parent (/IRT, /RT /R). They get an empty appearance so no viewer draws
  // a stray icon for them; the parent's marker stays the only visible mark.
  const [rx1, ry1] = appearance.rect;
  const emptyAp = appearanceStream(ctx, { rect: [rx1, ry1, rx1 + 1, ry1 + 1], content: "" });
  const replyBase = (id: string, author: string | undefined, at: number) => {
    const d: Record<string, PDFObject> = {
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Text"),
      Rect: context.obj([rx1, ry1, rx1 + 1, ry1 + 1]),
      F: PDFNumber.of(FLAG_PRINT | FLAG_NO_ZOOM | FLAG_NO_ROTATE),
      NM: PDFHexString.fromText(id),
      M: PDFString.of(pdfDateString(at)),
      CreationDate: PDFString.of(pdfDateString(at)),
      P: page.ref,
      IRT: parentRef,
      RT: PDFName.of("R"),
      Name: PDFName.of("Comment"),
      AP: context.obj({ N: emptyAp }),
    };
    if (author) d.T = PDFHexString.fromText(author);
    return d;
  };

  if (edit.status && edit.status !== "none") {
    const d = replyBase(`${edit.id}-status`, edit.author, modified);
    d.State = PDFString.of(STATE_NAME[edit.status]);
    d.StateModel = PDFString.of("Review");
    page.node.addAnnot(context.register(context.obj(d as never)));
  }
  for (const reply of edit.replies ?? []) {
    const d = replyBase(reply.id, reply.author, reply.createdAt);
    d.Contents = PDFHexString.fromText(reply.text);
    page.node.addAnnot(context.register(context.obj(d as never)));
  }
}

const STATE_NAME = {
  none: "None",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  completed: "Completed",
} as const;

function geometryOf(page: PDFPage): Geometry {
  const pageWidth = page.getWidth();
  return { pageWidth, pageHeight: page.getHeight(), scale: pageWidth / VIEWER_WIDTH };
}

/** PDF date string: D:YYYYMMDDHHmmSSZ (UTC). */
export function pdfDateString(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(
    d.getUTCHours(),
  )}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Types whose flatten path is the shared appearance builder. The older types
 * (highlight, underline, strikeout, comment, ink) keep their original drawing
 * code in exportPdf.ts so existing output is byte-for-byte unchanged. */
export function usesSharedFlatten(edit: AnnotationEdit): boolean {
  return (
    edit.type === "line" ||
    edit.type === "arrow" ||
    edit.type === "oval" ||
    edit.type === "polygon" ||
    edit.type === "cloud" ||
    edit.type === "stamp"
  );
}
