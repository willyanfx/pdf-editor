import { expect, test } from "vite-plus/test";
import { escapeXml, parseXml } from "./xml";
import { exportXfdf, formatPdfDate, importXfdf, parsePdfDate, type XfdfContext } from "./xfdf";
import {
  absolutePoints,
  boxFromPoints,
  isAnnotation,
  shapePad,
  stampPreset,
  type AnnotationEdit,
} from "./annotations";
import type { PdfEdit } from "../store/useEditorStore";

// ── xml ────────────────────────────────────────────────────────────────────

test("parseXml reads elements, attributes, entities, CDATA and ignores comments/PIs", () => {
  const root = parseXml(
    `<?xml version="1.0"?><!-- c --><a xmlns="urn:x" b="1 &amp; 2" c='q"q'><b/><c>x &lt; y<![CDATA[ <raw> ]]></c></a>`,
  );
  expect(root.name).toBe("a");
  expect(root.attrs).toEqual({ b: "1 & 2", c: 'q"q' });
  expect(root.children.map((c) => c.name)).toEqual(["b", "c"]);
  expect(root.children[1].text).toBe("x < y <raw> ");
});

test("parseXml drops namespace prefixes and tolerates > inside attribute values", () => {
  const root = parseXml(`<x:root x:id="a>b"><x:child/></x:root>`);
  expect(root.name).toBe("root");
  expect(root.attrs).toEqual({ id: "a>b" });
  expect(root.children[0].name).toBe("child");
});

test("parseXml decodes numeric character references", () => {
  expect(parseXml(`<a>&#233;&#x1F600;</a>`).text).toBe("é😀");
});

test("parseXml rejects malformed documents", () => {
  expect(() => parseXml("<a><b></a>")).toThrow(/Invalid XML/);
  expect(() => parseXml("<a>")).toThrow(/Invalid XML/);
  expect(() => parseXml("")).toThrow(/Invalid XML/);
  expect(() => parseXml("<a/><b/>")).toThrow(/Invalid XML/);
});

test("parseXml does not expand custom entities (no entity-expansion attacks)", () => {
  const root = parseXml(`<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>`);
  expect(root.text).toBe("&x;");
});

test("escapeXml round-trips through parseXml and strips illegal control characters", () => {
  const nasty = `a<b>&"c'\u0001d`;
  const root = parseXml(`<a v="${escapeXml(nasty)}">${escapeXml(nasty)}</a>`);
  expect(root.attrs.v).toBe(`a<b>&"c'd`);
  expect(root.text).toBe(`a<b>&"c'd`);
});

// ── dates ──────────────────────────────────────────────────────────────────

test("PDF dates format and parse symmetrically (UTC)", () => {
  const ms = Date.UTC(2026, 4, 17, 13, 5, 9);
  expect(formatPdfDate(ms)).toBe("D:20260517130509+00'00'");
  expect(parsePdfDate(formatPdfDate(ms))).toBe(ms);
});

test("parsePdfDate handles zones, truncation and garbage", () => {
  expect(parsePdfDate("D:20260517130509-05'00'")).toBe(Date.UTC(2026, 4, 17, 18, 5, 9));
  expect(parsePdfDate("D:2026")).toBe(Date.UTC(2026, 0, 1));
  expect(parsePdfDate("D:20260517130509Z")).toBe(Date.UTC(2026, 4, 17, 13, 5, 9));
  expect(parsePdfDate(undefined)).toBeUndefined();
  expect(parsePdfDate("not a date")).toBeUndefined();
  // ISO strings are not PDF dates: they must not collapse to Jan 1.
  expect(parsePdfDate("2026-05-17T13:05:09Z")).toBe(Date.UTC(2026, 4, 17, 13, 5, 9));
});

// ── XFDF round trip ────────────────────────────────────────────────────────

// Page 0 and 1 are original pages; the visible order swaps them, so exported
// page numbers must follow the visible order, not the original index.
const ctx: XfdfContext = {
  pageOrder: [1, 0],
  pageSize: (i) => ({ width: 400, height: 600 + i * 100 }),
};

const T0 = Date.UTC(2026, 0, 2, 3, 4, 5);
const base = { author: "Ada", createdAt: T0, modifiedAt: T0 } as const;

function sample(): AnnotationEdit[] {
  const line = boxFromPoints(
    [
      { x: 40, y: 60 },
      { x: 200, y: 90 },
    ],
    shapePad(3),
  );
  const poly = boxFromPoints(
    [
      { x: 300, y: 40 },
      { x: 380, y: 90 },
      { x: 340, y: 140 },
    ],
    shapePad(2),
  );
  const ink = boxFromPoints(
    [
      { x: 10, y: 10 },
      { x: 30, y: 25 },
      { x: 60, y: 12 },
    ],
    2.5,
  );
  const approved = stampPreset("Approved")!;
  return [
    {
      ...base,
      id: "hl",
      type: "highlight",
      pageIndex: 0,
      x: 100,
      y: 200,
      width: 240,
      height: 20,
      color: "#ffe066",
      text: 'Key term <b> & "quote"',
      status: "accepted",
      replies: [
        { id: "r1", author: "Bob", text: "Agreed", createdAt: Date.UTC(2026, 0, 3) },
        { id: "r2", author: "Cy", text: "Line 2\nline 3", createdAt: Date.UTC(2026, 0, 4) },
      ],
    },
    {
      ...base,
      id: "ul",
      type: "underline",
      pageIndex: 1,
      x: 10,
      y: 20,
      width: 100,
      height: 14,
      color: "#e03131",
    },
    {
      ...base,
      id: "so",
      type: "strikeout",
      pageIndex: 1,
      x: 10,
      y: 60,
      width: 100,
      height: 14,
      color: "#e03131",
    },
    {
      ...base,
      id: "note",
      type: "comment",
      pageIndex: 0,
      x: 500,
      y: 100,
      width: 20,
      height: 20,
      text: "Sticky",
      color: "#ffd43b",
    },
    { ...base, id: "ink", type: "ink", pageIndex: 0, ...ink, color: "#1971c2", strokeWidth: 2.5 },
    {
      ...base,
      id: "rect",
      type: "rectangle",
      pageIndex: 0,
      x: 50,
      y: 300,
      width: 120,
      height: 60,
      color: "#e03131",
      strokeWidth: 2,
    },
    {
      ...base,
      id: "oval",
      type: "oval",
      pageIndex: 0,
      x: 200,
      y: 300,
      width: 100,
      height: 60,
      color: "#e8590c",
      strokeWidth: 2,
    },
    {
      ...base,
      id: "cloud",
      type: "cloud",
      pageIndex: 1,
      x: 200,
      y: 300,
      width: 120,
      height: 80,
      color: "#7048e8",
      strokeWidth: 2,
    },
    { ...base, id: "line", type: "line", pageIndex: 0, ...line, color: "#e03131", strokeWidth: 3 },
    {
      ...base,
      id: "arrow",
      type: "arrow",
      pageIndex: 0,
      ...line,
      color: "#1971c2",
      strokeWidth: 3,
    },
    {
      ...base,
      id: "poly",
      type: "polygon",
      pageIndex: 0,
      ...poly,
      color: "#2f9e44",
      strokeWidth: 2,
    },
    {
      ...base,
      id: "stamp",
      type: "stamp",
      pageIndex: 1,
      x: 40,
      y: 400,
      width: 170,
      height: 40,
      stamp: approved.id,
      label: approved.label,
      color: approved.color,
    },
  ];
}

/** Compare ignoring ids (the importer keeps names, but replies get fresh ones
 * only when absent) and tiny float drift from the unit conversions. */
function round(v: unknown): unknown {
  if (typeof v === "number") return Math.round(v * 100) / 100;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
  return v;
}

test("export → import round-trips every annotation type, thread and status", () => {
  const original = sample();
  const xml = exportXfdf(original as PdfEdit[], { ...ctx, fileName: "doc.pdf" });
  const { edits, skipped } = importXfdf(xml, ctx);
  expect(skipped).toEqual({});

  const byId = new Map(edits.map((e) => [e.id, e]));
  expect(edits).toHaveLength(original.length);
  for (const want of original) {
    const got = byId.get(want.id)!;
    expect(got, want.id).toBeTruthy();
    expect(round(got), want.id).toEqual(round(want));
  }
});

test("exported page numbers follow the visible order", () => {
  const xml = exportXfdf(sample() as PdfEdit[], ctx);
  // ORIGINAL page 0 is visible position 1, original page 1 is position 0.
  expect(xml).toMatch(/<highlight[^>]*\bpage="1"/);
  expect(xml).toMatch(/<underline[^>]*\bpage="0"/);
});

test("export is XFDF: namespace, f href, annots, y-up PDF coordinates", () => {
  const xml = exportXfdf(sample().slice(0, 1) as PdfEdit[], { ...ctx, fileName: "a&b.pdf" });
  expect(xml).toContain('<xfdf xmlns="http://ns.adobe.com/xfdf/"');
  expect(xml).toContain('<f href="a&amp;b.pdf"/>');
  // Original page 0 is 400x600pt; screen 800 → scale 0.5. Highlight at
  // screen (100,200) 240x20 → rect left 50, bottom 600-110=490, right 170, top 500.
  expect(xml).toMatch(/rect="50,490,170,500"/);
  // Highlight quads: top-left, top-right, bottom-left, bottom-right.
  expect(xml).toMatch(/coords="50,500,170,500,50,490,170,490"/);
  expect(() => parseXml(xml)).not.toThrow();
});

test("non-annotation edits and annotations on dropped pages are not exported", () => {
  const edits: PdfEdit[] = [
    {
      id: "t",
      type: "text",
      pageIndex: 0,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      runs: [{ text: "hi" }],
      fontSize: 12,
      fontFamily: "Helvetica",
      bold: false,
      italic: false,
      color: "#000000",
      align: "left",
      origin: "added",
      coverColor: "#ffffff",
    },
    { id: "r", type: "redact", pageIndex: 0, x: 0, y: 0, width: 10, height: 10 },
    { ...(sample()[0] as AnnotationEdit), id: "dropped", pageIndex: 5 },
  ];
  const xml = exportXfdf(edits, ctx);
  expect(xml).not.toMatch(/<(highlight|text|square)/);
  expect(isAnnotation(edits[0])).toBe(false);
});

test("exporting an arrow sets the line-ending; a plain line has none", () => {
  const xml = exportXfdf(sample() as PdfEdit[], ctx);
  expect(xml).toMatch(/<line[^>]*name="arrow"[^>]*tail="OpenArrow"/);
  expect(xml).toMatch(/<line[^>]*name="line"[^>]*tail="None"/);
});

// ── Import of third-party XFDF ─────────────────────────────────────────────

const acrobatSample = `<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">
<f href="contract.pdf"/>
<annots>
  <highlight color="#FFFF00" coords="72,700,300,700,72,686,300,686,72,680,200,680,72,666,200,666" creationdate="D:20250101120000+00'00'" date="D:20250102120000+00'00'" flags="print" name="h-1" page="0" rect="72,666,300,700" subject="Highlight" title="Reviewer One">
    <contents>Two-line highlight</contents>
    <popup flags="print,nozoom,norotate" open="no" page="0" rect="100,100,200,200"/>
  </highlight>
  <text color="#FFD700" flags="print,nozoom,norotate" icon="Note" name="n-1" page="1" rect="100,500,120,520" title="Reviewer One" date="D:20250103090000Z">
    <contents-richtext><body><p>Rich <b>note</b></p></body></contents-richtext>
  </text>
  <text inreplyto="n-1" replyType="R" name="n-1-r1" page="1" rect="100,500,120,520" title="Reviewer Two" creationdate="D:20250104090000Z" date="D:20250104090000Z"><contents>I agree</contents></text>
  <text inreplyto="n-1-r1" name="n-1-r2" page="1" title="Reviewer One" creationdate="D:20250105090000Z"><contents>Reply to a reply</contents></text>
  <text inreplyto="n-1" name="n-1-s" state="Completed" statemodel="Review" page="1" title="Reviewer Two" date="D:20250106090000Z"/>
  <text inreplyto="n-1" name="n-1-m" state="Marked" statemodel="Marked" page="1"/>
  <ink color="#0000FF" width="3" name="i-1" page="0" rect="50,50,150,100" title="R"><inklist><gesture>50,50;100,100;150,60</gesture><gesture>60,60;70,70</gesture></inklist></ink>
  <line start="100,400" end="200,400" head="OpenArrow" tail="None" color="#FF0000" width="2" name="l-1" page="0" rect="90,390,210,410"/>
  <square style="cloudy" intensity="2" color="#00FF00" width="1" name="s-1" page="0" rect="300,300,400,360"/>
  <polygon color="#800080" width="1" name="p-1" page="0" rect="0,0,50,50"><vertices>10,10;50,10;30,50</vertices></polygon>
  <freetext name="ft-1" page="0" rect="0,0,10,10"><contents>Text box</contents></freetext>
  <caret name="c-1" page="0" rect="0,0,10,10"/>
  <highlight name="off" page="9" rect="0,0,10,10" coords="0,10,10,10,0,0,10,0"/>
  <text inreplyto="ghost" name="orphan" page="0"><contents>?</contents></text>
</annots>
</xfdf>`;

// Real-world page: 612x792, visible order [0, 1].
const letterCtx: XfdfContext = {
  pageOrder: [0, 1],
  pageSize: () => ({ width: 612, height: 792 }),
};

test("imports Acrobat-style XFDF: multi-quad highlight, rich-text note, thread, status", () => {
  const { edits } = importXfdf(acrobatSample, letterCtx);

  const highlights = edits.filter((e) => e.type === "highlight");
  expect(highlights).toHaveLength(2); // two quads → two bands
  const first = highlights[0] as AnnotationEdit;
  expect(first.id).toBe("h-1");
  expect(first.text).toBe("Two-line highlight");
  expect(first.author).toBe("Reviewer One");
  expect(first.createdAt).toBe(Date.UTC(2025, 0, 1, 12));
  expect(first.color).toBe("#ffff00");
  // 612pt page → scale 612/800; quad 72..300 wide, 14 tall, top at y=700.
  const k = 612 / 800;
  expect(first.x).toBeCloseTo(72 / k, 3);
  expect(first.width).toBeCloseTo(228 / k, 3);
  expect(first.height).toBeCloseTo(14 / k, 3);
  expect(first.y).toBeCloseTo((792 - 700) / k, 3);
  expect((highlights[1] as AnnotationEdit).text).toBeUndefined(); // the note stays on the first band

  const note = edits.find((e) => e.id === "n-1") as AnnotationEdit;
  expect(note.type).toBe("comment");
  expect(note.pageIndex).toBe(1);
  expect(note.text).toBe("Rich note");
  expect(note.status).toBe("completed");
  expect(note.replies?.map((r) => [r.author, r.text])).toEqual([
    ["Reviewer Two", "I agree"],
    ["Reviewer One", "Reply to a reply"], // reply-to-reply is flattened onto the thread
  ]);
});

test("imports ink strokes, arrows, cloud and polygon; counts what it skips", () => {
  const { edits, skipped } = importXfdf(acrobatSample, letterCtx);
  const ink = edits.filter((e) => e.type === "ink");
  expect(ink).toHaveLength(2); // two gestures
  expect((ink[0] as AnnotationEdit & { type: "ink" }).strokeWidth).toBeCloseTo(3 / (612 / 800), 3);

  // head=OpenArrow, tail=None → the importer swaps so the editor's arrowhead
  // (at the second point) lands where the original arrowhead was.
  const arrow = edits.find((e) => e.id === "l-1") as AnnotationEdit & { type: "arrow" };
  expect(arrow.type).toBe("arrow");
  const [from, to] = absolutePoints(arrow);
  expect(from.x).toBeGreaterThan(to.x); // started at the (200,400) end

  expect((edits.find((e) => e.id === "s-1") as AnnotationEdit).type).toBe("cloud");
  const poly = edits.find((e) => e.id === "p-1") as AnnotationEdit & { type: "polygon" };
  expect(poly.points).toHaveLength(3);

  expect(skipped).toEqual({
    freetext: 1,
    caret: 1,
    "highlight (page not in this document)": 1,
    "reply (parent not found)": 1,
  });
});

test("import mints ids for unnamed or duplicate names and keeps unique ones", () => {
  const xml = `<xfdf><annots>
    <square page="0" rect="0,0,10,10" name="dup"/><square page="0" rect="0,0,10,10" name="dup"/>
    <square page="0" rect="0,0,10,10"/></annots></xfdf>`;
  let n = 0;
  const { edits } = importXfdf(xml, { ...letterCtx, newId: () => `gen-${n++}` });
  expect(edits.map((e) => e.id)).toEqual(["dup", "gen-0", "gen-1"]);
});

test("a stamp keeps its standard name and falls back to the icon text", () => {
  const xml = `<xfdf><annots>
    <stamp page="0" rect="10,10,110,40" icon="Approved" name="a"/>
    <stamp page="0" rect="10,10,110,40" icon="MyStamp" name="b"/></annots></xfdf>`;
  const { edits } = importXfdf(xml, letterCtx);
  const [a, b] = edits as (AnnotationEdit & { type: "stamp" })[];
  expect([a.stamp, a.label]).toEqual(["Approved", "APPROVED"]);
  expect([b.stamp, b.label]).toEqual(["MyStamp", "MYSTAMP"]);
});

test("import rejects documents that are not XFDF", () => {
  expect(() => importXfdf("<html/>", letterCtx)).toThrow("not an XFDF");
  expect(() => importXfdf("not xml", letterCtx)).toThrow(/Invalid XML/);
});

test("an XFDF with no annots imports nothing", () => {
  expect(importXfdf(`<xfdf xmlns="http://ns.adobe.com/xfdf/"/>`, letterCtx)).toEqual({
    edits: [],
    skipped: {},
  });
});

test("imports annotations onto the visible page, not the original index", () => {
  const xml = `<xfdf><annots><square page="0" rect="0,0,10,10" name="a"/></annots></xfdf>`;
  const { edits } = importXfdf(xml, { ...ctx }); // pageOrder [1, 0]
  expect(edits[0].pageIndex).toBe(1);
});

// ── Hardening / threading edge cases ───────────────────────────────────────

import { mergeImportedComments } from "./xfdf";

test("hostile annotation names never become ids (they would land in PDF strings)", () => {
  const xml = `<xfdf><annots>
    <square page="0" rect="0,0,10,10" name="a) /A &lt;&lt; /S /JavaScript &gt;&gt; ("/>
    <square page="0" rect="0,0,10,10" name="ok-1.2:x_y"/></annots></xfdf>`;
  let n = 0;
  const { edits } = importXfdf(xml, { ...letterCtx, newId: () => `gen-${n++}` });
  expect(edits.map((e) => e.id)).toEqual(["gen-0", "ok-1.2:x_y"]);
});

test("a review state that names an Object.prototype key is ignored", () => {
  const xml = `<xfdf><annots>
    <square page="0" rect="0,0,10,10" name="a"/>
    <text inreplyto="a" state="constructor" statemodel="Review" page="0"/>
    <text inreplyto="a" state="__proto__" statemodel="Review" page="0"/></annots></xfdf>`;
  const [a] = importXfdf(xml, letterCtx).edits as AnnotationEdit[];
  expect(a.status).toBeUndefined();
});

test("a status annotation's text is not imported as a reply", () => {
  const xml = `<xfdf><annots>
    <square page="0" rect="0,0,10,10" name="a"/>
    <text inreplyto="a" state="Accepted" statemodel="Review" page="0" title="Ann"><contents>Accepted set by Ann</contents></text></annots></xfdf>`;
  const [a] = importXfdf(xml, letterCtx).edits as AnnotationEdit[];
  expect(a.status).toBe("accepted");
  expect(a.replies).toBeUndefined();
});

test("replyType=group members import as standalone marks, not replies", () => {
  const xml = `<xfdf><annots>
    <caret page="0" rect="0,0,10,10" name="c"/>
    <strikeout page="0" rect="0,0,10,10" coords="0,10,10,10,0,0,10,0" name="s" inreplyto="c" replyType="group"/></annots></xfdf>`;
  const { edits, skipped } = importXfdf(xml, letterCtx);
  expect(edits.map((e) => e.type)).toEqual(["strikeout"]);
  expect(skipped).toEqual({ caret: 1 });
});

test("reply-to-reply resolves regardless of order in the file", () => {
  const xml = `<xfdf><annots>
    <text inreplyto="r1" name="r2" page="0" title="B" creationdate="D:20250102000000Z"><contents>second</contents></text>
    <text inreplyto="a" name="r1" page="0" title="A" creationdate="D:20250101000000Z"><contents>first</contents></text>
    <square page="0" rect="0,0,10,10" name="a"/></annots></xfdf>`;
  const [a] = importXfdf(xml, letterCtx).edits as AnnotationEdit[];
  expect(a.replies?.map((r) => r.text)).toEqual(["first", "second"]);
});

test("replies still find their parent when its name was replaced by a minted id", () => {
  const xml = `<xfdf><annots>
    <square page="0" rect="0,0,10,10" name="dup"/><square page="0" rect="0,0,10,10" name="dup"/>
    <text inreplyto="dup" name="r" page="0"><contents>hi</contents></text></annots></xfdf>`;
  const { edits, skipped } = importXfdf(xml, { ...letterCtx, newId: () => "gen" });
  expect(skipped).toEqual({});
  expect((edits[1] as AnnotationEdit).replies ?? (edits[0] as AnnotationEdit).replies).toHaveLength(
    1,
  );
});

test("export does not write the non-XFDF replyType value", () => {
  const withReply = {
    ...sample()[0],
    replies: [{ id: "r", author: "B", text: "x", createdAt: 1 }],
  };
  expect(exportXfdf([withReply] as PdfEdit[], ctx)).not.toContain("replyType");
});

test("entities and parser survive hostile input quickly", () => {
  expect(parseXml(`<a>&constructor;&__proto__;</a>`).text).toBe("&constructor;&__proto__;");
  const started = Date.now();
  parseXml(`<a ${"x".repeat(200_000)}="1" ${"y".repeat(200_000)} b="2"/>`);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(parseXml(`<a b = "1"  c='2' d/>`).attrs).toEqual({ b: "1", c: "2" });
});

// ── mergeImportedComments ──────────────────────────────────────────────────

const mkNote = (over: Partial<AnnotationEdit> = {}) =>
  ({
    id: "n",
    type: "comment",
    pageIndex: 0,
    x: 1,
    y: 1,
    width: 20,
    height: 20,
    text: "hi",
    color: "#ffd43b",
    modifiedAt: 100,
    ...over,
  }) as AnnotationEdit;

test("merge: new replies and a newer status from a reviewer's copy are kept", () => {
  const mine = mkNote({ replies: [{ id: "r1", author: "A", text: "one", createdAt: 1 }] });
  const theirs = mkNote({
    modifiedAt: 200,
    status: "accepted",
    replies: [
      { id: "r1", author: "A", text: "one", createdAt: 1 },
      { id: "r2", author: "B", text: "two", createdAt: 2 },
    ],
  });
  const r = mergeImportedComments([mine], [theirs]);
  expect(r.added).toEqual([]);
  expect(r.updated).toHaveLength(1);
  const u = r.updated[0] as AnnotationEdit;
  expect(u.replies?.map((x) => x.id)).toEqual(["r1", "r2"]);
  expect(u.status).toBe("accepted");
});

test("merge: an older copy changes nothing; an identical one counts as unchanged", () => {
  const mine = mkNote({ modifiedAt: 300, status: "rejected" });
  const older = mkNote({ modifiedAt: 100, status: "accepted", text: "old text" });
  expect(mergeImportedComments([mine], [older])).toEqual({ added: [], updated: [], unchanged: 1 });
});

test("merge: an id clash with a different comment gets a fresh id instead of being dropped", () => {
  const mine = mkNote();
  const other = mkNote({ type: "highlight", color: "#ffe066" } as never);
  const r = mergeImportedComments([mine], [other], () => "fresh");
  expect(r.added.map((e) => e.id)).toEqual(["fresh"]);
  expect(r.updated).toEqual([]);
});

test("merge: unknown ids are added", () => {
  const r = mergeImportedComments([], [mkNote()]);
  expect(r.added).toHaveLength(1);
});
