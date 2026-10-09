import type { PdfEdit, ReviewStatus, CommentReply } from "../store/useEditorStore";
import {
  ANNOTATION_COLOR,
  formatPdfDate,
  parsePdfDate,
  ANNOTATION_LABEL,
  SHAPE_STROKE,
  absolutePoints,
  boxFromPoints,
  isAnnotation,
  shapePad,
  stampPreset,
  stampSize,
  type AnnotationEdit,
  type Pt,
} from "./annotations";
import { VIEWER_WIDTH } from "./pdfGeometry";
import { childrenNamed, escapeXml, firstChild, parseXml, type XmlNode } from "./xml";

/*
 * XFDF (ISO 19444-1) comments: the XML interchange format Acrobat and most PDF
 * tools use to move annotations between copies of a document.
 *
 * Coordinates: XFDF is in PDF user space (points, origin bottom-left) with
 * 0-based page numbers; the editor is in 800px screen space (origin top-left).
 * `ctx.pageSize` supplies each page's size so we can convert at the boundary.
 *
 * Page numbering follows what the user sees: page N in the file is the N-th
 * *visible* page (`ctx.pageOrder`), matching what a download would contain.
 */

export type XfdfPageSize = { width: number; height: number };

export type XfdfContext = {
  /** Original page indices in visible order. */
  pageOrder: number[];
  /** PDF-point size of an ORIGINAL page, or undefined when unknown. */
  pageSize: (originalIndex: number) => XfdfPageSize | undefined;
};

export { formatPdfDate, parsePdfDate };

const XFDF_NS = "http://ns.adobe.com/xfdf/";
const STICKY_SIZE = 20;
const SAFE_NAME = /^[\w.:-]{1,128}$/;

// ── Formatting helpers ─────────────────────────────────────────────────────

const num = (n: number) => String(+n.toFixed(3));

const STATUS_TO_XFDF: Record<ReviewStatus, string> = {
  none: "None",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  completed: "Completed",
};

function attrString(attrs: Record<string, string | number | undefined>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");
}

// ── Export ─────────────────────────────────────────────────────────────────

export type XfdfExportOptions = XfdfContext & {
  /** File name written to <f href>, so the XFDF names the PDF it belongs to. */
  fileName?: string;
};

/** Serialize every annotation in `edits` (with replies and review status) as XFDF. */
export function exportXfdf(edits: PdfEdit[], opts: XfdfExportOptions): string {
  const out: string[] = [];
  for (const edit of edits) {
    if (!isAnnotation(edit)) continue;
    const page = opts.pageOrder.indexOf(edit.pageIndex);
    const size = opts.pageSize(edit.pageIndex);
    if (page < 0 || !size) continue;
    out.push(...annotationToXfdf(edit, page, size));
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xfdf xmlns="${XFDF_NS}" xml:space="preserve">`,
  ];
  if (opts.fileName) lines.push(`<f href="${escapeXml(opts.fileName)}"/>`);
  lines.push("<annots>", ...out, "</annots>", "</xfdf>", "");
  return lines.join("\n");
}

type Converter = { s: number; H: number };

const px = (c: Converter, p: Pt) => `${num(p.x * c.s)},${num(c.H - p.y * c.s)}`;

function rectAttr(c: Converter, x: number, y: number, w: number, h: number): string {
  return [x * c.s, c.H - (y + h) * c.s, (x + w) * c.s, c.H - y * c.s].map(num).join(",");
}

function annotationToXfdf(edit: AnnotationEdit, page: number, size: XfdfPageSize): string[] {
  const c: Converter = { s: size.width / VIEWER_WIDTH, H: size.height };
  const base: Record<string, string | number | undefined> = {
    page,
    flags: "print",
    name: edit.id,
    title: edit.author,
    subject: ANNOTATION_LABEL[edit.type],
    date: formatPdfDate(edit.modifiedAt ?? edit.createdAt ?? Date.now()),
    creationdate: edit.createdAt ? formatPdfDate(edit.createdAt) : undefined,
  };
  const contents = edit.text?.trim() ? `<contents>${escapeXml(edit.text)}</contents>` : "";
  const open = (tag: string, attrs: Record<string, string | number | undefined>, inner = "") => {
    const body = inner + contents;
    const head = `<${tag}${attrString({ ...base, ...attrs })}`;
    return body ? `${head}>${body}</${tag}>` : `${head}/>`;
  };

  const lines: string[] = [];
  const rect = rectAttr(c, edit.x, edit.y, edit.width, edit.height);

  switch (edit.type) {
    case "highlight":
    case "underline":
    case "strikeout": {
      const l = edit.x * c.s;
      const r = (edit.x + edit.width) * c.s;
      const t = c.H - edit.y * c.s;
      const b = c.H - (edit.y + edit.height) * c.s;
      // Quad order Acrobat uses: top-left, top-right, bottom-left, bottom-right.
      const coords = [l, t, r, t, l, b, r, b].map(num).join(",");
      lines.push(
        open(edit.type, {
          rect,
          coords,
          color: edit.color,
          opacity: edit.type === "highlight" ? 0.4 : undefined,
        }),
      );
      break;
    }
    case "comment": {
      lines.push(
        open("text", {
          rect: rectAttr(c, edit.x, edit.y, STICKY_SIZE, STICKY_SIZE),
          color: edit.color,
          icon: "Comment",
          open: "no",
        }),
      );
      break;
    }
    case "ink": {
      const pts = absolutePoints(edit).map((p) => px(c, p));
      const inner = `<inklist><gesture>${pts.join(";")}</gesture></inklist>`;
      lines.push(
        open("ink", { rect, color: edit.color, width: num(edit.strokeWidth * c.s) }, inner),
      );
      break;
    }
    case "rectangle":
      lines.push(
        open("square", {
          rect,
          color: edit.color ?? "#000000",
          width: num((edit.strokeWidth ?? 1) * c.s),
        }),
      );
      break;
    case "oval":
      lines.push(open("circle", { rect, color: edit.color, width: num(edit.strokeWidth * c.s) }));
      break;
    case "cloud":
      lines.push(
        open("square", {
          rect,
          color: edit.color,
          width: num(edit.strokeWidth * c.s),
          style: "cloudy",
          intensity: 1,
        }),
      );
      break;
    case "line":
    case "arrow": {
      const [a, b] = absolutePoints(edit);
      if (!a || !b) break;
      lines.push(
        open("line", {
          rect,
          start: px(c, a),
          end: px(c, b),
          color: edit.color,
          width: num(edit.strokeWidth * c.s),
          head: "None",
          tail: edit.type === "arrow" ? "OpenArrow" : "None",
        }),
      );
      break;
    }
    case "polygon": {
      const pts = absolutePoints(edit).map((p) => px(c, p));
      lines.push(
        open(
          "polygon",
          { rect, color: edit.color, width: num(edit.strokeWidth * c.s) },
          `<vertices>${pts.join(";")}</vertices>`,
        ),
      );
      break;
    }
    case "stamp":
      lines.push(open("stamp", { rect, color: edit.color, icon: edit.stamp }));
      break;
  }

  // Review status and replies are separate <text> annotations pointing at the
  // parent by name — the XFDF/PDF threading model.
  if (edit.status && edit.status !== "none") {
    lines.push(
      `<text${attrString({
        page,
        rect: rectAttr(c, edit.x, edit.y, STICKY_SIZE, STICKY_SIZE),
        flags: "print,nozoom,norotate",
        name: `${edit.id}-status`,
        title: edit.author,
        date: formatPdfDate(edit.modifiedAt ?? Date.now()),
        inreplyto: edit.id,
        state: STATUS_TO_XFDF[edit.status],
        statemodel: "Review",
      })}/>`,
    );
  }
  for (const reply of edit.replies ?? []) {
    lines.push(
      `<text${attrString({
        page,
        rect: rectAttr(c, edit.x, edit.y, STICKY_SIZE, STICKY_SIZE),
        flags: "print,nozoom,norotate",
        name: reply.id,
        title: reply.author,
        date: formatPdfDate(reply.createdAt),
        creationdate: formatPdfDate(reply.createdAt),
        inreplyto: edit.id,
      })}><contents>${escapeXml(reply.text)}</contents></text>`,
    );
  }
  return lines;
}

// ── Import ─────────────────────────────────────────────────────────────────

export type XfdfImportResult = {
  edits: PdfEdit[];
  /** Annotations found but not imported, by XFDF element name. */
  skipped: Record<string, number>;
};

export type XfdfImportOptions = XfdfContext & {
  /** Id generator (injectable for tests). */
  newId?: () => string;
};

const STATE_TO_STATUS: Record<string, ReviewStatus> = {
  none: "none",
  accepted: "accepted",
  rejected: "rejected",
  cancelled: "cancelled",
  completed: "completed",
};

const ARROW_ENDINGS = new Set(["openarrow", "closedarrow", "ropenarrow", "rclosedarrow"]);

function parseNumbers(s: string | undefined): number[] {
  return (s ?? "")
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

function parsePoint(s: string | undefined): [number, number] | null {
  const n = parseNumbers(s);
  return n.length >= 2 ? [n[0], n[1]] : null;
}

function hexColor(s: string | undefined, fallback: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec((s ?? "").trim());
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

function noteText(node: XmlNode): string | undefined {
  const plain = firstChild(node, "contents")?.text;
  if (plain?.trim()) return plain;
  const rich = firstChild(node, "contents-richtext");
  if (rich) {
    const collect = (n: XmlNode): string => n.text + n.children.map(collect).join("");
    const text = collect(rich).trim();
    if (text) return text;
  }
  return undefined;
}

/**
 * Read XFDF into editor annotations. Unsupported annotation kinds (free text,
 * carets, polylines, attachments, …) are counted in `skipped` rather than
 * failing the import. A multi-line text-markup annotation (several quads)
 * becomes one markup edit per quad; the first carries the note and thread.
 * Throws if the XML is not XFDF.
 */
export function importXfdf(xml: string, opts: XfdfImportOptions): XfdfImportResult {
  const root = parseXml(xml);
  if (root.name !== "xfdf") throw new Error("This is not an XFDF file.");
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const annots = firstChild(root, "annots");
  const nodes = annots?.children ?? [];

  const edits: PdfEdit[] = [];
  const skipped: Record<string, number> = {};
  const skip = (what: string) => (skipped[what] = (skipped[what] ?? 0) + 1);
  /** Threads are keyed by the XFDF `name` (what replies point at), and also by
   * the editor id when we had to mint a new one. */
  const byName = new Map<string, AnnotationEdit>();
  const register = (edit: AnnotationEdit, name: string | undefined) => {
    if (name) byName.set(name, edit);
    byName.set(edit.id, edit);
  };
  const replyNodes: XmlNode[] = [];

  const usedIds = new Set<string>();
  const idFor = (name: string | undefined) => {
    // Names come from an untrusted file and end up as PDF /NM strings and DOM
    // data attributes: keep only plain identifiers, mint an id for the rest.
    const id = name && SAFE_NAME.test(name) && !usedIds.has(name) ? name : newId();
    usedIds.add(id);
    return id;
  };

  for (const node of nodes) {
    const kind = node.name.toLowerCase();
    // `replyType="group"` marks members of a group (e.g. Acrobat's replace-text
    // strikeout + caret): standalone marks, not replies.
    if (node.attrs.inreplyto !== undefined && node.attrs.replyType?.toLowerCase() !== "group") {
      replyNodes.push(node);
      continue;
    }
    const pageNo = Number(node.attrs.page);
    const orig = opts.pageOrder[pageNo];
    const size = orig === undefined ? undefined : opts.pageSize(orig);
    if (orig === undefined || !size || !Number.isInteger(pageNo)) {
      skip(`${kind} (page not in this document)`);
      continue;
    }
    const s = size.width / VIEWER_WIDTH;
    const H = size.height;
    const toScreen = ([x, y]: [number, number]): Pt => ({ x: x / s, y: (H - y) / s });
    const meta = {
      author: node.attrs.title || undefined,
      createdAt: parsePdfDate(node.attrs.creationdate) ?? parsePdfDate(node.attrs.date),
      modifiedAt: parsePdfDate(node.attrs.date) ?? parsePdfDate(node.attrs.creationdate),
      text: noteText(node),
    };
    const rectNums = parseNumbers(node.attrs.rect);
    const rectBox = (() => {
      if (rectNums.length < 4) return null;
      const [l, b, r, t] = rectNums;
      const tl = toScreen([Math.min(l, r), Math.max(b, t)]);
      return {
        x: tl.x,
        y: tl.y,
        width: Math.abs(r - l) / s,
        height: Math.abs(t - b) / s,
      };
    })();
    const strokeWidth = (() => {
      const w = Number(node.attrs.width);
      return Number.isFinite(w) && w > 0 ? Math.max(0.5, w / s) : SHAPE_STROKE;
    })();
    const color = (fallback: string) => hexColor(node.attrs.color, fallback);
    const common = { pageIndex: orig } as const;
    const mk = <T extends AnnotationEdit>(
      partial: Omit<T, "id" | "pageIndex">,
      name?: string,
    ): T => {
      const edit = { ...partial, id: idFor(name), ...common } as T;
      for (const k of ["author", "createdAt", "modifiedAt", "text"] as const) {
        if (meta[k] === undefined) delete (edit as Record<string, unknown>)[k];
      }
      return edit;
    };
    const metaFields = () => ({ ...meta });

    switch (kind) {
      case "highlight":
      case "underline":
      case "strikeout":
      case "squiggly": {
        const type = kind === "squiggly" ? "underline" : kind;
        const fallback =
          type === "highlight" ? ANNOTATION_COLOR.highlight : ANNOTATION_COLOR.underline;
        const coords = parseNumbers(node.attrs.coords);
        const boxes: { x: number; y: number; width: number; height: number }[] = [];
        for (let q = 0; q + 8 <= coords.length; q += 8) {
          const xs = [coords[q], coords[q + 2], coords[q + 4], coords[q + 6]];
          const ys = [coords[q + 1], coords[q + 3], coords[q + 5], coords[q + 7]];
          const tl = toScreen([Math.min(...xs), Math.max(...ys)]);
          boxes.push({
            x: tl.x,
            y: tl.y,
            width: (Math.max(...xs) - Math.min(...xs)) / s,
            height: (Math.max(...ys) - Math.min(...ys)) / s,
          });
        }
        if (!boxes.length && rectBox) boxes.push(rectBox);
        if (!boxes.length) {
          skip(kind);
          break;
        }
        boxes.forEach((box, i) => {
          const edit = mk<AnnotationEdit>(
            {
              type,
              ...box,
              color: color(fallback),
              ...(i === 0 ? metaFields() : { author: meta.author, createdAt: meta.createdAt }),
            } as never,
            i === 0 ? node.attrs.name : undefined,
          );
          if (i > 0) delete (edit as { text?: string }).text;
          edits.push(edit);
          if (i === 0) register(edit, node.attrs.name);
        });
        break;
      }
      case "text": {
        if (!rectBox) {
          skip(kind);
          break;
        }
        const edit = mk<AnnotationEdit>(
          {
            type: "comment",
            x: rectBox.x,
            y: rectBox.y,
            width: STICKY_SIZE,
            height: STICKY_SIZE,
            color: color(ANNOTATION_COLOR.comment),
            ...metaFields(),
            text: meta.text ?? "",
          } as never,
          node.attrs.name,
        );
        edits.push(edit);
        register(edit, node.attrs.name);
        break;
      }
      case "ink": {
        const gestures = childrenNamed(firstChild(node, "inklist") ?? node, "gesture");
        // The editor stores one polyline per ink edit: a multi-stroke ink
        // annotation becomes several edits (the first carries the thread).
        let first = true;
        for (const g of gestures) {
          const pts = g.text
            .split(";")
            .map(parsePoint)
            .filter((p): p is [number, number] => !!p)
            .map(toScreen);
          if (pts.length < 2) continue;
          const box = boxFromPoints(pts, strokeWidth);
          const edit = mk<AnnotationEdit>(
            {
              type: "ink",
              ...box,
              color: color(ANNOTATION_COLOR.ink),
              strokeWidth,
              ...(first ? metaFields() : { author: meta.author, createdAt: meta.createdAt }),
            } as never,
            first ? node.attrs.name : undefined,
          );
          if (!first) delete (edit as { text?: string }).text;
          edits.push(edit);
          if (first) register(edit, node.attrs.name);
          first = false;
        }
        if (first) skip(kind);
        break;
      }
      case "square":
      case "circle": {
        if (!rectBox) {
          skip(kind);
          break;
        }
        const cloudy = (node.attrs.style ?? "").toLowerCase() === "cloudy";
        const type = kind === "circle" ? "oval" : cloudy ? "cloud" : "rectangle";
        const edit = mk<AnnotationEdit>(
          {
            type,
            ...rectBox,
            color: color(type === "rectangle" ? "#000000" : ANNOTATION_COLOR.shape),
            strokeWidth,
            ...metaFields(),
          } as never,
          node.attrs.name,
        );
        edits.push(edit);
        register(edit, node.attrs.name);
        break;
      }
      case "line": {
        const a = parsePoint(node.attrs.start);
        const b = parsePoint(node.attrs.end);
        if (!a || !b) {
          skip(kind);
          break;
        }
        let from = toScreen(a);
        let to = toScreen(b);
        const head = (node.attrs.head ?? "").toLowerCase();
        const tail = (node.attrs.tail ?? "").toLowerCase();
        const isArrow = ARROW_ENDINGS.has(tail) || ARROW_ENDINGS.has(head);
        // The editor's arrow has its head at the second point.
        if (!ARROW_ENDINGS.has(tail) && ARROW_ENDINGS.has(head)) [from, to] = [to, from];
        const box = boxFromPoints([from, to], shapePad(strokeWidth));
        const edit = mk<AnnotationEdit>(
          {
            type: isArrow ? "arrow" : "line",
            ...box,
            color: color(ANNOTATION_COLOR.shape),
            strokeWidth,
            ...metaFields(),
          } as never,
          node.attrs.name,
        );
        edits.push(edit);
        register(edit, node.attrs.name);
        break;
      }
      case "polygon": {
        const pts = (firstChild(node, "vertices")?.text ?? "")
          .split(";")
          .map(parsePoint)
          .filter((p): p is [number, number] => !!p)
          .map(toScreen);
        if (pts.length < 3) {
          skip(kind);
          break;
        }
        const edit = mk<AnnotationEdit>(
          {
            type: "polygon",
            ...boxFromPoints(pts, shapePad(strokeWidth)),
            color: color(ANNOTATION_COLOR.shape),
            strokeWidth,
            ...metaFields(),
          } as never,
          node.attrs.name,
        );
        edits.push(edit);
        register(edit, node.attrs.name);
        break;
      }
      case "stamp": {
        if (!rectBox) {
          skip(kind);
          break;
        }
        const preset = stampPreset(node.attrs.icon ?? "");
        const label = preset?.label ?? (node.attrs.icon || "STAMP").toUpperCase();
        const fallbackSize = stampSize(label);
        const edit = mk<AnnotationEdit>(
          {
            type: "stamp",
            ...rectBox,
            width: rectBox.width || fallbackSize.width,
            height: rectBox.height || fallbackSize.height,
            stamp: preset?.id ?? node.attrs.icon ?? "Custom",
            label,
            color: color(preset?.color ?? ANNOTATION_COLOR.shape),
            ...metaFields(),
          } as never,
          node.attrs.name,
        );
        edits.push(edit);
        register(edit, node.attrs.name);
        break;
      }
      case "popup":
        break; // the popup window's geometry; the note lives on its parent
      default:
        skip(kind);
    }
  }

  // Replies and review states. A reply to a reply attaches to the root of the
  // thread (the editor's threads are flat), however the file orders them.
  const answers = new Map<string, string>();
  for (const node of replyNodes) {
    if (node.attrs.name) answers.set(node.attrs.name, node.attrs.inreplyto);
  }
  const rootNameOf = (name: string) => {
    let cur = name;
    for (let hops = 0; hops < 64 && answers.has(cur); hops++) cur = answers.get(cur)!;
    return cur;
  };
  for (const node of replyNodes) {
    const parent = byName.get(rootNameOf(node.attrs.inreplyto));
    if (!parent) {
      skip("reply (parent not found)");
      continue;
    }
    const state = node.attrs.state;
    const model = (node.attrs.statemodel ?? "Review").toLowerCase();
    const modified = parsePdfDate(node.attrs.date) ?? parsePdfDate(node.attrs.creationdate);
    let isStatusChange = false;
    if (state && model === "review") {
      const key = state.toLowerCase();
      if (Object.hasOwn(STATE_TO_STATUS, key)) {
        parent.status = STATE_TO_STATUS[key];
        isStatusChange = true;
      }
    }
    // A status annotation's text ("Accepted set by X") describes the change; it
    // is not a reply, and keeping it would add one per round trip.
    const text = isStatusChange ? undefined : noteText(node);
    if (text) {
      const reply: CommentReply = {
        id: idFor(node.attrs.name),
        author: node.attrs.title || "Unknown",
        text,
        createdAt: parsePdfDate(node.attrs.creationdate) ?? modified ?? Date.now(),
      };
      parent.replies = [...(parent.replies ?? []), reply];
    }
  }
  for (const edit of byName.values()) {
    if (edit.replies) edit.replies.sort((a, b) => a.createdAt - b.createdAt);
  }

  return { edits, skipped };
}

// ── Merging an import into the open document ───────────────────────────────

export type MergeResult = {
  /** Brand-new comments to add. */
  added: PdfEdit[];
  /** Existing comments with the incoming replies / newer status and note merged in. */
  updated: PdfEdit[];
  /** Incoming comments that were already here, unchanged. */
  unchanged: number;
};

/**
 * Fold imported comments into `existing`. An incoming comment whose id matches
 * an existing one *of the same kind on the same page* is the same comment
 * (e.g. a reviewer's copy of our own export): its replies are unioned by id and
 * its status/note are taken if its modification time is newer. An id clash with
 * a different comment (another tool's "1", "2", …) gets a fresh id instead.
 */
export function mergeImportedComments(
  existing: PdfEdit[],
  incoming: PdfEdit[],
  newId: () => string = () => crypto.randomUUID(),
): MergeResult {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const added: PdfEdit[] = [];
  const updated = new Map<string, AnnotationEdit>();
  let unchanged = 0;

  for (const inc of incoming) {
    const have = byId.get(inc.id);
    if (!have) {
      added.push(inc);
      continue;
    }
    if (
      !isAnnotation(have) ||
      !isAnnotation(inc) ||
      have.type !== inc.type ||
      have.pageIndex !== inc.pageIndex
    ) {
      added.push({ ...inc, id: newId() });
      continue;
    }
    const base = updated.get(have.id) ?? have;
    const known = new Set((base.replies ?? []).map((r) => r.id));
    const newReplies = (inc.replies ?? []).filter((r) => !known.has(r.id));
    const newer = (inc.modifiedAt ?? 0) > (base.modifiedAt ?? 0);
    const patch: Partial<AnnotationEdit> = {};
    if (newReplies.length) {
      patch.replies = [...(base.replies ?? []), ...newReplies].sort(
        (a, b) => a.createdAt - b.createdAt,
      );
    }
    if (newer && (inc.status ?? "none") !== (base.status ?? "none"))
      patch.status = inc.status ?? "none";
    if (newer && (inc.text ?? "") !== (base.text ?? "")) patch.text = inc.text;
    if (!Object.keys(patch).length) {
      unchanged++;
      continue;
    }
    updated.set(have.id, {
      ...base,
      ...patch,
      modifiedAt: Math.max(inc.modifiedAt ?? 0, base.modifiedAt ?? 0) || undefined,
    } as AnnotationEdit);
  }
  return { added, updated: [...updated.values()], unchanged };
}
