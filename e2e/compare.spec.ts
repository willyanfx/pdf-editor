import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Build a PDF whose pages carry the given lines of text; `box` adds a filled
 * rectangle (a purely visual change) to the page index it names. */
async function makePdf(pages: string[][], box?: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((lines, i) => {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, j) => page.drawText(line, { x: 72, y: 700 - j * 24, size: 16, font }));
    if (box === i) {
      page.drawRectangle({ x: 72, y: 300, width: 200, height: 80, color: rgb(0.1, 0.3, 0.8) });
    }
  });
  return Buffer.from(await doc.save());
}

const pdf = (name: string, buffer: Buffer) => ({ name, mimeType: "application/pdf", buffer });

async function openCompare(page: Page) {
  await page.goto("/");
  const box = page.getByPlaceholder("Type a command…");
  // The shortcut listener attaches after hydration, so retry until the palette opens.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(box).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await box.fill("Compare PDFs");
  await page.getByRole("option", { name: "Compare PDFs…" }).first().click();
  await expect(page.getByRole("dialog", { name: "Compare PDFs" })).toBeVisible();
}

test("compare reports text and visual differences page by page", async ({ page }) => {
  const original = await makePdf([
    ["Invoice total: 100 USD", "Thanks"],
    ["Same page"],
    ["Last page"],
  ]);
  const revised = await makePdf(
    [["Invoice total: 250 USD", "Thanks"], ["Same page"], ["Last page"]],
    2, // blue box on page 3, text unchanged
  );
  await openCompare(page);
  const dialog = page.getByRole("dialog", { name: "Compare PDFs" });

  await expect(dialog.getByRole("button", { name: "Compare", exact: true })).toBeDisabled();
  await dialog.getByLabel("Original PDF").setInputFiles(pdf("v1.pdf", original));
  await dialog.getByLabel("Revised PDF").setInputFiles(pdf("v2.pdf", revised));
  await dialog.getByRole("button", { name: "Compare", exact: true }).click();

  await expect(dialog.getByRole("status").first()).toContainText("2 of 3 pages differ", {
    timeout: 30_000,
  });
  await expect(dialog.getByRole("status").first()).toContainText("+1");

  const list = dialog.getByRole("navigation", { name: "Pages" });
  await expect(list.getByRole("button", { name: /Page 1.*Text/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /Page 2.*Identical/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /Page 3.*Visual/ })).toBeVisible();

  // Page 1 is selected first: text tab shows the inline word diff.
  await dialog.getByRole("tab", { name: "Text" }).click();
  await expect(dialog.locator(".cmp-inline del")).toHaveText("100");
  await expect(dialog.locator(".cmp-inline ins")).toHaveText("250");

  // Side by side highlights the changed word on both pages.
  await dialog.getByRole("tab", { name: "Side by side" }).click();
  await expect(dialog.locator(".cmp-rect-del")).toHaveCount(1);
  await expect(dialog.locator(".cmp-rect-ins")).toHaveCount(1);

  // Next changed page skips the identical one and lands on the visual-only change.
  await dialog.getByRole("button", { name: "Next changed page" }).click();
  await dialog.getByRole("tab", { name: "Differences" }).click();
  await expect(dialog.getByText(/Visual differences — [\d,]+ px changed/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Next changed page" })).toBeDisabled();
});

test("identical documents report no differences", async ({ page }) => {
  const bytes = await makePdf([["Nothing changed here"]]);
  await openCompare(page);
  const dialog = page.getByRole("dialog", { name: "Compare PDFs" });
  await dialog.getByLabel("Original PDF").setInputFiles(pdf("a.pdf", bytes));
  await dialog.getByLabel("Revised PDF").setInputFiles(pdf("b.pdf", bytes));
  await dialog.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(dialog.getByRole("status").first()).toContainText("No differences found", {
    timeout: 30_000,
  });
});

test("an extra page in the revision is reported as added", async ({ page }) => {
  const a = await makePdf([["One"]]);
  const b = await makePdf([["One"], ["Two"]]);
  await openCompare(page);
  const dialog = page.getByRole("dialog", { name: "Compare PDFs" });
  await dialog.getByLabel("Original PDF").setInputFiles(pdf("a.pdf", a));
  await dialog.getByLabel("Revised PDF").setInputFiles(pdf("b.pdf", b));
  await dialog.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(
    dialog
      .getByRole("navigation", { name: "Pages" })
      .getByRole("button", { name: /Page 2.*Added/ }),
  ).toBeVisible({ timeout: 30_000 });
});
