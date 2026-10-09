import type {
  CommentEdit,
  CommentFields,
  CommentReply,
  InkEdit,
  MarkupEdit,
  PdfEdit,
  RectangleEdit,
  ReviewStatus,
  ShapeEdit,
  StampEdit,
} from "../store/useEditorStore";

/*
 * Pure helpers for the comment / markup annotation family: which edits are
 * annotations, their labels, stamp presets, shape geometry, and the thread
 * metadata. No pdf-lib or DOM here — the panel, the drawing layers, the native
 * PDF writer and the XFDF codec all share it.
 */

/** Every edit type that is a markup/comment annotation (as opposed to page
 * content like text boxes and images, or redaction marks). */
export type AnnotationEdit =
  | MarkupEdit
  | CommentEdit
  | InkEdit
  | RectangleEdit
  | ShapeEdit
  | StampEdit;

export type AnnotationType = AnnotationEdit["type"];

const ANNOTATION_TYPES: ReadonlySet<string> = new Set<AnnotationType>([
  "highlight",
  "underline",
  "strikeout",
  "comment",
  "ink",
  "rectangle",
  "line",
  "arrow",
  "oval",
  "polygon",
  "cloud",
  "stamp",
]);

export function isAnnotation(edit: PdfEdit): edit is AnnotationEdit {
  return ANNOTATION_TYPES.has(edit.type);
}

export const ANNOTATION_LABEL: Record<AnnotationType, string> = {
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "Strikeout",
  comment: "Sticky note",
  ink: "Drawing",
  rectangle: "Rectangle",
  line: "Line",
  arrow: "Arrow",
  oval: "Oval",
  polygon: "Polygon",
  cloud: "Cloud",
  stamp: "Stamp",
};

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  none: "No status",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const REVIEW_STATUSES = Object.keys(STATUS_LABEL) as ReviewStatus[];

/** Default colors for each tool. */
export const ANNOTATION_COLOR = {
  highlight: "#ffe066",
  underline: "#e03131",
  strikeout: "#e03131",
  comment: "#ffd43b",
  ink: "#1971c2",
  shape: "#e03131",
} as const;

export const SHAPE_STROKE = 2;

// ── Stamps ─────────────────────────────────────────────────────────────────

/** The standard PDF stamp names (PDF 32000 §12.5.6.12), so a stamp keeps its
 * identity when written as a native /Stamp annotation or an XFDF `icon`. */
export type StampPreset = { id: string; label: string; color: string };

export const STAMP_PRESETS: StampPreset[] = [
  { id: "Approved", label: "APPROVED", color: "#2f9e44" },
  { id: "NotApproved", label: "NOT APPROVED", color: "#e03131" },
  { id: "Draft", label: "DRAFT", color: "#e8590c" },
  { id: "Final", label: "FINAL", color: "#2f9e44" },
  { id: "ForComment", label: "FOR COMMENT", color: "#1971c2" },
  { id: "Confidential", label: "CONFIDENTIAL", color: "#e03131" },
  { id: "ForPublicRelease", label: "FOR PUBLIC RELEASE", color: "#2f9e44" },
  { id: "NotForPublicRelease", label: "NOT FOR PUBLIC RELEASE", color: "#e03131" },
  { id: "Departmental", label: "DEPARTMENTAL", color: "#1971c2" },
  { id: "Experimental", label: "EXPERIMENTAL", color: "#e8590c" },
  { id: "AsIs", label: "AS IS", color: "#1971c2" },
  { id: "Expired", label: "EXPIRED", color: "#e03131" },
  { id: "Sold", label: "SOLD", color: "#e03131" },
  { id: "TopSecret", label: "TOP SECRET", color: "#e03131" },
];

export function stampPreset(id: string): StampPreset | undefined {
  return STAMP_PRESETS.find((p) => p.id.toLowerCase() === id.toLowerCase());
}

/** Default on-page size of a stamp (screen px) — wider for longer labels. */
export function stampSize(label: string): { width: number; height: number } {
  const height = 40;
  return { width: Math.max(110, Math.round(label.length * 12 + 28)), height };
}

// ── Thread metadata ────────────────────────────────────────────────────────

/** Author + timestamps for a freshly created annotation. */
export function newCommentMeta(author: string, now = Date.now()): CommentFields {
  return { author, createdAt: now, modifiedAt: now };
}

export function newReply(author: string, text: string, now = Date.now()): CommentReply {
  return { id: crypto.randomUUID(), author, text, createdAt: now };
}

/** The note shown for an annotation: its own text, or the type as a fallback. */
export function annotationTitle(edit: AnnotationEdit): string {
  const text = edit.text?.trim();
  if (text) return text;
  return edit.type === "stamp" ? `Stamp: ${edit.label}` : ANNOTATION_LABEL[edit.type];
}

// ── Geometry ───────────────────────────────────────────────────────────────

export type Pt = { x: number; y: number };

/** Bounding box (padded) of absolute points, with the points re-expressed
 * relative to the box — the shape ink/line/polygon edits are stored in. */
export function boxFromPoints(
  points: Pt[],
  pad: number,
): { x: number; y: number; width: number; height: number; points: Pt[] } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return {
    x,
    y,
    width: Math.max(...xs) - Math.min(...xs) + pad * 2,
    height: Math.max(...ys) - Math.min(...ys) + pad * 2,
    points: points.map((p) => ({ x: p.x - x, y: p.y - y })),
  };
}

/** Padding around a line/arrow/polygon's points so strokes and arrowheads stay
 * inside the edit's box. */
export function shapePad(strokeWidth: number): number {
  return Math.max(8, strokeWidth * 3);
}

/** Arrowhead length in screen px for a given stroke width. */
export function arrowHeadLength(strokeWidth: number): number {
  return Math.max(10, strokeWidth * 4.5);
}

/** The two barbs of an open arrowhead whose tip is `tip`, for a line coming
 * from `from`. */
export function arrowBarbs(from: Pt, tip: Pt, headLength: number): [Pt, Pt] {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = Math.PI / 7;
  return [
    {
      x: tip.x - headLength * Math.cos(angle - spread),
      y: tip.y - headLength * Math.sin(angle - spread),
    },
    {
      x: tip.x - headLength * Math.cos(angle + spread),
      y: tip.y - headLength * Math.sin(angle + spread),
    },
  ];
}

/** Absolute (page-space) points of a points-carrying edit. */
export function absolutePoints(edit: { x: number; y: number; points?: Pt[] }): Pt[] {
  return (edit.points ?? []).map((p) => ({ x: edit.x + p.x, y: edit.y + p.y }));
}

/** Rescale a points array when its box is resized from `from` to `to`. */
export function scalePoints(
  points: Pt[],
  from: { width: number; height: number },
  to: { width: number; height: number },
): Pt[] {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}

// ── Cloud outline ──────────────────────────────────────────────────────────

/** One bezier segment of a cloud outline (cubic, absolute coordinates). */
export type CubicSegment = { c1: Pt; c2: Pt; to: Pt };

const KAPPA = 0.5523;

/**
 * The scalloped outline of a "cloud" rectangle: a closed path starting at the
 * top-left corner, clockwise (screen space, y down), made of cubic beziers —
 * one pair per scallop (a flattened semicircle bulging outward). Drawn inside
 * (0,0)-(width,height); `bulge` is how far the scallops reach inward from the
 * box edge, so the whole outline stays inside the box. The same segments feed
 * the on-screen SVG and the PDF content stream, so they always match.
 */
export function cloudOutline(
  width: number,
  height: number,
  scallop = 22,
): { start: Pt; segments: CubicSegment[] } {
  const bulge = Math.max(2, scallop * 0.4);
  // The scallops' outermost points touch the box; the straight skeleton they
  // sit on is inset by `bulge`.
  const x0 = bulge;
  const y0 = bulge;
  const x1 = Math.max(x0 + 1, width - bulge);
  const y1 = Math.max(y0 + 1, height - bulge);

  const corners: Pt[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  // Outward normals for the clockwise edges: top, right, bottom, left.
  const normals: Pt[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];

  const segments: CubicSegment[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.round(len / scallop));
    const n = normals[i];
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const chord = len / count;
    const r = chord / 2;
    for (let k = 0; k < count; k++) {
      const p0 = { x: a.x + ux * chord * k, y: a.y + uy * chord * k };
      const p1 = { x: a.x + ux * chord * (k + 1), y: a.y + uy * chord * (k + 1) };
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const top = { x: mid.x + n.x * bulge, y: mid.y + n.y * bulge };
      segments.push({
        c1: { x: p0.x + n.x * bulge * KAPPA * 1.0, y: p0.y + n.y * bulge * KAPPA * 1.0 },
        c2: { x: top.x - ux * r * KAPPA, y: top.y - uy * r * KAPPA },
        to: top,
      });
      segments.push({
        c1: { x: top.x + ux * r * KAPPA, y: top.y + uy * r * KAPPA },
        c2: { x: p1.x + n.x * bulge * KAPPA, y: p1.y + n.y * bulge * KAPPA },
        to: p1,
      });
    }
  }
  return { start: corners[0], segments };
}

/** The cloud outline as an SVG path string. */
export function cloudSvgPath(width: number, height: number, scallop = 22): string {
  const { start, segments } = cloudOutline(width, height, scallop);
  const f = (n: number) => +n.toFixed(2);
  return (
    `M${f(start.x)} ${f(start.y)}` +
    segments
      .map((s) => `C${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.to.x)} ${f(s.to.y)}`)
      .join("") +
    "Z"
  );
}

// ── Review-status helpers ──────────────────────────────────────────────────

export function statusOf(edit: AnnotationEdit): ReviewStatus {
  return edit.status ?? "none";
}
