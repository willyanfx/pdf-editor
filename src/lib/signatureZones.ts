/**
 * Signature-zone auto-detection (Phase 3, item 11).
 *
 * Scans the positioned text of a page for label words like "Signature",
 * "Initials", and "Date", and proposes a clickable target zone next to each —
 * so opening a contract surfaces the spots that want a signature instead of
 * dropping at a fixed default. Pure and self-contained for unit testing; the
 * caller feeds it `ScreenTextItem[]` from `extractScreenTextItems`.
 */

/** The subset of a positioned text item the detector reads. `ScreenTextItem`
 * (from textLayer.ts) is assignable to this. */
export type ZoneItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ZoneKind = "signature" | "initials" | "date";

export type SignatureZone = {
  id: string;
  kind: ZoneKind;
  /** Top-left + size of the suggested drop target, in the same screen px as the
   * source items. */
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Label patterns, most specific first. Anchored to word boundaries so
 * "designation" / "candidate" don't match "sign" / "date". */
const LABEL_PATTERNS: { kind: ZoneKind; re: RegExp }[] = [
  { kind: "initials", re: /\binitials?\b/i },
  { kind: "date", re: /\bdate\b/i },
  // "sign", "signature", "signed", "sign here". \w* lets "signature"/"signed"
  // match while \bsign keeps it word-anchored.
  { kind: "signature", re: /\bsign(?:ature|ed)?\b/i },
];

/**
 * Classify a label string into the kind of zone it implies, or null if it isn't
 * a recognized label. Order matters: "Date signed" is a date field, so date is
 * checked before signature.
 */
export function classifyLabel(str: string): ZoneKind | null {
  const text = str.trim();
  if (!text) return null;
  for (const { kind, re } of LABEL_PATTERNS) {
    if (re.test(text)) return kind;
  }
  return null;
}

/** Default zone sizes (screen px), scaled off the label height when available. */
const SIZE = {
  signature: { w: 220, h: 48 },
  initials: { w: 80, h: 40 },
  date: { w: 140, h: 36 },
} as const;

/** Horizontal gap between a label's right edge and the zone, in px. */
const GAP = 12;

/** Default image-edit drop point/size when no signature zone is targeted. */
const DEFAULT_PLACEMENT_ORIGIN = { x: 100, y: 100 } as const;

export type ImagePlacement = { x: number; y: number; width: number; height: number };

/**
 * Resolve where to drop a signature image. With no target zone, fall back to the
 * default corner placement at the source size. With a zone, anchor at its
 * top-left and scale the source down to fit inside the zone, preserving aspect
 * ratio (we never upscale — a small zone keeps a crisp signature).
 */
export function resolveImagePlacement(
  zone: SignatureZone | null,
  source: { width: number; height: number },
): ImagePlacement {
  if (!zone) {
    return { ...DEFAULT_PLACEMENT_ORIGIN, width: source.width, height: source.height };
  }
  const scale = Math.min(zone.width / source.width, zone.height / source.height, 1);
  return {
    x: zone.x,
    y: zone.y,
    width: source.width * scale,
    height: source.height * scale,
  };
}

/**
 * Find candidate signature/initials/date drop zones from a page's text items.
 * Each matched label yields one zone placed just to its right and vertically
 * centred on the label's band.
 */
export function findSignatureZones(items: ZoneItem[]): SignatureZone[] {
  const zones: SignatureZone[] = [];
  let n = 0;
  for (const it of items) {
    const kind = classifyLabel(it.str);
    if (!kind) continue;
    const { w, h } = SIZE[kind];
    // Vertically centre the zone on the label's mid-line.
    const midY = it.y + it.height / 2;
    zones.push({
      id: `sigzone-${n++}-${kind}`,
      kind,
      x: it.x + it.width + GAP,
      y: midY - h / 2,
      width: w,
      height: h,
    });
  }
  return zones;
}
