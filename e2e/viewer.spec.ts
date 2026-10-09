import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { VIEWER_PDF } from "./global-setup";

/**
 * Viewer-comfort features: find options, two-page view, theme, full screen,
 * hand tool, attachments and layers. Each drives the real UI against the
 * six-page viewer.pdf fixture (see global-setup).
 */

const EDITOR_STORE = "/pdf-editor/src/store/useEditorStore.ts";

async function openViewer(page: Page) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(VIEWER_PDF);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
}

/** Where each rendered page sits on screen, as { page → [x, y] }. */
async function pagePositions(page: Page): Promise<Record<number, [number, number]>> {
  return page.evaluate(() => {
    const out: Record<number, [number, number]> = {};
    for (const el of document.querySelectorAll<HTMLElement>(".page-shell")) {
      const b = el.getBoundingClientRect();
      out[Number(el.dataset.pageIndex)] = [Math.round(b.x), Math.round(b.y)];
    }
    return out;
  });
}

const pageReadout = (page: Page) => page.getByLabel("Page number");

async function openSidebarTab(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Organize pages" }).click();
  await page.getByRole("tab", { name }).click();
}

test("find: match case and whole words narrow the matches", async ({ page }) => {
  await openViewer(page);
  // Three text boxes: "Cat", "concatenate", "cat".
  await page.evaluate(
    async ([storeUrl]) => {
      const mod = await import(/* @vite-ignore */ storeUrl);
      const store = mod.useEditorStore.getState();
      ["Cat", "concatenate", "cat"].forEach((text, i) => {
        store.addEdit(
          mod.makeTextEdit({
            pageIndex: 0,
            x: 100,
            y: 100 + i * 60,
            width: 200,
            height: 30,
            runs: mod.textToRuns(text),
          }),
        );
      });
    },
    [EDITOR_STORE],
  );

  await page.locator("body").click();
  await page.keyboard.press("ControlOrMeta+f");
  const input = page.getByLabel("Find in page");
  const count = page.locator(".find-count");
  const matchCase = page.getByRole("button", { name: "Match case" });
  const wholeWord = page.getByRole("button", { name: "Whole words only" });

  await input.fill("cat");
  await expect(count).toHaveText("1/3"); // Cat, concatenate, cat

  await matchCase.click();
  await expect(matchCase).toHaveAttribute("aria-pressed", "true");
  await expect(count).toHaveText("1/2"); // concatenate, cat

  await wholeWord.click();
  await expect(count).toHaveText("1/1"); // cat

  await matchCase.click(); // whole word only: Cat, cat
  await expect(count).toHaveText("1/2");

  // Keyboard toggles from inside the box.
  await input.press("Alt+KeyW");
  await expect(wholeWord).toHaveAttribute("aria-pressed", "false");
  await input.press("Alt+KeyC");
  await expect(matchCase).toHaveAttribute("aria-pressed", "true");
  await expect(count).toHaveText("1/2"); // concatenate, cat
});

test("two-page view pairs pages, steps by row, and honours the cover page", async ({ page }) => {
  await openViewer(page);
  const twoPage = page.getByRole("button", { name: "Two-page view" });
  await twoPage.click();
  await expect(twoPage).toHaveAttribute("aria-pressed", "true");

  // Pages 1 and 2 share a row; page 3 starts the next.
  await expect.poll(async () => (await pagePositions(page))[1]).toBeTruthy();
  let pos = await pagePositions(page);
  expect(pos[1][1]).toBe(pos[0][1]);
  expect(pos[1][0]).toBeGreaterThan(pos[0][0]);
  expect(pos[2][1]).toBeGreaterThan(pos[0][1]);
  expect(pos[2][0]).toBe(pos[0][0]);

  // Fit-width kicked in, so nothing overflows the stage sideways.
  expect(
    await page.locator(".pdf-wrapper").evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);

  // Next moves a whole row: page 1 → 3.
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(pageReadout(page)).toHaveValue("3");
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(pageReadout(page)).toHaveValue("1");

  // Cover page: page 1 alone on the right, pages 2 and 3 paired below.
  await page.getByRole("button", { name: "Show cover page" }).click();
  await expect
    .poll(async () => {
      const p = await pagePositions(page);
      return p[1] && p[2] && p[0] && p[1][1] === p[2][1] && p[1][1] > p[0][1] && p[0][0] > p[1][0];
    })
    .toBe(true);

  // Switching back to single view keeps the page you were on.
  await page.getByRole("button", { name: "Show cover page" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(pageReadout(page)).toHaveValue("5");
  await twoPage.click();
  await expect(twoPage).toHaveAttribute("aria-pressed", "false");
  await expect(pageReadout(page)).toHaveValue("5");
  await expect
    .poll(async () => {
      const p = await pagePositions(page);
      return p[4] && Math.abs(p[4][1] - (await page.locator(".pdf-wrapper").boundingBox())!.y) < 80;
    })
    .toBe(true);
});

test("jumping to a page lands on it at any zoom", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: "Zoom in" }).click(); // 125%
  await page.getByRole("button", { name: "Zoom in" }).click(); // 150%
  const readout = pageReadout(page);
  await readout.fill("4");
  await readout.press("Enter");
  await expect(readout).toHaveValue("4");
  const top = await page.locator(".pdf-wrapper").boundingBox();
  await expect
    .poll(async () => {
      const p = await pagePositions(page);
      return p[3] && Math.abs(p[3][1] - top!.y) < 60;
    })
    .toBe(true);
});

test("a deleted page leaves no gap and page stepping skips it", async ({ page }) => {
  await openViewer(page);
  await page.evaluate(
    async ([storeUrl]) => {
      const mod = await import(/* @vite-ignore */ storeUrl);
      mod.useEditorStore.getState().deletePage(1); // page 2
    },
    [EDITOR_STORE],
  );

  // Pages 1, 3, 4 … sit one evenly spaced row apart: no blank slot for page 2.
  await expect.poll(async () => Object.keys(await pagePositions(page)).includes("1")).toBe(false);
  const pos = await pagePositions(page);
  // Evenly spaced rows (allowing for sub-pixel rounding of fractional page heights).
  expect(Math.abs(pos[2][1] - pos[0][1] - (pos[3][1] - pos[2][1]))).toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(pageReadout(page)).toHaveValue("3");
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(pageReadout(page)).toHaveValue("1");
});

test("jumping to a deleted page lands on the nearest shown one", async ({ page }) => {
  await openViewer(page);
  await page.evaluate(
    async ([storeUrl]) => {
      const mod = await import(/* @vite-ignore */ storeUrl);
      mod.useEditorStore.getState().deletePage(2); // page 3
    },
    [EDITOR_STORE],
  );
  await expect.poll(async () => Object.keys(await pagePositions(page)).includes("2")).toBe(false);
  const readout = pageReadout(page);
  await readout.fill("3");
  await readout.press("Enter");
  // Page 3 is gone, so the readout settles on a page that is actually shown.
  await expect(readout).not.toHaveValue("3");
});

test("a rotated page does not overlap its neighbour in two-page view", async ({ page }) => {
  await openViewer(page);
  await page.evaluate(
    async ([storeUrl]) => {
      const mod = await import(/* @vite-ignore */ storeUrl);
      mod.useEditorStore.getState().rotatePages([1], 90);
    },
    [EDITOR_STORE],
  );
  await page.getByRole("button", { name: "Two-page view" }).click();
  await expect
    .poll(async () => {
      const pos = await pagePositions(page);
      return !!pos[0] && !!pos[1] && pos[1][1] === pos[0][1];
    })
    .toBe(true);
  // The rotated page's visual box (page 2) must start where page 1's ends.
  const rects = await page.evaluate(() =>
    [0, 1].map((i) => {
      const t = document
        .querySelector(`.page-shell[data-page-index="${i}"] .page-transform`)!
        .getBoundingClientRect();
      return { left: t.left, right: t.right };
    }),
  );
  expect(rects[1].left).toBeGreaterThanOrEqual(rects[0].right);
});

test("leaving two-page view restores the zoom the automatic fit replaced", async ({ page }) => {
  await openViewer(page);
  const level = page.locator(".bottombar-zoom-level");
  await expect(level).toHaveText("100%");
  const twoPage = page.getByRole("button", { name: "Two-page view" });
  await twoPage.click();
  await expect(level).toHaveText("Fit width");
  await twoPage.click();
  await expect(level).toHaveText("100%");

  // A zoom the user picks while in two-page view is theirs to keep.
  await twoPage.click();
  await expect(level).toHaveText("Fit width");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await twoPage.click();
  await expect(level).not.toHaveText("100%");
  await expect(level).not.toHaveText("Fit width");
});

test("dark theme toggles, persists across reloads, and leaves the page white", async ({ page }) => {
  await openViewer(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light"); // Chromium defaults to light

  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  const paper = await page
    .locator('.page-shell[data-page-index="0"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(paper).toBe("rgb(255, 255, 255)");
  const stage = await page
    .locator(".pdf-wrapper")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(stage).not.toBe("rgb(255, 255, 255)");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
});

test("the OS color scheme sets the initial theme", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await context.close();
});

test("full screen hides the chrome and Esc brings it back", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: "Full screen" }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".tool-rail")).toBeHidden();
  await expect(page.getByRole("button", { name: "Exit full screen" })).toBeVisible();

  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".tool-rail")).toBeVisible();
});

test("hand tool pans the stage and makes the pages inert; Space pans temporarily", async ({
  page,
}) => {
  await openViewer(page);
  const stage = page.locator(".pdf-wrapper");
  const scrollTop = () => stage.evaluate((el) => el.scrollTop);
  const box = (await stage.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.getByRole("button", { name: /^Hand tool/ }).click();
  await expect(stage).toHaveClass(/is-hand/);
  const before = await scrollTop();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 150, { steps: 6 });
  await page.mouse.up();
  expect(await scrollTop()).toBeGreaterThan(before + 100);

  // Back to Select: no hand, until Space is held.
  await page.getByRole("button", { name: /^Select/ }).click();
  await expect(stage).not.toHaveClass(/is-hand/);
  await page.mouse.move(x, y);
  await page.keyboard.down("Space");
  await expect(stage).toHaveClass(/is-hand/);
  await page.keyboard.up("Space");
  await expect(stage).not.toHaveClass(/is-hand/);
});

test("attachments panel lists embedded files and saves their bytes", async ({ page }) => {
  await openViewer(page);
  await openSidebarTab(page, /^Attachments/);

  const rows = page.locator(".att-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("notes.txt");
  await expect(rows.nth(0)).toContainText("Project notes");
  await expect(rows.nth(1)).toContainText("data.csv");
  await expect(rows.nth(2)).toContainText("pinned.txt");
  await expect(rows.nth(2)).toContainText("Page 2");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save notes.txt" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("notes.txt");
  expect(await readFile(await download.path(), "utf8")).toBe("Project notes\n");

  // The page link scrolls to the page the file is pinned to.
  await rows.nth(2).getByRole("button", { name: "Page 2" }).click();
  await expect(pageReadout(page)).toHaveValue("2");
});

test("a PDF without attachments or layers has no such tabs", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(
    // The smoke fixture: two plain pages.
    VIEWER_PDF.replace("viewer.pdf", "smoke.pdf"),
  );
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Organize pages" }).click();
  await expect(page.getByRole("tab", { name: "Bookmarks" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Attachments/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Layers" })).toHaveCount(0);
});

test("layers panel shows and hides content on the page", async ({ page }) => {
  await openViewer(page);
  await openSidebarTab(page, /^Layers$/);

  const red = page.getByRole("checkbox", { name: "Red box" });
  const blue = page.getByRole("checkbox", { name: "Blue box" });
  await expect(red).toBeChecked();
  await expect(blue).toBeChecked();

  /** RGB of page 1's canvas at a point given in 800px viewer space. */
  const pixel = (x: number, y: number) =>
    page.evaluate(
      ([px, py]) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          '.page-shell[data-page-index="0"] canvas',
        );
        if (!canvas || !canvas.width) return null;
        const k = canvas.width / 800;
        const d = canvas
          .getContext("2d")!
          .getImageData(Math.round(px * k), Math.round(py * k), 1, 1);
        return [d.data[0], d.data[1], d.data[2]];
      },
      [x, y],
    );
  const RED_AT = [200, 430] as const;
  const BLUE_AT = [400, 430] as const;
  const isReddish = (p: number[] | null) => !!p && p[0] > 150 && p[1] < 100 && p[2] < 100;
  const isBluish = (p: number[] | null) => !!p && p[2] > 150 && p[0] < 100;
  const isWhite = (p: number[] | null) => !!p && p.every((c) => c > 240);

  await expect.poll(async () => isReddish(await pixel(...RED_AT))).toBe(true);
  await expect.poll(async () => isBluish(await pixel(...BLUE_AT))).toBe(true);

  // The canvas repaints in stages, so wait for the finished picture: red gone,
  // blue (the layer we didn't touch) still there.
  await red.uncheck();
  await expect
    .poll(async () => isWhite(await pixel(...RED_AT)) && isBluish(await pixel(...BLUE_AT)))
    .toBe(true);

  await page.getByRole("button", { name: "Reset layers" }).click();
  await expect(red).toBeChecked();
  await expect.poll(async () => isReddish(await pixel(...RED_AT))).toBe(true);
});
