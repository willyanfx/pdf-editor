import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { FEATURES_PDF } from "./global-setup";

/**
 * End-to-end checks for the Acrobat-parity features: each drives the real UI,
 * downloads the edited PDF and inspects the bytes with pdf.js, so it proves
 * the whole path from store to export.
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
