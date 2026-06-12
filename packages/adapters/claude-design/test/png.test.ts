import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { readPngSize, parsePngSize } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));

describe("readPngSize", () => {
  it("reads dimensions from the committed offer-card PNG", async () => {
    const size = await readPngSize(
      resolve(repoRoot, "fixtures/claude-design/offer-card.light.png"),
    );
    expect(size).toEqual({ width: 240, height: 160 });
  });

  it("throws a readable error for a missing file", async () => {
    await expect(readPngSize(resolve(repoRoot, "nope.png"))).rejects.toThrow(
      /cannot read reference image/,
    );
  });
});

describe("parsePngSize", () => {
  it("rejects a buffer that is not a PNG", () => {
    expect(() => parsePngSize(Buffer.from("not a png at all!!!!"))).toThrow(
      /not a PNG/,
    );
  });
});
