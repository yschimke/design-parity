/**
 * Minimal, dependency-free PNG dimension reader.
 *
 * The adapter derives an image's `width`/`height` from the committed PNG on
 * disk rather than trusting the handoff manifest, so reference dimensions can
 * never drift from the bytes the diff engine actually rasterizes against.
 */
import { readFile } from "node:fs/promises";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngSize {
  width: number;
  height: number;
}

/**
 * Read a PNG's pixel dimensions from its IHDR chunk.
 *
 * @throws if the file is missing or not a PNG (signature / IHDR mismatch).
 */
export async function readPngSize(path: string): Promise<PngSize> {
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (cause) {
    throw new Error(`claude-design: cannot read reference image '${path}'`, {
      cause,
    });
  }
  return parsePngSize(buf, path);
}

/** Parse PNG dimensions from an in-memory buffer (the IHDR is always first). */
export function parsePngSize(buf: Buffer, label = "<buffer>"): PngSize {
  // 8-byte signature, then a length(4)+type(4) chunk header; IHDR carries
  // width(4)+height(4) as its first 8 data bytes — 24 bytes total.
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`claude-design: '${label}' is not a PNG image`);
  }
  if (buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`claude-design: '${label}' is not a valid PNG (no IHDR)`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) {
    throw new Error(`claude-design: '${label}' has zero dimensions`);
  }
  return { width, height };
}
