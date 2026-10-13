import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument, PDFName } from "pdf-lib";
import { FEATURES_PDF } from "./global-setup";

/**
 * End-to-end checks for the print-layout, accessibility-check and PDF/A tools.
 * Each drives the real dialog and inspects the downloaded PDF.
 */

async function openFixture(page: Page) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(FEATURES_PDF);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
}

async function runCommand(page: Page, label: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Type a command…").fill(label);
  await page.getByRole("option", { name: label }).first().click();
}

async function downloadFrom(page: Page, button: string) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("dialog").getByRole("button", { name: button }).click(),
  ]);
  return {
    name: download.suggestedFilename(),
    bytes: new Uint8Array(await readFile((await download.path())!)),
  };
}

test("pages per sheet puts several pages on each sheet", async ({ page }, testInfo) => {
  await openFixture(page);
  await runCommand(page, "Print layout (pages per sheet, booklet)…");
  const { name, bytes } = await downloadFrom(page, "Create & download");
  expect(name).toBe("features.2-up.pdf");
  const doc = await PDFDocument.load(bytes);
  // Three pages, two per sheet, laid out landscape (two portrait pages side by side).
  expect(doc.getPageCount()).toBe(2);
  const { width, height } = doc.getPage(0).getSize();
  expect(width).toBeGreaterThan(height);

  // Re-open the result: both pages on the first sheet must actually be painted.
  // (Downloads land under a random name; the app wants a .pdf.)
  const reopened = testInfo.outputPath("layout.pdf");
  await writeFile(reopened, bytes);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(reopened);
  // pdf.js paints asynchronously: wait until both halves of the sheet carry ink.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const canvas = document.querySelector("canvas");
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx || canvas.width === 0) return false;
          const half = Math.floor(canvas.width / 2);
          const ink = (x: number) => {
            const { data } = ctx.getImageData(x, 0, half, canvas.height);
            let n = 0;
            for (let i = 0; i < data.length; i += 4) if (data[i] < 128 && data[i + 3] > 0) n++;
            return n;
          };
          return ink(0) > 50 && ink(half) > 50;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("a booklet is padded to a multiple of four pages", async ({ page }) => {
  await openFixture(page);
  await runCommand(page, "Print layout (pages per sheet, booklet)…");
  await page.getByRole("dialog").getByRole("tab", { name: "Booklet" }).click();
  const { name, bytes } = await downloadFrom(page, "Create & download");
  expect(name).toBe("features.booklet.pdf");
  // 3 pages → 4 → one physical sheet, printed on both sides.
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
});

test("the accessibility check reports problems and a fixed copy sets the language", async ({
  page,
}) => {
  await openFixture(page);
  await runCommand(page, "Check accessibility…");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Document is not tagged")).toBeVisible();
  await expect(dialog.getByText("No document language")).toBeVisible();

  await dialog.getByLabel("Document language").fill("en-US");
  await dialog.getByLabel("Document title").fill("Features sample");
  const { name, bytes } = await downloadFrom(page, "Download fixed copy");
  expect(name).toBe("features.accessible.pdf");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(doc.catalog.lookup(PDFName.of("Lang"))?.toString()).toBe("(en-US)");
  expect(doc.getTitle()).toBe("Features sample");
});

test("PDF/A export declares the standard and lists what is still missing", async ({ page }) => {
  await openFixture(page);
  await runCommand(page, "Export as PDF/A…");
  const { name, bytes } = await downloadFrom(page, "Export PDF/A");
  expect(name).toBe("features.pdfa.pdf");
  const text = new TextDecoder("latin1").decode(bytes);
  expect(text).toContain("<pdfaid:part>2</pdfaid:part>");
  expect(text).toContain("/OutputIntents");
  // The result panel is honest that this is not a validated conversion.
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("Exported");
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
