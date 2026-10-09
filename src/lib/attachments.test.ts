import { expect, test } from "vite-plus/test";
import { formatBytes, loadAttachments, safeFileName } from "./attachments";

const bytes = (n: number) => new Uint8Array(n);

function fakePdf(opts: {
  doc?: Record<string, unknown> | null | Error;
  annots?: unknown[] | null | Error;
}) {
  return {
    getAttachments: async () => {
      if (opts.doc instanceof Error) throw opts.doc;
      return opts.doc ?? null;
    },
    getAnnotationsByType: async () => {
      if (opts.annots instanceof Error) throw opts.annots;
      return opts.annots ?? null;
    },
  } as unknown as Parameters<typeof loadAttachments>[0];
}

test("no attachments of either kind gives an empty list", async () => {
  expect(await loadAttachments(fakePdf({}))).toEqual([]);
});

test("document-level attachments come first, then page attachments by page", async () => {
  const list = await loadAttachments(
    fakePdf({
      doc: { "a.csv": { filename: "a.csv", description: "data", content: bytes(10) } },
      annots: [
        { pageIndex: 3, file: { filename: "late.txt", content: bytes(2) } },
        { pageIndex: 1, file: { filename: "early.txt", description: "note", content: bytes(5) } },
      ],
    }),
  );
  expect(list.map((e) => [e.filename, e.pageIndex, e.size])).toEqual([
    ["a.csv", null, 10],
    ["early.txt", 1, 5],
    ["late.txt", 3, 2],
  ]);
  expect(list[0].description).toBe("data");
  expect(new Set(list.map((e) => e.id)).size).toBe(3);
});

test("non-embedded files (no content) are skipped", async () => {
  const list = await loadAttachments(
    fakePdf({
      doc: { "x.bin": { filename: "x.bin", content: null }, "y.bin": { content: bytes(1) } },
    }),
  );
  // y.bin has no filename of its own, so the name-tree key is used.
  expect(list.map((e) => e.filename)).toEqual(["y.bin"]);
});

test("a failure in one source doesn't hide the other", async () => {
  const list = await loadAttachments(
    fakePdf({
      doc: new Error("boom"),
      annots: [{ pageIndex: 0, file: { filename: "p.txt", content: bytes(3) } }],
    }),
  );
  expect(list.map((e) => e.filename)).toEqual(["p.txt"]);
  const other = await loadAttachments(
    fakePdf({
      doc: { "d.txt": { filename: "d.txt", content: bytes(3) } },
      annots: new Error("boom"),
    }),
  );
  expect(other.map((e) => e.filename)).toEqual(["d.txt"]);
});

test("safeFileName strips paths, control and reserved characters", () => {
  expect(safeFileName("report.pdf")).toBe("report.pdf");
  expect(safeFileName("../../etc/passwd")).toBe("passwd");
  expect(safeFileName("C:\\Users\\me\\a.txt")).toBe("a.txt");
  expect(safeFileName("we<ir>d:na|me?.txt")).toBe("we_ir_d_na_me_.txt");
  expect(safeFileName("bad\u0000name\u001f.txt")).toBe("bad_name_.txt");
  expect(safeFileName("...")).toBe("attachment");
  expect(safeFileName("")).toBe("attachment");
  expect(safeFileName("  .hidden ")).toBe("hidden");
  expect(safeFileName("a".repeat(500)).length).toBe(200);
});

test("formatBytes", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1023)).toBe("1023 B");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(20 * 1024)).toBe("20 KB");
  expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
});
