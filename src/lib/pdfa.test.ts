import { PDFDocument, StandardFonts, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vite-plus/test";
import { buildSrgbProfile } from "./iccSrgb";
import { prepareForPdfA } from "./pdfa";
import { readXmp } from "./xmp";

async function fixture(setup?: (doc: PDFDocument) => void | Promise<void>) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello", { x: 10, y: 10, font });
  doc.setTitle("Quarterly & <Report>");
  doc.setAuthor("Will");
  await setup?.(doc);
  return doc.save();
}

describe("buildSrgbProfile", () => {
  it("is a well-formed RGB display profile", () => {
    const p = buildSrgbProfile();
    const view = new DataView(p.buffer);
    const text = (at: number, len = 4) => String.fromCharCode(...p.subarray(at, at + len));
    expect(view.getUint32(0)).toBe(p.length);
    expect(p.length % 4).toBe(0);
    expect(text(12)).toBe("mntr");
    expect(text(16)).toBe("RGB ");
    expect(text(20)).toBe("XYZ ");
    expect(text(36)).toBe("acsp");
    const count = view.getUint32(128);
    expect(count).toBe(9);
    // Every tag lies inside the file.
    for (let i = 0; i < count; i++) {
      const at = 132 + i * 12;
      expect(view.getUint32(at + 4) + view.getUint32(at + 8)).toBeLessThanOrEqual(p.length);
    }
  });
});

describe("prepareForPdfA", () => {
  it("declares PDF/A in escaped XMP and keeps Info in step", async () => {
    const { bytes } = await prepareForPdfA(await fixture(), { removeRestricted: true });
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const xmp = readXmp(doc) ?? "";
    expect(xmp).toContain("<pdfaid:part>2</pdfaid:part>");
    expect(xmp).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
    expect(xmp).toContain("Quarterly &amp; &lt;Report&gt;");
    expect(doc.getTitle()).toBe("Quarterly & <Report>");
    expect(doc.getProducer()).toBe("PDF Editor");
  });

  it("adds an sRGB output intent and a trailer file ID", async () => {
    const { bytes, applied } = await prepareForPdfA(await fixture(), { removeRestricted: true });
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const intents = doc.catalog.lookup(PDFName.of("OutputIntents"));
    expect(intents).toBeDefined();
    expect(applied).toContain("Added an sRGB output intent");
    expect(new TextDecoder("latin1").decode(bytes)).toMatch(/\/ID\s*\[/);
  });

  it("does not add a second output intent", async () => {
    const first = await prepareForPdfA(await fixture(), { removeRestricted: true });
    const second = await prepareForPdfA(first.bytes, { removeRestricted: true });
    expect(second.applied).not.toContain("Added an sRGB output intent");
  });

  it("reports standard fonts that are not embedded", async () => {
    const { issues } = await prepareForPdfA(await fixture(), { removeRestricted: true });
    const fonts = issues.find((i) => i.id === "fonts");
    expect(fonts?.message).toContain("Helvetica");
  });

  it("reports annotations without an appearance and makes the rest printable", async () => {
    const { bytes, issues, applied } = await prepareForPdfA(
      await fixture((doc) => {
        const ctx = doc.context;
        const annot = ctx.register(
          ctx.obj({
            Type: "Annot",
            Subtype: "Text",
            Rect: [10, 10, 30, 30],
            Contents: PDFString.of("note"),
            F: 2,
          }),
        );
        doc.getPage(0).node.set(PDFName.of("Annots"), ctx.obj([annot]));
      }),
      { removeRestricted: true },
    );
    expect(issues.some((i) => i.id === "annotations")).toBe(true);
    expect(applied.some((a) => a.includes("printable"))).toBe(true);
    const doc = await PDFDocument.load(bytes);
    const a = doc.getPage(0).node.Annots()!.lookup(0) as import("pdf-lib").PDFDict;
    expect(a.get(PDFName.of("F"))?.toString()).toBe("4");
  });

  it("removes JavaScript only when asked", async () => {
    const withScript = await fixture((doc) => {
      const ctx = doc.context;
      doc.catalog.set(
        PDFName.of("OpenAction"),
        ctx.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert(1)") }),
      );
    });
    const kept = await prepareForPdfA(withScript, { removeRestricted: false });
    expect(new TextDecoder("latin1").decode(kept.bytes)).toContain("JavaScript");
    const removed = await prepareForPdfA(withScript, { removeRestricted: true });
    expect(new TextDecoder("latin1").decode(removed.bytes)).not.toContain("app.alert");
    expect(removed.applied.some((a) => a.includes("script"))).toBe(true);
  });
});
