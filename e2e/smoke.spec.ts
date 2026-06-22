import { expect, test } from "@playwright/test";
import { FIXTURE_PDF } from "./global-setup";

/**
 * Phase 3 smoke test (item 10 spike). Proves the CI harness can: boot the app
 * under cross-origin isolation, open a PDF through the real file input, and
 * render it — the foundation a fuller suite would build on. Intentionally one
 * test; expand only after this is green in CI.
 */
test("opens a PDF and renders its first page", async ({ page }) => {
  await page.goto("/");

  // The app must be cross-origin isolated for the OCR WASM threads — verifying
  // it here is half the point of the spike (it's the trickiest CI bit).
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);

  // Empty state.
  await expect(page.getByRole("heading", { name: "Browser PDF Editor" })).toBeVisible();

  // Drive the hidden file input directly (the dropzone button clicks it).
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PDF);

  // The viewer mounts a canvas per rendered page once the document loads.
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
});
