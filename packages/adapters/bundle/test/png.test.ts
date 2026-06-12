import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePngSize } from "../src/png.js";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));

describe("parsePngSize", () => {
  it("reads dimensions from a real PNG's IHDR", async () => {
    const bytes = await readFile(
      resolve(repoRoot, "fixtures/bundle/offer-card/offer-card.light.png"),
    );
    expect(parsePngSize(bytes, "offer-card.light.png")).toEqual({
      width: 240,
      height: 160,
    });
  });

  it("rejects bytes that are not a PNG", () => {
    expect(() => parsePngSize(new TextEncoder().encode("nope"), "x")).toThrow(
      /is not a PNG image/,
    );
  });

  it("rejects a PNG-signed buffer with no IHDR", () => {
    const buf = new Uint8Array(24);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    expect(() => parsePngSize(buf, "x")).toThrow(/no IHDR/);
  });
});
