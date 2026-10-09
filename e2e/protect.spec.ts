import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PDF } from "./global-setup";

/** Latin-1 view of the bytes: enough to grep PDF structure like `/Encrypt`. */
const asText = async (path: string) => (await readFile(path)).toString("latin1");

async function openFixture(page: Page, path: string = FIXTURE_PDF) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(path);
}

test("protects a PDF with a password, reopens it, and exports it unprotected", async ({ page }) => {
  await openFixture(page);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

  // --- Add protection ----------------------------------------------------
  await page.getByRole("button", { name: "Protect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Protect PDF" });
  await expect(dialog).toBeVisible();

  const submit = dialog.getByRole("button", { name: "Protect & Download" });
  await expect(submit).toBeDisabled(); // nothing set yet
  await dialog.getByLabel("Password to open").fill("open-sesame");
  await expect(submit).toBeEnabled();

  // "Remove protection" is only offered for an encrypted source.
  await expect(dialog.getByRole("tab", { name: "Remove protection" })).toBeDisabled();

  const protectedDownload = page.waitForEvent("download");
  await submit.click();
  const protectedPath = test.info().outputPath("protected.pdf");
  await (await protectedDownload).saveAs(protectedPath);

  expect(await asText(protectedPath)).toContain("/Encrypt");

  // --- Reopen it: pdf.js must demand the password ------------------------
  await openFixture(page, protectedPath);
  const unlock = page.getByRole("dialog", { name: "Unlock PDF" });
  await expect(unlock).toBeVisible({ timeout: 15_000 });
  await unlock.getByLabel("PDF password").fill("wrong");
  await unlock.getByRole("button", { name: "Unlock" }).click();
  await expect(unlock.getByText(/incorrect/i)).toBeVisible();
  await unlock.getByLabel("PDF password").fill("open-sesame");
  await unlock.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

  // --- A plain export of an encrypted source used to fail outright --------
  const plainDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /^download/i }).click();
  const plainPath = test.info().outputPath("plain.pdf");
  await (await plainDownload).saveAs(plainPath);
  expect(await asText(plainPath)).not.toContain("/Encrypt");
  await expect(page.getByText(/without its password protection/)).toBeVisible();

  // --- Explicit "remove protection" --------------------------------------
  await page.getByRole("button", { name: "Protect", exact: true }).click();
  const dialog2 = page.getByRole("dialog", { name: "Protect PDF" });
  await dialog2.getByRole("tab", { name: "Remove protection" }).click();
  const unlockedDownload = page.waitForEvent("download");
  await dialog2.getByRole("button", { name: "Remove & Download" }).click();
  const unlockedPath = test.info().outputPath("unlocked.pdf");
  await (await unlockedDownload).saveAs(unlockedPath);
  expect(await asText(unlockedPath)).not.toContain("/Encrypt");
});

test("permission restrictions require a distinct permissions password", async ({ page }) => {
  await openFixture(page);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Protect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Protect PDF" });
  const submit = dialog.getByRole("button", { name: "Protect & Download" });

  await dialog.getByLabel("Printing").selectOption("none");
  await dialog.getByLabel("Copying text and images").uncheck();
  await expect(submit).toBeDisabled();
  await expect(dialog.getByText(/Set a permissions password/)).toBeVisible();

  await dialog.getByLabel("Permissions password").fill("boss");
  await expect(submit).toBeEnabled();

  const download = page.waitForEvent("download");
  await submit.click();
  const path = test.info().outputPath("restricted.pdf");
  await (await download).saveAs(path);

  // Owner-only protection: opens without a password prompt, but is encrypted.
  expect(await asText(path)).toContain("/Encrypt");
  await openFixture(page, path);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog", { name: "Unlock PDF" })).toHaveCount(0);

  // Downloading that file strips the restrictions — even with no password
  // having been typed — and says so.
  const redownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /^download/i }).click();
  await redownload;
  await expect(page.getByText(/without its password protection/)).toBeVisible();
});
