import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { readFile } from "node:fs/promises";

import { loadDesignMap } from "@design-parity/core";
import type { DesignMap, DesignReference } from "@design-parity/core";

import {
  resolve,
  resolveComponent,
  type CodeConnectIndex,
  type DesignCatalogEntry,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = (p: string) => resolvePath(repoRoot, p);

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(fixture(p), "utf8")) as T;
}

/**
 * Build a Code Connect index from any fixture references that carry a
 * `code-connect` link method — that's exactly what the Code Connect CLI would
 * have emitted for them.
 */
async function codeConnectFromFixtures(
  paths: string[],
): Promise<CodeConnectIndex> {
  const index: CodeConnectIndex = {};
  for (const p of paths) {
    const ref = await readJson<DesignReference>(p);
    if (ref.linkMethod === "code-connect" && ref.ref) {
      index[ref.componentId] = ref.ref;
    }
  }
  return index;
}

const figmaButton = "fixtures/figma/button-primary.reference.json";

let designMap: DesignMap;
let codeConnect: CodeConnectIndex;

beforeAll(async () => {
  designMap = await loadDesignMap(fixture("fixtures/design-map.json"));
  codeConnect = await codeConnectFromFixtures([figmaButton]);
});

describe("fixture correspondence", () => {
  it("resolves the Figma button via Code Connect, matching its reference", async () => {
    const reference = await readJson<DesignReference>(figmaButton);
    const { correspondence } = resolveComponent(reference.componentId, {
      codeConnect,
      designMap,
    });

    expect(correspondence).toEqual({
      code: reference.componentId,
      source: "figma",
      ref: reference.ref,
      linkMethod: "code-connect",
      confidence: "high",
    });
  });

  it("resolves the stitch card via the manifest", () => {
    const { correspondence } = resolveComponent("ui/Card.kt#OfferCard", {
      codeConnect,
      designMap,
    });
    expect(correspondence).toMatchObject({
      source: "stitch",
      ref: "stitch:design/abc123",
      linkMethod: "manifest",
      confidence: "high",
    });
  });

  it("resolves the claude-design export via the manifest", () => {
    const { correspondence } = resolveComponent("ui/Card.kt#OfferCardExport", {
      codeConnect,
      designMap,
    });
    expect(correspondence).toMatchObject({
      source: "claude-design",
      ref: "design/reference/offer-card.html",
      linkMethod: "manifest",
      confidence: "high",
    });
  });

  it("resolves every fixture component with the right link method", () => {
    const result = resolve(
      [
        "ui/Button.kt#PrimaryButton",
        "ui/Card.kt#OfferCard",
        "ui/Card.kt#OfferCardExport",
      ],
      { codeConnect, designMap },
    );

    expect(result.unresolved).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.correspondences.map((c) => c.linkMethod)).toEqual([
      "code-connect",
      "manifest",
      "manifest",
    ]);
  });
});

describe("precedence", () => {
  it("prefers Code Connect over a manifest entry for the same component", () => {
    // The fixture manifest also maps the button (to the same Figma ref); Code
    // Connect must still win, yielding the code-connect link method.
    const { correspondence } = resolveComponent("ui/Button.kt#PrimaryButton", {
      codeConnect,
      designMap,
    });
    expect(correspondence?.linkMethod).toBe("code-connect");
  });

  it("falls back to the manifest when Code Connect has no entry", () => {
    const { correspondence } = resolveComponent("ui/Button.kt#PrimaryButton", {
      designMap,
    });
    expect(correspondence).toMatchObject({
      source: "figma",
      linkMethod: "manifest",
    });
  });
});

describe("multi-node manifest refs", () => {
  const multiMap: DesignMap = {
    components: [
      {
        code: "ui/Device.kt#DeviceScreen",
        source: "figma",
        ref: [
          { ref: "figma:KEY/1:10", state: "default" },
          { ref: "figma:KEY/1:20", state: "error" },
          { ref: "figma:KEY/1:30", theme: "dark" },
        ],
      },
    ],
  };

  it("carries the variant list and the primary (first) ref", () => {
    const { correspondence } = resolveComponent("ui/Device.kt#DeviceScreen", {
      designMap: multiMap,
    });
    expect(correspondence).toEqual({
      code: "ui/Device.kt#DeviceScreen",
      source: "figma",
      ref: "figma:KEY/1:10",
      refs: [
        { ref: "figma:KEY/1:10", state: "default" },
        { ref: "figma:KEY/1:20", state: "error" },
        { ref: "figma:KEY/1:30", theme: "dark" },
      ],
      linkMethod: "manifest",
      confidence: "high",
    });
  });

  it("leaves a string ref single, with no refs field", () => {
    const stringMap: DesignMap = {
      components: [{ code: "ui/A.kt#B", source: "figma", ref: "figma:KEY/1:1" }],
    };
    const { correspondence } = resolveComponent("ui/A.kt#B", {
      designMap: stringMap,
    });
    expect(correspondence?.ref).toBe("figma:KEY/1:1");
    expect(correspondence?.refs).toBeUndefined();
  });
});

describe("multi-source manifest (issue #106)", () => {
  const multiSource: DesignMap = {
    components: [
      { code: "ui/Card.kt#OfferCard", source: "stitch", ref: "stitch:design/abc" },
      {
        code: "ui/Card.kt#OfferCard",
        source: "claude-design",
        ref: "design/offer-card.html",
      },
    ],
  };

  it("resolveComponent returns one correspondence per source", () => {
    const { correspondence, correspondences } = resolveComponent(
      "ui/Card.kt#OfferCard",
      { designMap: multiSource },
    );
    // The primary link is the first entry; the full set carries both sources.
    expect(correspondence?.source).toBe("stitch");
    expect(correspondences.map((c) => c.source)).toEqual([
      "stitch",
      "claude-design",
    ]);
    expect(correspondences.every((c) => c.code === "ui/Card.kt#OfferCard")).toBe(
      true,
    );
    expect(correspondences.every((c) => c.linkMethod === "manifest")).toBe(true);
  });

  it("resolve fans one code out to a correspondence per source", () => {
    const result = resolve(["ui/Card.kt#OfferCard"], { designMap: multiSource });
    expect(result.unresolved).toEqual([]);
    expect(result.correspondences).toHaveLength(2);
    expect(result.correspondences.map((c) => c.source)).toEqual([
      "stitch",
      "claude-design",
    ]);
  });

  it("Code Connect still wins over multi-source manifest entries", () => {
    const { correspondences } = resolveComponent("ui/Card.kt#OfferCard", {
      codeConnect: { "ui/Card.kt#OfferCard": "figma:KEY/1:1" },
      designMap: multiSource,
    });
    expect(correspondences).toHaveLength(1);
    expect(correspondences[0]!.linkMethod).toBe("code-connect");
  });
});

describe("convention fallback", () => {
  const catalog: DesignCatalogEntry[] = [
    { source: "figma", ref: "figma:Lib/9:1", name: "PrimaryButton" },
    { source: "stitch", ref: "stitch:design/zzz", name: "OfferCard" },
  ];

  it("matches by normalized name with low confidence", () => {
    const { correspondence, warnings } = resolveComponent(
      "feature/Checkout.kt#primary_button",
      { catalog },
    );
    expect(warnings).toEqual([]);
    expect(correspondence).toMatchObject({
      source: "figma",
      ref: "figma:Lib/9:1",
      linkMethod: "convention",
      confidence: "low",
    });
  });

  it("warns and stays unresolved on an ambiguous match, never crashes", () => {
    const ambiguous: DesignCatalogEntry[] = [
      { source: "figma", ref: "figma:Lib/1:1", name: "Button" },
      { source: "stitch", ref: "stitch:design/button", name: "button" },
    ];
    const { correspondence, warnings } = resolveComponent(
      "ui/Button.kt#Button",
      { catalog: ambiguous },
    );
    expect(correspondence).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/matches 2 catalog entries/);
  });

  it("leaves a component unresolved when nothing matches", () => {
    const result = resolve(["ui/Unknown.kt#Widget"], { catalog });
    expect(result.correspondences).toEqual([]);
    expect(result.unresolved).toEqual(["ui/Unknown.kt#Widget"]);
  });
});
