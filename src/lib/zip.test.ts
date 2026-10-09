import { expect, test } from "vite-plus/test";
import { buildZip, crc32 } from "./zip";

const text = (s: string) => new TextEncoder().encode(s);

test("crc32 matches the standard check value", () => {
  expect(crc32(text("123456789"))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array(0))).toBe(0);
});

test("buildZip writes a readable archive with every entry", () => {
  const zip = buildZip([
    { name: "a.txt", data: text("hello") },
    { name: "dir/é.bin", data: new Uint8Array([1, 2, 3]) },
  ]);
  const view = new DataView(zip.buffer);

  // End-of-central-directory record is the last 22 bytes.
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  expect(view.getUint16(eocd + 10, true)).toBe(2);

  // Walk the central directory.
  let pos = view.getUint32(eocd + 16, true);
  const seen: { name: string; size: number; crc: number; dataAt: number }[] = [];
  for (let i = 0; i < 2; i++) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    const nameLen = view.getUint16(pos + 28, true);
    const localAt = view.getUint32(pos + 42, true);
    seen.push({
      name: new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + nameLen)),
      size: view.getUint32(pos + 24, true),
      crc: view.getUint32(pos + 16, true),
      dataAt: localAt + 30 + view.getUint16(localAt + 26, true),
    });
    pos += 46 + nameLen;
  }
  expect(seen.map((s) => s.name)).toEqual(["a.txt", "dir/é.bin"]);
  expect(new TextDecoder().decode(zip.subarray(seen[0].dataAt, seen[0].dataAt + 5))).toBe("hello");
  expect(Array.from(zip.subarray(seen[1].dataAt, seen[1].dataAt + 3))).toEqual([1, 2, 3]);
  expect(seen[0].crc).toBe(crc32(text("hello")));
});

test("buildZip handles an empty archive", () => {
  expect(buildZip([]).length).toBe(22);
});
