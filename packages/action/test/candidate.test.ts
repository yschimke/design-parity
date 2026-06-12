import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { AdapterContext } from "@design-parity/core";

import { buildCandidateProvider } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const ctx: AdapterContext = { repoRoot, env: {} };

// The candidate package's golden preview-bundle polyglot fixture.
const bundleDir = resolve(repoRoot, "packages/candidate/test/fixtures");

describe("buildCandidateProvider", () => {
  it("builds a provider from a preview-bundle directory", async () => {
    const provider = await buildCandidateProvider({
      repoRoot,
      bundlePaths: [bundleDir],
    });
    expect(provider).toBeDefined();
    const candidate = await provider!("ui.Button.PrimaryButton", ctx);
    expect(candidate?.componentId).toBe("ui.Button.PrimaryButton");
    expect(candidate?.images[0]?.uri.startsWith("data:image/png;base64,")).toBe(
      true,
    );
    // returns undefined for an unknown component (lets the run skip it)
    expect(await provider!("ui.Unknown.Thing", ctx)).toBeUndefined();
  });

  it("accepts an explicit bundle polyglot path", async () => {
    const provider = await buildCandidateProvider({
      repoRoot,
      bundlePaths: ["packages/candidate/test/fixtures/preview-bundle.png"],
    });
    const candidate = await provider!("ui.Button.PrimaryButton", ctx);
    expect(candidate?.semantics.root.role).toBe("button");
  });

  it("returns undefined when no candidate input is configured", async () => {
    const provider = await buildCandidateProvider({ repoRoot });
    expect(provider).toBeUndefined();
  });
});
