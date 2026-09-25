// ── A photo, the right way up ────────────────────────────────────────────────
//
// Phones store most photos sideways and write the rotation into EXIF
// (orientation 1–8). Corners are picked on — and training assumed — the photo
// as a person sees it, so the rotation must be applied exactly ONCE. Browsers
// disagree about whether decoding applies it (it depends on the API and the
// version), so this module does not guess: it reads the orientation itself,
// and asks the browser once, with a tiny probe image, whether it already
// applied it. If the browser did, nothing more is done; if not, the pixels are
// turned here.
//
// Also: very large photos are scaled so that the longer side is at most
// MAX_SIDE (a phone photo is ~4000 px, well under it); the scale is kept so
// that corners can be reported in the original photo's pixels.

import type { PixelImage } from "./crops";

export const MAX_SIDE = 4096;

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

export type Photo = PixelImage & {
  channels: 4;
  data: Uint8ClampedArray<ArrayBuffer>;
  name: string;
  /** EXIF orientation found in the file (1 = none). */
  orientation: number;
  /** Who turned it: the browser while decoding, this module, or nobody. */
  orientedBy: "browser" | "app" | "none";
  /** Decoded pixels per pixel of the upright original (≤ 1). */
  scale: number;
};

/**
 * The EXIF orientation of a JPEG (1–8), or 1 when there is none. Reads only
 * the APP1 segment; anything malformed is treated as "no orientation".
 */
export function readExifOrientation(buffer: ArrayBuffer): number {
  const v = new DataView(buffer);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= v.byteLength) {
    const marker = v.getUint16(offset);
    const length = v.getUint16(offset + 2);
    if ((marker & 0xff00) !== 0xff00 || length < 2) return 1;
    if (marker === 0xffda) return 1; // start of scan: no EXIF before the image data
    if (
      marker === 0xffe1 &&
      offset + 10 <= v.byteLength &&
      v.getUint32(offset + 4) === 0x45786966
    ) {
      const tiff = offset + 10; // after "Exif\0\0"
      if (tiff + 8 > v.byteLength) return 1;
      const little = v.getUint16(tiff) === 0x4949;
      const u16 = (p: number) => v.getUint16(p, little);
      const u32 = (p: number) => v.getUint32(p, little);
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > v.byteLength) return 1;
      const entries = u16(ifd);
      for (let i = 0; i < entries; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > v.byteLength) return 1;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}

/**
 * Apply an EXIF orientation to RGBA pixels: the image as a person should see
 * it. Orientations 5–8 swap width and height.
 */
export function orientPixels(
  src: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  orientation: number,
): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  if (orientation === 1) return { data: src, width, height };
  const swap = orientation >= 5;
  const w = swap ? height : width;
  const h = swap ? width : height;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // where the displayed pixel (x, y) comes from in the stored image
      let sx: number;
      let sy: number;
      switch (orientation) {
        case 2:
          sx = width - 1 - x;
          sy = y;
          break;
        case 3:
          sx = width - 1 - x;
          sy = height - 1 - y;
          break;
        case 4:
          sx = x;
          sy = height - 1 - y;
          break;
        case 5:
          sx = y;
          sy = x;
          break;
        case 6:
          sx = y;
          sy = height - 1 - x;
          break;
        case 7:
          sx = width - 1 - y;
          sy = height - 1 - x;
          break;
        default:
          sx = width - 1 - y;
          sy = x;
          break; // 8
      }
      const s = (sy * width + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = src[s]!;
      out[d + 1] = src[s + 1]!;
      out[d + 2] = src[s + 2]!;
      out[d + 3] = src[s + 3]!;
    }
  }
  return { data: out, width: w, height: h };
}

/** 16×8 JPEG, left half red, right half blue, EXIF orientation 6. Decoded with
 *  the rotation applied it is 8×16. */
const PROBE_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50rwKiiv3D6Mv/M4/7gf+5j+jfpDf8yr/ALjf+4j/2Q==";

let probe: Promise<boolean> | null = null;

/** Whether this browser's createImageBitmap applies EXIF orientation. Asked once. */
export function browserAppliesOrientation(): Promise<boolean> {
  probe ??= (async () => {
    const bytes = Uint8Array.from(atob(PROBE_JPEG), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const applied = bitmap.width === 8 && bitmap.height === 16;
    bitmap.close();
    return applied;
  })();
  return probe;
}

/** Decode a chosen file into upright RGBA pixels. */
export async function decodePhoto(file: File): Promise<Photo> {
  const buffer = await file.arrayBuffer();
  const orientation = readExifOrientation(buffer);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: file.type || "image/jpeg" }));
  } catch {
    throw new PhotoError(
      "This browser cannot open this file. HEIC photos may need to be saved as JPEG first.",
    );
  }
  const byBrowser = orientation !== 1 && (await browserAppliesOrientation());
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoError("Could not read the photo's pixels.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const raw = ctx.getImageData(0, 0, w, h).data;
  const turned =
    orientation !== 1 && !byBrowser
      ? orientPixels(raw, w, h, orientation)
      : { data: raw, width: w, height: h };
  return {
    ...turned,
    channels: 4,
    name: file.name,
    orientation,
    orientedBy: orientation === 1 ? "none" : byBrowser ? "browser" : "app",
    scale,
  };
}
