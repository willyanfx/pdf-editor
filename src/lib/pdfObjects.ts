import { PDFDict, PDFName, PDFStream, type PDFContext, type PDFObject } from "pdf-lib";

/** The dictionary `obj` resolves to (a stream's dictionary for a stream), if any. */
export function dictOf(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | undefined {
  const v = ctx.lookup(obj);
  if (v instanceof PDFDict) return v;
  if (v instanceof PDFStream) return v.dict;
  return undefined;
}

/** The name `obj` resolves to, without its leading slash. */
export function nameOf(ctx: PDFContext, obj: PDFObject | undefined): string | undefined {
  const v = ctx.lookup(obj);
  return v instanceof PDFName ? v.decodeText() : undefined;
}

/** "1 page", "2 pages". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
