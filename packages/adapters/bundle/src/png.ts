/**
 * Minimal, dependency-free PNG dimension reader.
 *
 * The adapter derives an image's `width`/`height` from the committed PNG bytes
 * rather than trusting the manifest, so reference dimensions can never drift
 * from the pixels the diff engine actually rasterizes against. The bytes may
 * come from disk (a directory bundle) or from an in-memory unzip (a `.zip`
 * bundle), so the parser works on a buffer the adapter already holds.
 */

const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export interface PngSize {
  width: number;
  height: number;
}

function startsWithSignature(buf: Uint8Array): boolean {
  if (buf.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (buf[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * Parse a PNG's pixel dimensions from its IHDR chunk.
 *
 * @param buf the raw PNG bytes (signature must be first).
 * @param label a human path/name for error messages.
 * @throws if the bytes are not a PNG (signature / IHDR mismatch) or report
 *   zero dimensions.
 */
export function parsePngSize(buf: Uint8Array, label = "<buffer>"): PngSize {
  // 8-byte signature, then a length(4)+type(4) chunk header; IHDR carries
  // width(4)+height(4) as its first 8 data bytes — 24 bytes total.
  if (buf.length < 24 || !startsWithSignature(buf)) {
    throw new Error(`bundle: '${label}' is not a PNG image`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ihdr = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!);
  if (ihdr !== "IHDR") {
    throw new Error(`bundle: '${label}' is not a valid PNG (no IHDR)`);
  }
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width === 0 || height === 0) {
    throw new Error(`bundle: '${label}' has zero dimensions`);
  }
  return { width, height };
}
