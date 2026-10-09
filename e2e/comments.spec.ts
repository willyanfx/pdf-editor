import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { FEATURES_PDF } from "./global-setup";

/**
 * End-to-end checks for the comment tools: draw with the real UI, work the
 * thread in the Comments panel, then download and inspect the bytes.
 */

async function openFixture(page: Page) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(FEATURES_PDF);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
}

/** Drag across page 1 in page-relative 800px coordinates. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.locator('.page-shell[data-page-index="0"]').boundingBox())!;
  const k = box.width / 800;
  await page.mouse.move(box.x + from[0] * k, box.y + from[1] * k);
  await page.mouse.down();
  await page.mouse.move(box.x + ((from[0] + to[0]) / 2) * k, box.y + ((from[1] + to[1]) / 2) * k, {
    steps: 4,
  });
  await page.mouse.move(box.x + to[0] * k, box.y + to[1] * k, { steps: 4 });
  await page.mouse.up();
}

async function pickShape(page: Page, name: string) {
  await page.getByRole("button", { name: "Shapes & stamps" }).click();
  await page
    .getByRole("dialog", { name: "Shapes and stamps" })
    .getByRole("button", { name })
    .click();
}

async function pickStamp(page: Page, label: string) {
  await page.getByRole("button", { name: "Shapes & stamps" }).click();
  await page
    .getByRole("dialog", { name: "Shapes and stamps" })
    .getByRole("button", { name: label, exact: true })
    .click();
}

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "Comments panel" }).click();
  await expect(page.getByRole("tab", { name: "Comments", selected: true })).toBeVisible();
}

async function download(page: Page, title = "Download edited PDF"): Promise<Uint8Array> {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTitle(title).click()]);
  return new Uint8Array(await readFile(await dl.path()));
}

async function annotsOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots();
  const out: PDFDict[] = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++) out.push(annots!.lookup(i, PDFDict));
  return out;
}
const subtype = (d: PDFDict) => (d.get(PDFName.of("Subtype")) as PDFName).asString();
const text = (d: PDFDict, key: string) =>
  (d.lookup(PDFName.of(key)) as PDFHexString | PDFString | undefined)?.decodeText();

test("every shape tool draws a mark that shows up in the panel", async ({ page }) => {
  await openFixture(page);
  await openPanel(page);
  await expect(page.getByText("No comments yet")).toBeVisible();

  await pickShape(page, "Line");
  await drag(page, [100, 300], [300, 300]);
  await pickShape(page, "Arrow");
  await drag(page, [100, 340], [300, 400]);
  await pickShape(page, "Rectangle");
  await drag(page, [100, 440], [220, 500]);
  await pickShape(page, "Oval");
  await drag(page, [260, 440], [380, 500]);
  await pickShape(page, "Cloud");
  await drag(page, [420, 440], [560, 520]);

  // Polygon: click corners, finish with a double-click.
  await pickShape(page, "Polygon");
  const box = (await page.locator('.page-shell[data-page-index="0"]').boundingBox())!;
  const k = box.width / 800;
  const at = (x: number, y: number) => [box.x + x * k, box.y + y * k] as const;
  await page.mouse.click(...at(500, 300));
  await page.mouse.click(...at(580, 330));
  await page.mouse.click(...at(540, 400));
  await page.mouse.dblclick(...at(480, 360));

  await pickStamp(page, "APPROVED");
  await page.mouse.click(...at(300, 620));

  const rows = page.locator(".cm-row");
  await expect(rows).toHaveCount(7);
  for (const label of ["Line", "Arrow", "Rectangle", "Oval", "Cloud", "Polygon", "Stamp"]) {
    await expect(page.locator(".cm-text").filter({ hasText: label }).first()).toBeVisible();
  }
  await expect(page.locator(".edit-box .shape-preview")).toHaveCount(5);
  await expect(page.locator(".edit-box .stamp-preview")).toHaveText("APPROVED");
});

test("thread: note, replies and status, then kept as native comments", async ({ page }) => {
  await openFixture(page);
  await pickShape(page, "Rectangle");
  await drag(page, [100, 300], [300, 380]);
  await openPanel(page);

  // The new rectangle's thread is open already (it is selected on the page).
  await page.getByLabel("Comment note").fill("Check this clause");
  await page.getByLabel("Review status", { exact: true }).selectOption("accepted");
  await page.getByLabel("Reply", { exact: true }).fill("Agreed, thanks");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.locator(".cm-reply-text")).toHaveText("Agreed, thanks");
  await expect(page.locator(".cm-status-accepted")).toBeVisible();

  await page.getByLabel("Commenting as").fill("Grace");
  await page.getByLabel("On download").selectOption("native");

  const annots = await annotsOf(await download(page));
  const square = annots.find((a) => subtype(a) === "/Square")!;
  expect(text(square, "Contents")).toBe("Check this clause");
  expect(text(square, "T")).toBe("Anonymous"); // created before the name was set
  const replies = annots.filter((a) => a.has(PDFName.of("IRT")));
  expect(replies).toHaveLength(2); // status + one reply
  expect(replies.some((r) => text(r, "Contents") === "Agreed, thanks")).toBe(true);
  expect(replies.some((r) => text(r, "State") === "Accepted")).toBe(true);
});

test("flatten is the default: marks are drawn into the page, no annotations", async ({ page }) => {
  await openFixture(page);
  await pickShape(page, "Oval");
  await drag(page, [100, 300], [300, 380]);
  const annots = await annotsOf(await download(page));
  expect(annots).toHaveLength(0);
});

test("the command palette downloads with comments kept or flattened, whatever the preference", async ({
  page,
}) => {
  await openFixture(page);
  await pickShape(page, "Cloud");
  await drag(page, [100, 300], [300, 380]);

  const run = async (label: string) => {
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder("Type a command…").fill(label);
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("option", { name: label }).first().click(),
    ]);
    return new Uint8Array(await readFile(await dl.path()));
  };

  expect((await annotsOf(await run("Download with editable comments"))).map(subtype)).toEqual([
    "/Square",
  ]);
  expect(await annotsOf(await run("Download with comments flattened"))).toHaveLength(0);
});

test("filters and sort narrow the list", async ({ page }) => {
  await openFixture(page);
  await pickShape(page, "Rectangle");
  await drag(page, [100, 300], [200, 360]);
  await pickShape(page, "Oval");
  await drag(page, [300, 300], [400, 360]);
  await pickStamp(page, "DRAFT");
  const box = (await page.locator('.page-shell[data-page-index="0"]').boundingBox())!;
  await page.mouse.click(box.x + 300 * (box.width / 800), box.y + 600 * (box.width / 800));
  await openPanel(page);
  await expect(page.locator(".cm-row")).toHaveCount(3);

  await page.getByLabel("Filter by type").selectOption("oval");
  await expect(page.locator(".cm-row")).toHaveCount(1);
  await expect(page.locator(".cm-count")).toContainText("1 of 3");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.locator(".cm-row")).toHaveCount(3);

  await page.getByLabel("Search comments").fill("draft");
  await expect(page.locator(".cm-row")).toHaveCount(1);
  await page.getByLabel("Search comments").fill("");

  await page.getByLabel("Sort comments").selectOption("type");
  const labels = await page.locator(".cm-text").allTextContents();
  expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));

  await page.getByLabel("Filter by review status").selectOption("rejected");
  await expect(page.getByText("No comments match these filters.")).toBeVisible();
});

test("XFDF: export, then import into a fresh copy restores the comments", async ({ page }) => {
  await openFixture(page);
  await pickShape(page, "Arrow");
  await drag(page, [100, 300], [300, 380]);
  await openPanel(page);
  await page.getByLabel("Comment note").fill('Look <here> & "there"');
  await page.getByLabel("Reply", { exact: true }).fill("On it");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByLabel("Review status", { exact: true }).selectOption("completed");

  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export XFDF" }).click(),
  ]);
  const xfdf = (await readFile(await dl.path())).toString("utf8");
  expect(dl.suggestedFilename()).toMatch(/\.xfdf$/);
  expect(xfdf).toContain('xmlns="http://ns.adobe.com/xfdf/"');
  expect(xfdf).toMatch(/<line[^>]*tail="OpenArrow"/);
  expect(xfdf).toContain("Look &lt;here&gt; &amp; &quot;there&quot;");

  // Re-importing into the same document adds nothing (same ids)…
  const importXfdf = async () => {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Import XFDF" }).click(),
    ]);
    await chooser.setFiles({
      name: "c.xfdf",
      mimeType: "application/xml",
      buffer: Buffer.from(xfdf),
    });
  };
  await importXfdf();
  await expect(page.getByText("No new comments to import")).toBeVisible();
  await expect(page.locator(".cm-row")).toHaveCount(1);

  // …but after deleting the comment, it comes back whole, thread and status included.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".cm-row")).toHaveCount(0);
  await importXfdf();
  await expect(page.locator(".cm-row")).toHaveCount(1);
  await page.locator(".cm-row").click();
  await expect(page.getByLabel("Comment note")).toHaveValue('Look <here> & "there"');
  await expect(page.locator(".cm-reply-text")).toHaveText("On it");
  await expect(page.getByLabel("Review status", { exact: true })).toHaveValue("completed");
});

test("importing a file that is not XFDF is rejected without changing anything", async ({
  page,
}) => {
  await openFixture(page);
  await openPanel(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Import XFDF" }).click(),
  ]);
  await chooser.setFiles({ name: "x.xfdf", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("isn't a valid XFDF")).toBeVisible();
  await expect(page.getByText("No comments yet")).toBeVisible();
});

test("shapes drawn while zoomed are stored in unzoomed page space", async ({ page }) => {
  await openFixture(page);
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Zoom in" }).click();
  await pickShape(page, "Rectangle");
  await drag(page, [100, 300], [300, 380]);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Type a command…").fill("Download with editable comments");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("option", { name: "Download with editable comments" }).first().click(),
  ]);
  const annots = await annotsOf(new Uint8Array(await readFile(await dl.path())));
  const rect = (
    annots[0].lookup(PDFName.of("Rect")) as unknown as { asArray(): { asNumber(): number }[] }
  )
    .asArray()
    .map((n) => n.asNumber());
  // Letter page: 612pt wide → 800px space is ×0.765. Box (100,300)-(300,380)px.
  const k = 612 / 800;
  expect(rect[0]).toBeCloseTo(100 * k, 0);
  expect(rect[2]).toBeCloseTo(300 * k, 0);
  expect(rect[1]).toBeCloseTo(792 - 380 * k, 0);
  expect(rect[3]).toBeCloseTo(792 - 300 * k, 0);
});
