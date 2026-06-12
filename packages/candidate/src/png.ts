/**
 * Minimal PNG header reader. The pixel dimensions of a render come straight
 * from the IHDR chunk — no decode, no dependency. The upstream CLI exposes the
 * same trick (`observe="hash"` reads width/height from IHDR); we read it from
 * the file the CLI wrote so the {@link Image} dims are authoritative.
 */

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export interface PngSize {
  width: number;
  height: number;
}

/**
 * Read the pixel `width`/`height` from a PNG's IHDR chunk.
 *
 * @throws Error if the bytes are not a PNG (bad signature or missing IHDR).
 */
export function readPngSize(bytes: Uint8Array): PngSize {
  // 8-byte signature + IHDR: length(4) + "IHDR"(4) + width(4) + height(4) = 24.
  if (bytes.byteLength < 24) {
    throw new Error("not a PNG: file shorter than a PNG header");
  }
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG: bad signature");
  }
  if (buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a PNG: first chunk is not IHDR");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
