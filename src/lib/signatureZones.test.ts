import { test, expect } from "vite-plus/test";
import {
  classifyLabel,
  findSignatureZones,
  resolveImagePlacement,
  type SignatureZone,
  type ZoneItem,
} from "./signatureZones";

/** Build a minimal text item at a position; only the fields the detector reads. */
function item(str: string, x = 0, y = 0, width = 80, height = 14): ZoneItem {
  return { str, x, y, width, height };
}

test("classifyLabel recognizes signature labels regardless of case/punctuation", () => {
  expect(classifyLabel("Signature:")).toBe("signature");
  expect(classifyLabel("Sign here")).toBe("signature");
  expect(classifyLabel("SIGN HERE ▼")).toBe("signature");
  expect(classifyLabel("Signed by")).toBe("signature");
});

test("classifyLabel recognizes initials and date labels", () => {
  expect(classifyLabel("Initials")).toBe("initials");
  expect(classifyLabel("Initial here")).toBe("initials");
  expect(classifyLabel("Date:")).toBe("date");
  expect(classifyLabel("Date signed")).toBe("date");
});

test("classifyLabel returns null for non-label text", () => {
  expect(classifyLabel("The quick brown fox")).toBeNull();
  expect(classifyLabel("designation")).toBeNull(); // contains "sign" but not as a word
  expect(classifyLabel("")).toBeNull();
  expect(classifyLabel("4")).toBeNull();
});

test("findSignatureZones produces one zone per matched label", () => {
  const zones = findSignatureZones([
    item("Customer name"),
    item("Signature:", 100, 200, 80, 14),
    item("Initials", 100, 240, 60, 14),
  ]);
  expect(zones).toHaveLength(2);
  expect(zones.map((z) => z.kind).sort()).toEqual(["initials", "signature"]);
});

test("a signature zone is placed to the right of its label, vertically aligned", () => {
  const [zone] = findSignatureZones([item("Signature:", 100, 200, 90, 14)]);
  // To the right of the label (label ends at x=190).
  expect(zone.x).toBeGreaterThanOrEqual(190);
  // Roughly aligned with the label's vertical band.
  expect(zone.y).toBeLessThanOrEqual(200 + 14);
  expect(zone.y + zone.height).toBeGreaterThanOrEqual(200);
  expect(zone.width).toBeGreaterThan(0);
  expect(zone.height).toBeGreaterThan(0);
});

test("an initials zone is narrower than a signature zone", () => {
  const [sig] = findSignatureZones([item("Signature:", 0, 0)]);
  const [ini] = findSignatureZones([item("Initials", 0, 0)]);
  expect(ini.width).toBeLessThan(sig.width);
});

test("zones carry a stable unique id", () => {
  const zones = findSignatureZones([
    item("Signature:", 0, 0),
    item("Signature:", 0, 50),
  ]);
  expect(zones[0].id).not.toBe(zones[1].id);
  expect(zones[0].id).toBeTruthy();
});

test("empty input yields no zones", () => {
  expect(findSignatureZones([])).toEqual([]);
});

const ZONE: SignatureZone = {
  id: "z",
  kind: "signature",
  x: 300,
  y: 120,
  width: 220,
  height: 48,
};

test("resolveImagePlacement falls back to the default box when no target", () => {
  const p = resolveImagePlacement(null, { width: 220, height: 120 });
  expect(p).toEqual({ x: 100, y: 100, width: 220, height: 120 });
});

test("resolveImagePlacement uses the zone position and fits the signature inside it", () => {
  const p = resolveImagePlacement(ZONE, { width: 220, height: 120 });
  // Anchored at the zone's top-left.
  expect(p.x).toBe(300);
  expect(p.y).toBe(120);
  // Scaled to fit within the zone, preserving the source aspect ratio.
  expect(p.width).toBeLessThanOrEqual(220);
  expect(p.height).toBeLessThanOrEqual(48);
});

test("resolveImagePlacement preserves aspect ratio when fitting", () => {
  // Source 220x120 (ratio ~1.833); zone 220x48 (ratio ~4.58) → height-bound.
  const p = resolveImagePlacement(ZONE, { width: 220, height: 120 });
  const srcRatio = 220 / 120;
  expect(p.width / p.height).toBeCloseTo(srcRatio, 1);
});
