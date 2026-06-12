/** Read width/height from a PNG's IHDR chunk without pulling in an image lib. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) {
    throw new Error("stitch: rasterized image is not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // IHDR is the first chunk: 8-byte sig, 4-byte length, 4-byte type, then
  // width (4) and height (4) big-endian at offsets 16 and 20.
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
