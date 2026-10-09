import { crc32 } from "./zip";

/** Raw RGBA pixels (8 bits per channel, row-major, top row first). */
export type RgbaImage = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray | Uint8Array;
  /** False when every pixel is opaque, so the PNG can drop its alpha channel. */
  hasAlpha: boolean;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The CRC covers the type and the data, not the length.
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib-wrap `data` with the platform's deflate (browsers and Node >= 18). */
async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encode RGBA pixels as a PNG without touching a canvas, so embedded-image
 * extraction works off the main thread and under test. Uses colour type 2
 * (RGB) when the image is fully opaque and 6 (RGBA) otherwise.
 */
export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  const { width, height, rgba, hasAlpha } = image;
  const channels = hasAlpha ? 4 : 3;
  const stride = width * channels;

  // Each scanline is prefixed with a filter byte; 0 = "none".
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    let dst = row + 1;
    let src = y * width * 4;
    if (hasAlpha) {
      raw.set(rgba.subarray(src, src + width * 4), dst);
    } else {
      for (let x = 0; x < width; x++, src += 4) {
        raw[dst++] = rgba[src];
        raw[dst++] = rgba[src + 1];
        raw[dst++] = rgba[src + 2];
      }
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = hasAlpha ? 6 : 2; // colour type

  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlibDeflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
