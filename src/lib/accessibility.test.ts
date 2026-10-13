import { PDFDocument, PDFName, PDFString, type PDFRef } from "pdf-lib";

/** A structure-element dictionary as plain data, for `context.obj`. */
type Elem = Record<string, string | PDFString | PDFRef[] | undefined>;
import { describe, expect, it } from "vite-plus/test";
import { applyA11yFixes, checkAccessibility, type A11yReport } from "./accessibility";

type Spec = {
  lang?: string;
  title?: string;
  tagged?: boolean;
  /** Structure elements under the Document element. */
  elements?: (ctx: PDFDocument["context"], page: PDFRef) => Elem[];
};

async function build(spec: Spec = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  if (spec.title) doc.setTitle(spec.title);
  if (spec.lang) doc.catalog.set(PDFName.of("Lang"), PDFString.of(spec.lang));
  if (spec.tagged) {
    const kids = (spec.elements?.(ctx, page.ref) ?? []).map((e) =>
      ctx.register(ctx.obj(e as never)),
    );
    const documentEl = ctx.register(
      ctx.obj({ Type: "StructElem", S: "Document", Pg: page.ref, K: kids }),
    );
    const root = ctx.register(ctx.obj({ Type: "StructTreeRoot", K: [documentEl] }));
    doc.catalog.set(PDFName.of("StructTreeRoot"), root);
    doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  }
  return doc.save();
}

const byId = (r: A11yReport, id: string) => r.checks.find((c) => c.id === id);

describe("checkAccessibility", () => {
  it("fails an untagged document with no language or title", async () => {
    const report = await checkAccessibility(await build());
    expect(report.tagged).toBe(false);
    expect(byId(report, "tagged")?.status).toBe("fail");
    expect(byId(report, "language")?.status).toBe("fail");
    expect(byId(report, "title")?.status).toBe("fail");
  });

  it("accepts language and title, and asks about the window title", async () => {
    const report = await checkAccessibility(await build({ lang: "en-US", title: "Report" }));
    expect(byId(report, "language")?.status).toBe("pass");
    expect(byId(report, "title")?.status).toBe("pass");
    expect(byId(report, "display-title")?.status).toBe("warn");
  });

  it("warns about a malformed language tag", async () => {
    const report = await checkAccessibility(await build({ lang: "english please" }));
    expect(byId(report, "language")?.status).toBe("warn");
  });

  it("finds figures without alternate text and reports their pages", async () => {
    const report = await checkAccessibility(
      await build({
        tagged: true,
        elements: () => [
          { Type: "StructElem", S: "Figure" },
          { Type: "StructElem", S: "Figure", Alt: PDFString.of("A chart of sales") },
        ],
      }),
    );
    const figures = byId(report, "figures");
    expect(figures?.status).toBe("fail");
    expect(figures?.title).toMatch(/1 figure without/);
    expect(figures?.pages).toEqual([1]);
  });

  it("flags skipped heading levels but not ordered ones", async () => {
    const skipping = await checkAccessibility(
      await build({
        tagged: true,
        elements: () => [
          { Type: "StructElem", S: "H1" },
          { Type: "StructElem", S: "H3" },
        ],
      }),
    );
    expect(byId(skipping, "headings")?.status).toBe("warn");
    const ordered = await checkAccessibility(
      await build({
        tagged: true,
        elements: () => [
          { Type: "StructElem", S: "H1" },
          { Type: "StructElem", S: "H2" },
        ],
      }),
    );
    expect(byId(ordered, "headings")?.status).toBe("pass");
  });

  it("follows the role map when classifying elements", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const ctx = doc.context;
    const fig = ctx.register(ctx.obj({ Type: "StructElem", S: "Picture", Pg: page.ref }));
    const root = ctx.register(
      ctx.obj({ Type: "StructTreeRoot", K: [fig], RoleMap: { Picture: "Figure" } }),
    );
    doc.catalog.set(PDFName.of("StructTreeRoot"), root);
    const report = await checkAccessibility(await doc.save());
    expect(byId(report, "figures")?.status).toBe("fail");
  });

  it("requires header cells in tables", async () => {
    const withTh = await checkAccessibility(
      await build({
        tagged: true,
        elements: (ctx) => [
          {
            Type: "StructElem",
            S: "Table",
            K: [
              ctx.register(
                ctx.obj({
                  Type: "StructElem",
                  S: "TR",
                  K: [ctx.register(ctx.obj({ Type: "StructElem", S: "TH" }))],
                }),
              ),
            ],
          },
        ],
      }),
    );
    expect(byId(withTh, "tables")?.status).toBe("pass");
    const without = await checkAccessibility(
      await build({
        tagged: true,
        elements: (ctx) => [
          {
            Type: "StructElem",
            S: "Table",
            K: [
              ctx.register(
                ctx.obj({
                  Type: "StructElem",
                  S: "TR",
                  K: [ctx.register(ctx.obj({ Type: "StructElem", S: "TD" }))],
                }),
              ),
            ],
          },
        ],
      }),
    );
    expect(byId(without, "tables")?.status).toBe("warn");
  });

  it("reports scanned documents when the caller says so", async () => {
    const report = await checkAccessibility(await build(), { scanned: true });
    expect(byId(report, "text")?.status).toBe("fail");
  });

  it("always lists the checks a person has to make", async () => {
    const report = await checkAccessibility(await build());
    expect(report.checks.filter((c) => c.status === "manual").length).toBeGreaterThanOrEqual(3);
    expect(
      report.counts.fail + report.counts.warn + report.counts.pass + report.counts.manual,
    ).toBe(report.checks.length);
  });

  it("flags form fields with no tooltip", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const form = doc.getForm();
    form.createTextField("name").addToPage(page, { x: 10, y: 10 });
    const labelled = form.createTextField("email");
    labelled.addToPage(page, { x: 10, y: 50 });
    labelled.acroField.dict.set(PDFName.of("TU"), PDFString.of("Email address"));
    const report = await checkAccessibility(await doc.save());
    const forms = byId(report, "forms");
    expect(forms?.status).toBe("fail");
    expect(forms?.title).toMatch(/^1 form field without/);
  });
});

describe("applyA11yFixes", () => {
  it("sets language, title and the title display preference", async () => {
    const fixed = await applyA11yFixes(await build(), { lang: "fr-CA", title: "Rapport" });
    const report = await checkAccessibility(fixed);
    expect(byId(report, "language")?.status).toBe("pass");
    expect(byId(report, "title")?.status).toBe("pass");
    expect(byId(report, "display-title")).toBeUndefined();
  });

  it("rejects an invalid language tag", async () => {
    await expect(applyA11yFixes(await build(), { lang: "not a tag" })).rejects.toThrow(
      /language tag/,
    );
  });
});
