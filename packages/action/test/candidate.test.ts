import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { AdapterContext, DesignMap } from "@design-parity/core";

import { buildCandidateProvider } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const ctx: AdapterContext = { repoRoot, env: {} };

// The candidate package's golden preview-bundle polyglot fixture. Its one
// preview is id `ui.Button.PrimaryButton` with sourceFile `ui/Button.kt` +
// functionName `PrimaryButton`.
const bundleDir = resolve(repoRoot, "packages/candidate/test/fixtures");

// The code handle the convention (`sourceFile#functionName`) derives for it.
const conventionHandle = "ui/Button.kt#PrimaryButton";

describe("buildCandidateProvider", () => {
  it("reconciles bundle preview ids to code handles via the convention (#44)", async () => {
    const { provider, warnings } = await buildCandidateProvider({
      repoRoot,
      bundlePaths: [bundleDir],
    });
    expect(provider).toBeDefined();
    expect(warnings).toEqual([]);

    // Keyed by the convention-derived code handle, so it pairs with a
    // code-handle reference; the raw preview id is preserved on `previewId`.
    const candidate = await provider!(conventionHandle, ctx);
    expect(candidate?.componentId).toBe(conventionHandle);
    expect(candidate?.previewId).toBe("ui.Button.PrimaryButton");
    expect(candidate?.images[0]?.uri.startsWith("data:image/png;base64,")).toBe(
      true,
    );

    // The raw preview id no longer keys the lookup (it's now reconcilable, not
    // the pairing key), and an unknown component still returns undefined.
    expect(await provider!("ui.Button.PrimaryButton", ctx)).toBeUndefined();
    expect(await provider!("ui.Unknown.Thing", ctx)).toBeUndefined();
  });

  it("honors an explicit design-map previewId link (high confidence) (#44)", async () => {
    const designMap: DesignMap = {
      components: [
        {
          code: "ui/Button.kt#Primary",
          source: "bundle",
          ref: "design/button",
          previewId: "ui.Button.PrimaryButton",
        },
      ],
    };
    const { provider } = await buildCandidateProvider({
      repoRoot,
      bundlePaths: ["packages/candidate/test/fixtures/preview-bundle.png"],
      designMap,
    });
    // The explicit link wins over the convention.
    const candidate = await provider!("ui/Button.kt#Primary", ctx);
    expect(candidate?.componentId).toBe("ui/Button.kt#Primary");
    expect(candidate?.previewId).toBe("ui.Button.PrimaryButton");
    expect(candidate?.semantics.root.role).toBe("button");
  });

  it("returns no provider when no candidate input is configured", async () => {
    const { provider, warnings } = await buildCandidateProvider({ repoRoot });
    expect(provider).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});
