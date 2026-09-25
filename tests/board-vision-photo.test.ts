// A photo must be turned upright exactly once. The parser reads the EXIF
// orientation; the pixel transform is checked against PIL's exif_transpose —
// what the real-photo benchmark (amath-vision-training realeval.py) uses — so
// the browser and the benchmark agree on what "upright" means.
import { describe, expect, it } from "vitest";

import { orientPixels, readExifOrientation } from "../src/features/boardVision/photo";

/** Reference, computed by PIL (ImageOps.exif_transpose's transpose table) on a
 *  3×2 image whose pixel (x, y) has red = 10·y + x. */
const PIL: Record<string, { width: number; height: number; red: number[] }> = {
  "1": { width: 3, height: 2, red: [0, 1, 2, 10, 11, 12] },
  "2": { width: 3, height: 2, red: [2, 1, 0, 12, 11, 10] },
  "3": { width: 3, height: 2, red: [12, 11, 10, 2, 1, 0] },
  "4": { width: 3, height: 2, red: [10, 11, 12, 0, 1, 2] },
  "5": { width: 2, height: 3, red: [0, 10, 1, 11, 2, 12] },
  "6": { width: 2, height: 3, red: [10, 0, 11, 1, 12, 2] },
  "7": { width: 2, height: 3, red: [12, 2, 11, 1, 10, 0] },
  "8": { width: 2, height: 3, red: [2, 12, 1, 11, 0, 10] },
};

/** A minimal JPEG: SOI, APP1 with an EXIF orientation tag, then EOI. */
function jpegWithOrientation(
  orientation: number,
  little: boolean,
  extraBefore = false,
): ArrayBuffer {
  const tiff: number[] = [];
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) =>
    little
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24]
      : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  const entries = extraBefore ? 2 : 1;
  tiff.push(...u16(entries));
  if (extraBefore) tiff.push(...u16(0x010f), ...u16(2), ...u32(4), ...u32(0)); // Make, ignored
  tiff.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0);
  tiff.push(...u32(0));
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const bytes = [
    0xff,
    0xd8,
    0xff,
    0xe1,
    (app1.length + 2) >> 8,
    (app1.length + 2) & 0xff,
    ...app1,
    0xff,
    0xd9,
  ];
  return new Uint8Array(bytes).buffer;
}

describe("reading the EXIF orientation", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("reads orientation %s, in both byte orders", (o) => {
    expect(readExifOrientation(jpegWithOrientation(o, true))).toBe(o);
    expect(readExifOrientation(jpegWithOrientation(o, false))).toBe(o);
    expect(readExifOrientation(jpegWithOrientation(o, false, true))).toBe(o);
  });

  it("treats missing, foreign and malformed data as upright", () => {
    expect(readExifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBe(1); // PNG
    expect(readExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer)).toBe(1); // no APP1
    expect(readExifOrientation(jpegWithOrientation(9, true))).toBe(1); // out of range
    expect(readExifOrientation(jpegWithOrientation(6, true).slice(0, 20))).toBe(1); // truncated
    expect(readExifOrientation(new ArrayBuffer(0))).toBe(1);
  });
});

describe("turning the pixels upright", () => {
  const w = 3;
  const h = 2;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) src.set([10 * y + x, 0, 0, 255], (y * w + x) * 4);

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("orientation %s matches PIL", (o) => {
    const out = orientPixels(src, w, h, o);
    const ref = PIL[String(o)]!;
    expect([out.width, out.height]).toEqual([ref.width, ref.height]);
    expect(Array.from({ length: out.width * out.height }, (_, i) => out.data[i * 4])).toEqual(
      ref.red,
    );
  });
});
