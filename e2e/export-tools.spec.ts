import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { DIRTY_PDF, FEATURES_PDF } from "./global-setup";

/**
 * End-to-end checks for exporting pages as images, saving embedded images and
 * removing hidden information. Each drives the real dialogs and inspects the
 * downloaded bytes, so they cover the pdf.js render path unit tests can't reach.
 */

async function openFixture(page: Page, fixture: string) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
}

async function runCommand(page: Page, label: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Type a command…").fill(label);
  await page.getByRole("option", { name: label }).first().click();
}

/** Click `button` in the open dialog and return the file it downloads. */
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

/** File names stored in a ZIP's central directory. */
function zipNames(zip: Uint8Array): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset);
  const eocd = zip.length - 22;
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = view.getUint16(pos + 28, true);
    names.push(new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + len)));
    pos += 46 + len + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
  }
  return names;
}

/** Count of non-white pixels in an image, decoded by the browser itself. */
async function inkPixels(page: Page, image: Uint8Array): Promise<number> {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) ink++;
    return ink;
  }, Buffer.from(image).toString("base64"));
}

function pngSize(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

test("all pages export as a zip of numbered PNGs", async ({ page }) => {
  await openFixture(page, FEATURES_PDF);
  await runCommand(page, "Export pages as images (PNG/JPEG)…");
  const { name, bytes } = await downloadFrom(page, "Export");
  expect(name).toBe("features-pages-png.zip");
  expect(zipNames(bytes)).toEqual([
    "features-page-1.png",
    "features-page-2.png",
    "features-page-3.png",
  ]);
});

test("a single page exports as one JPEG at the chosen resolution", async ({ page }) => {
  await openFixture(page, FEATURES_PDF);
  await runCommand(page, "Export pages as images (PNG/JPEG)…");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Current page").check();
  await dialog.getByRole("tab", { name: "JPEG" }).click();
  await dialog.getByLabel("Resolution").selectOption("72");
  const { name, bytes } = await downloadFrom(page, "Export");
  expect(name).toBe("features-page-1.jpg");
  expect(Array.from(bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]); // JPEG SOI
});

test("a PNG at 150 DPI has 150/72 the page's point size in pixels", async ({ page }) => {
  await openFixture(page, FEATURES_PDF);
  await runCommand(page, "Export pages as images (PNG/JPEG)…");
  await page.getByRole("dialog").getByLabel("Current page").check();
  const { name, bytes } = await downloadFrom(page, "Export");
  expect(name).toBe("features-page-1.png");
  // The page's "Alpha page" text is in the image, not a blank sheet.
  expect(await inkPixels(page, bytes)).toBeGreaterThan(500);
  expect(pngSize(bytes)).toEqual({
    width: (612 * 150) / 72,
    height: (792 * 150) / 72,
  });
});

test("embedded images are saved from the page that uses them", async ({ page }) => {
  await openFixture(page, DIRTY_PDF);
  await runCommand(page, "Save embedded images…");
  const dialog = page.getByRole("dialog");
  // The fixture's only image is 1x1, below the default small-image cutoff.
  await dialog.getByLabel(/Skip small images/).uncheck();
  const { name, bytes } = await downloadFrom(page, "Save images");
  expect(name).toBe("dirty-page-1-image-1.png");
  expect(pngSize(bytes)).toEqual({ width: 1, height: 1 });
});

test("remove hidden information strips metadata, attachments and comments", async ({ page }) => {
  await openFixture(page, DIRTY_PDF);
  await runCommand(page, "Remove hidden information…");
  const dialog = page.getByRole("dialog");
  // The dialog lists what it found before anything is removed.
  await expect(dialog.getByText("Comments and markup")).toBeVisible();
  await expect(dialog.locator(".export-count").nth(1)).toHaveText("1");

  const { name, bytes } = await downloadFrom(page, "Remove & download");
  expect(name).toBe("dirty.clean.pdf");

  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(doc.getAuthor()).toBeUndefined();
  expect(doc.getTitle()).toBeUndefined();
  expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  const catalogNames = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  expect(catalogNames?.has(PDFName.of("EmbeddedFiles")) ?? false).toBe(false);
  // The page itself is untouched.
  expect(doc.getPageCount()).toBe(1);
});
