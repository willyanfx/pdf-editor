import { describe, it, expect } from "vite-plus/test";
import { regionsToScreenItems } from "./index";
import type { VlmRegion } from "./types";
import type { QuadBox } from "./fontSize";

function rect(x: number, y: number, w: number, h: number): QuadBox {
  return [x, y, x + w, y, x + w, y + h, x, y + h];
}

describe("regionsToScreenItems", () => {
  it("maps image-px quads to screen px with the given scale and offset", () => {
    const regions: VlmRegion[] = [{ text: "Hello", quad: rect(20, 200, 400, 36) }];
    // scale 0.5 (image is 2x screen), offset 0.
    const items = regionsToScreenItems(regions, 0.5, 0, 0);
    expect(items).toHaveLength(1);
    const it = items[0];
    expect(it.str).toBe("Hello");
    expect(it.x).toBeCloseTo(10, 1); // 20 * 0.5
    expect(it.y).toBeCloseTo(100, 1); // 200 * 0.5
    expect(it.width).toBeCloseTo(200, 1); // 400 * 0.5
    expect(it.height).toBeCloseTo(18, 1); // 36 * 0.5
  });

  it("applies a screen-space origin offset (region crop)", () => {
    const regions: VlmRegion[] = [{ text: "x", quad: rect(0, 0, 100, 20) }];
    const items = regionsToScreenItems(regions, 1, 50, 70);
    expect(items[0].x).toBe(50);
    expect(items[0].y).toBe(70);
  });

  it("flags the largest region on a page as bold relative to the body median", () => {
    const regions: VlmRegion[] = [
      { text: "Body line one here", quad: rect(0, 0, 300, 18) },
      { text: "Body line two here", quad: rect(0, 30, 300, 18) },
      { text: "Body line three", quad: rect(0, 60, 300, 18) },
      // A heading at ~2x the body height.
      { text: "BIG HEADING", quad: rect(0, 100, 300, 40) },
    ];
    const items = regionsToScreenItems(regions, 1, 0, 0);
    const heading = items.find((i) => i.str === "BIG HEADING");
    const body = items.find((i) => i.str === "Body line one here");
    expect(heading?.bold).toBe(true);
    expect(body?.bold).toBe(false);
  });

  it("returns an empty array for no regions", () => {
    expect(regionsToScreenItems([], 1, 0, 0)).toEqual([]);
  });
});
