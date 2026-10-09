import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { FEATURES_PDF, FORM_PDF } from "./global-setup";

/**
 * End-to-end checks for the Acrobat-parity features: each drives the real UI,
 * downloads the edited PDF and inspects the bytes with pdf.js, so it proves
 * the whole path from store to export.
 */

async function openFixture(page: Page, fixture = FEATURES_PDF) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
}

async function runCommand(page: Page, label: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Type a command…").fill(label);
  await page.getByRole("option", { name: label }).first().click();
}

async function downloadPdf(page: Page): Promise<Uint8Array> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTitle("Download edited PDF").click(),
  ]);
  return new Uint8Array(await readFile(await download.path()));
}

async function openWithPdfJs(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
}

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await openWithPdfJs(bytes);
  const texts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    texts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return texts;
}

test("page numbers are stamped on every page of the download", async ({ page }) => {
  await openFixture(page);
  await runCommand(page, "Add page numbers…");
  await page.getByRole("dialog").getByRole("button", { name: "Apply" }).click();

  const texts = await pageTexts(await downloadPdf(page));
  expect(texts).toHaveLength(3);
  texts.forEach((t, i) => expect(t).toContain(`Page ${i + 1} of 3`));
});

test("a bookmark added with ⌘B is written to the downloaded outline", async ({ page }) => {
  await openFixture(page);
  await page.locator("body").click();
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("Enter");

  const pdf = await openWithPdfJs(await downloadPdf(page));
  const outline = await pdf.getOutline();
  expect(outline).toHaveLength(1);
});

test("duplicating a page adds a real page to the download", async ({ page }) => {
  await openFixture(page);
  await runCommand(page, "Duplicate selected pages");
  await expect.poll(() => page.evaluate(() => document.querySelectorAll(".page-shell").length)).toBe(4);

  const texts = await pageTexts(await downloadPdf(page));
  expect(texts.map((t) => t.trim())).toEqual([
    "Alpha page",
    "Alpha page",
    "Bravo page",
    "Charlie page",
  ]);
});

test("unsaved changes can be recovered after a reload", async ({ page }) => {
  await openFixture(page);
  await runCommand(page, "Add page numbers…");
  await page.getByRole("dialog").getByRole("button", { name: "Apply" }).click();
  // Autosave is debounced; give it time to land in IndexedDB.
  await page.waitForTimeout(2_500);

  page.on("dialog", (d) => void d.accept());
  await page.reload();
  const banner = page.getByRole("region", { name: "Recover unsaved changes" });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await banner.getByRole("button", { name: "Recover" }).click();
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

  const texts = await pageTexts(await downloadPdf(page));
  expect(texts[0]).toContain("Page 1 of 3");
});

test("filled form fields survive page deletion in the download", async ({ page }) => {
  await openFixture(page, FORM_PDF);
  const field = page.locator(".annotationLayer input[type='text']").first();
  await expect(field).toBeVisible({ timeout: 10_000 });
  await field.fill("Ada Lovelace");
  await page.locator(".annotationLayer input[type='checkbox']").first().check();

  // Deleting a page takes export's reorder path, which used to drop the form.
  // Driven through the store module the dev server serves (no page-delete UI
  // without the sidebar open); the URL is passed in so tsc doesn't resolve it.
  await page.evaluate(async (storeUrl) => {
    const mod = await import(/* @vite-ignore */ storeUrl);
    mod.useEditorStore.getState().deletePage(1);
  }, "/pdf-editor/src/store/useEditorStore.ts");

  const doc = await PDFDocument.load(await downloadPdf(page));
  expect(doc.getPageCount()).toBe(1);
  const form = doc.getForm();
  expect(form.getTextField("applicant.name").getText()).toBe("Ada Lovelace");
  expect(form.getCheckBox("agree").isChecked()).toBe(true);
});

test("redacted text is gone from the download; unmarked text stays searchable", async ({
  page,
}) => {
  await openFixture(page);
  // Redact mode, then drag across page 1's "Alpha page" line (drawn at
  // x=72pt, baseline 700pt on a 612×792 page → ~94–230px, ~96–121px at 800px).
  await page.locator("body").click();
  await page.keyboard.press("r");
  const shell = page.locator('.page-shell[data-page-index="0"]');
  const box = (await shell.boundingBox())!;
  const k = box.width / 800;
  await page.mouse.move(box.x + 60 * k, box.y + 80 * k);
  await page.mouse.down();
  await page.mouse.move(box.x + 340 * k, box.y + 135 * k, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll(".edit-box").length))
    .toBeGreaterThan(0);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByTitle("Download edited PDF").click();
      await page.getByRole("button", { name: "Apply redactions" }).click();
    })(),
  ]);
  const bytes = new Uint8Array(await readFile(await download.path()));
  const texts = await pageTexts(bytes);
  expect(texts[0]).not.toContain("Alpha");
  expect(texts[1]).toContain("Bravo page");
  expect(texts[2]).toContain("Charlie page");
  // No trace of the redacted string anywhere in the raw file either.
  expect(Buffer.from(bytes).toString("latin1")).not.toContain("Alpha");
});
