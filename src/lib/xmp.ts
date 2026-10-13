import {
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
} from "pdf-lib";
import { decodeEntities, escapeXml } from "./xml";

/** The document's XMP packet as text, or null when it has none / can't be decoded. */
export function readXmp(doc: PDFDocument): string | null {
  try {
    const meta = doc.catalog.lookupMaybe(PDFName.of("Metadata"), PDFStream);
    if (!meta) return null;
    const bytes =
      meta instanceof PDFRawStream ? decodePDFRawStream(meta).decode() : meta.getContents();
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}

/** A `<dc:title>` element (it may carry attributes); group 1 is its content. */
const DC_TITLE = /<dc:title(?:\s[^>]*)?>([\s\S]*?)<\/dc:title>/;

/** First `<dc:title>` text in an XMP packet (the x-default alternative), if any. */
export function xmpTitle(xmp: string): string | null {
  const block = xmp.match(DC_TITLE);
  if (!block) return null;
  const item = block[1].match(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/);
  const text = decodeEntities(item ? item[1] : block[1].replace(/<[^>]+>/g, "")).trim();
  return text || null;
}

/** Replace the `<dc:title>` alternative in an existing packet; null if it has none. */
export function replaceXmpTitle(xmp: string, title: string): string | null {
  if (!DC_TITLE.test(xmp)) return null;
  // A function replacer: a title containing "$&" must not be read as a pattern.
  return xmp.replace(
    DC_TITLE,
    () =>
      `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>`,
  );
}

/** Document properties written into a PDF/A XMP packet. */
export type XmpFields = {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer: string;
  created: Date;
  modified: Date;
  /** PDF/A part + conformance level (e.g. 2 + "B"). */
  pdfa: { part: 1 | 2 | 3; conformance: "A" | "B" | "U" };
};

/** ISO 8601 UTC with whole seconds, as XMP wants. */
function xmpDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** An XMP packet declaring PDF/A identification plus the document properties. */
export function buildPdfaXmp(f: XmpFields): string {
  const lines: string[] = [
    `<pdfaid:part>${f.pdfa.part}</pdfaid:part>`,
    `<pdfaid:conformance>${f.pdfa.conformance}</pdfaid:conformance>`,
  ];
  if (f.title) {
    lines.push(
      `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(f.title)}</rdf:li></rdf:Alt></dc:title>`,
    );
  }
  if (f.author) {
    lines.push(
      `<dc:creator><rdf:Seq><rdf:li>${escapeXml(f.author)}</rdf:li></rdf:Seq></dc:creator>`,
    );
  }
  if (f.subject) {
    lines.push(
      `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(f.subject)}</rdf:li></rdf:Alt></dc:description>`,
    );
  }
  if (f.keywords) lines.push(`<pdf:Keywords>${escapeXml(f.keywords)}</pdf:Keywords>`);
  lines.push(`<pdf:Producer>${escapeXml(f.producer)}</pdf:Producer>`);
  if (f.creator) lines.push(`<xmp:CreatorTool>${escapeXml(f.creator)}</xmp:CreatorTool>`);
  lines.push(
    `<xmp:CreateDate>${xmpDate(f.created)}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${xmpDate(f.modified)}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${xmpDate(f.modified)}</xmp:MetadataDate>`,
  );
  return [
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`,
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">`,
    ...lines,
    `</rdf:Description>`,
    `</rdf:RDF>`,
    `</x:xmpmeta>`,
    `<?xpacket end="w"?>`,
  ].join("\n");
}

/**
 * Point the catalog's /Metadata at a fresh, uncompressed XMP stream. The old
 * stream is deleted: pdf-lib writes every registered object, so leaving it
 * would keep the previous packet in the file.
 */
export function setXmp(doc: PDFDocument, xml: string): void {
  const old = doc.catalog.get(PDFName.of("Metadata"));
  if (old instanceof PDFRef) doc.context.delete(old);
  const stream = doc.context.stream(new TextEncoder().encode(xml), {
    Type: "Metadata",
    Subtype: "XML",
  });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
}
