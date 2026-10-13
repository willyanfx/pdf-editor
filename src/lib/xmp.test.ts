import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vite-plus/test";
import { buildPdfaXmp, readXmp, replaceXmpTitle, setXmp, xmpTitle } from "./xmp";

const wrap = (title: string) =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="r"><rdf:Description>${title}</rdf:Description></rdf:RDF></x:xmpmeta>`;

describe("xmpTitle", () => {
  it("reads the x-default alternative and decodes entities", () => {
    const xmp = wrap(
      `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Tom &amp; Jerry</rdf:li></rdf:Alt></dc:title>`,
    );
    expect(xmpTitle(xmp)).toBe("Tom & Jerry");
  });

  it("tolerates attributes on dc:title and a bare text value", () => {
    expect(xmpTitle(wrap(`<dc:title rdf:parseType="Resource">Plain</dc:title>`))).toBe("Plain");
  });

  it("is null when there is no title or it is empty", () => {
    expect(xmpTitle(wrap(""))).toBeNull();
    expect(xmpTitle(wrap(`<dc:title><rdf:Alt><rdf:li> </rdf:li></rdf:Alt></dc:title>`))).toBeNull();
  });
});

describe("replaceXmpTitle", () => {
  it("swaps the title and escapes it", () => {
    const next = replaceXmpTitle(wrap(`<dc:title>Old</dc:title>`), "A < B");
    expect(next).not.toBeNull();
    expect(xmpTitle(next!)).toBe("A < B");
  });

  it("treats `$` in a title literally", () => {
    const next = replaceXmpTitle(wrap(`<dc:title>Old</dc:title>`), "Cost $& more $1");
    expect(xmpTitle(next!)).toBe("Cost $& more $1");
  });

  it("returns null when the packet has no title to replace", () => {
    expect(replaceXmpTitle(wrap(""), "New")).toBeNull();
  });
});

describe("setXmp", () => {
  it("replaces the packet without leaving the old one in the file", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    setXmp(doc, wrap("OLD-PACKET-MARKER"));
    setXmp(
      doc,
      buildPdfaXmp({
        producer: "p",
        created: new Date(0),
        modified: new Date(0),
        pdfa: { part: 2, conformance: "B" },
      }),
    );
    const reloaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    expect(readXmp(reloaded)).toContain("pdfaid:part");
    const raw = new TextDecoder("latin1").decode(await doc.save());
    expect(raw).not.toContain("OLD-PACKET-MARKER");
  });
});
