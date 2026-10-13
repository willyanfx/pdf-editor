/**
 * A minimal sRGB ICC profile (v2, matrix/TRC), generated rather than bundled.
 * PDF/A needs an output intent with an embedded profile for device-RGB content;
 * this is a standard sRGB description: D50-adapted sRGB primaries and the sRGB
 * transfer curve sampled at 256 points.
 */

const TAGS = ["desc", "cprt", "wtpt", "rXYZ", "gXYZ", "bXYZ", "rTRC", "gTRC", "bTRC"] as const;
type Tag = (typeof TAGS)[number];

const sig = (s: string) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));

/** s15Fixed16Number. */
function s15(v: number): number[] {
  const n = Math.round(v * 65536) >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

const xyz = (x: number, y: number, z: number) => [
  ...sig("XYZ "),
  ...u32(0),
  ...s15(x),
  ...s15(y),
  ...s15(z),
];

function srgbCurve(): number[] {
  const points = 256;
  const out = [...sig("curv"), ...u32(0), ...u32(points)];
  for (let i = 0; i < points; i++) {
    const c = i / (points - 1);
    const lin = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    out.push(...u16(Math.round(lin * 65535)));
  }
  return out;
}

function description(text: string): number[] {
  const ascii = [...sig(text), 0];
  return [
    ...sig("desc"),
    ...u32(0),
    ...u32(ascii.length),
    ...ascii,
    ...u32(0), // Unicode language code
    ...u32(0), // Unicode count
    ...u16(0), // ScriptCode code
    0, // ScriptCode count
    ...Array.from({ length: 67 }, () => 0),
  ];
}

export const SRGB_PROFILE_NAME = "sRGB IEC61966-2.1";

/** The profile's bytes. */
export function buildSrgbProfile(): Uint8Array {
  const curve = srgbCurve();
  const data: Record<Tag, number[]> = {
    desc: description(SRGB_PROFILE_NAME),
    cprt: [...sig("text"), ...u32(0), ...sig("No copyright, use freely"), 0],
    wtpt: xyz(0.9642, 1.0, 0.8249),
    rXYZ: xyz(0.4360747, 0.2225045, 0.0139322),
    gXYZ: xyz(0.3850649, 0.7168786, 0.0971045),
    bXYZ: xyz(0.1430804, 0.0606169, 0.7141733),
    rTRC: curve,
    gTRC: curve,
    bTRC: curve,
  };

  const tableSize = 4 + TAGS.length * 12;
  let offset = 128 + tableSize;
  const body: number[] = [];
  const table: number[] = [...u32(TAGS.length)];
  // The three curves are identical: store one copy and point all three tags at it.
  let curveOffset = -1;
  for (const tag of TAGS) {
    const bytes = data[tag];
    if (tag.endsWith("TRC") && curveOffset >= 0) {
      table.push(...sig(tag), ...u32(curveOffset), ...u32(bytes.length));
      continue;
    }
    if (tag.endsWith("TRC")) curveOffset = offset;
    table.push(...sig(tag), ...u32(offset), ...u32(bytes.length));
    body.push(...bytes);
    const pad = (4 - (bytes.length % 4)) % 4;
    for (let i = 0; i < pad; i++) body.push(0);
    offset += bytes.length + pad;
  }

  const header = Array.from({ length: 128 }, () => 0);
  const put = (at: number, bytes: number[]) => bytes.forEach((b, i) => (header[at + i] = b));
  put(0, u32(128 + table.length + body.length));
  put(8, [2, 0x10, 0, 0]); // version 2.1.0
  put(12, sig("mntr"));
  put(16, sig("RGB "));
  put(20, sig("XYZ "));
  put(24, [...u16(2026), ...u16(1), ...u16(1), ...u16(0), ...u16(0), ...u16(0)]);
  put(36, sig("acsp"));
  put(68, [...s15(0.9642), ...s15(1.0), ...s15(0.8249)]); // D50 illuminant
  return Uint8Array.from([...header, ...table, ...body]);
}
