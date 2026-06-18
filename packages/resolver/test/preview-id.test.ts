import { describe, it, expect } from "vitest";

import type { DesignMap } from "@design-parity/core";

import {
  codeHandleForPreview,
  resolvePreviewIds,
  type PreviewIdentity,
} from "../src/index.js";

const designMap: DesignMap = {
  components: [
    {
      code: "ui/Button.kt#PrimaryButton",
      source: "bundle",
      ref: "design/button",
      previewId: "ee.app.ButtonKt.PrimaryButton",
    },
  ],
};

describe("codeHandleForPreview", () => {
  it("uses an explicit design-map previewId link (high confidence)", () => {
    const match = codeHandleForPreview(
      { id: "ee.app.ButtonKt.PrimaryButton", sourceFile: "a/B.kt", functionName: "X" },
      designMap,
    );
    // explicit link wins over the convention the sourceFile/functionName imply
    expect(match).toEqual({
      code: "ui/Button.kt#PrimaryButton",
      linkMethod: "manifest",
      confidence: "high",
    });
  });

  it("falls back to the sourceFile#functionName convention (low confidence)", () => {
    const match = codeHandleForPreview({
      id: "ee.app.FooKt.Bar",
      sourceFile: "ui/Foo.kt",
      functionName: "Bar",
    });
    expect(match).toEqual({
      code: "ui/Foo.kt#Bar",
      linkMethod: "convention",
      confidence: "low",
    });
  });

  it("returns undefined when neither an explicit link nor convention applies", () => {
    expect(codeHandleForPreview({ id: "ee.app.FooKt.Bar" })).toBeUndefined();
    // sourceFile present but no functionName → no valid `path#Member` handle
    expect(
      codeHandleForPreview({ id: "ee.app.FooKt.Bar", sourceFile: "ui/Foo.kt" }),
    ).toBeUndefined();
  });
});

describe("resolvePreviewIds", () => {
  it("maps a batch, mixing explicit and convention matches", () => {
    const previews: PreviewIdentity[] = [
      { id: "ee.app.ButtonKt.PrimaryButton", sourceFile: "x/Y.kt", functionName: "Z" },
      { id: "ee.app.FooKt.Bar", sourceFile: "ui/Foo.kt", functionName: "Bar" },
    ];
    const { matches, unmatched, warnings } = resolvePreviewIds(previews, designMap);

    expect(matches.get("ee.app.ButtonKt.PrimaryButton")).toEqual({
      code: "ui/Button.kt#PrimaryButton",
      linkMethod: "manifest",
      confidence: "high",
    });
    expect(matches.get("ee.app.FooKt.Bar")).toEqual({
      code: "ui/Foo.kt#Bar",
      linkMethod: "convention",
      confidence: "low",
    });
    expect(unmatched).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("surfaces a warning for an unmatched preview id rather than silently dropping it", () => {
    const { matches, unmatched, warnings } = resolvePreviewIds([
      { id: "ee.app.FooKt.Bar" },
    ]);
    expect(matches.size).toBe(0);
    expect(unmatched).toEqual(["ee.app.FooKt.Bar"]);
    expect(warnings.some((w) => w.includes("ee.app.FooKt.Bar"))).toBe(true);
  });

  it("warns on a duplicate explicit previewId mapping and keeps the first", () => {
    const dup: DesignMap = {
      components: [
        { code: "a/B.kt#One", source: "bundle", ref: "r1", previewId: "p.Dup" },
        { code: "a/B.kt#Two", source: "bundle", ref: "r2", previewId: "p.Dup" },
      ],
    };
    const { matches, warnings } = resolvePreviewIds([{ id: "p.Dup" }], dup);
    expect(matches.get("p.Dup")?.code).toBe("a/B.kt#One");
    expect(warnings.some((w) => w.includes("mapped to both"))).toBe(true);
  });

  it("binds a previewId variant list to one code handle, carrying each slot (#111)", () => {
    const themed: DesignMap = {
      components: [
        {
          code: "ui/Device.kt#DeviceBody",
          source: "claude-design",
          ref: "design/Device.html",
          previewId: [
            { previewId: "app.DeviceKt.DeviceBodyPreview", theme: "light" },
            { previewId: "app.DeviceKt.DeviceBodyDarkPreview", theme: "dark" },
          ],
        },
      ],
    };
    const { matches, unmatched, warnings } = resolvePreviewIds(
      [
        { id: "app.DeviceKt.DeviceBodyPreview" },
        { id: "app.DeviceKt.DeviceBodyDarkPreview" },
      ],
      themed,
    );
    // Both previews resolve to the one code handle, each tagged with its theme.
    expect(matches.get("app.DeviceKt.DeviceBodyPreview")).toEqual({
      code: "ui/Device.kt#DeviceBody",
      linkMethod: "manifest",
      confidence: "high",
      variant: { theme: "light" },
    });
    expect(matches.get("app.DeviceKt.DeviceBodyDarkPreview")).toEqual({
      code: "ui/Device.kt#DeviceBody",
      linkMethod: "manifest",
      confidence: "high",
      variant: { theme: "dark" },
    });
    expect(unmatched).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("omits the variant slot when a variant carries no tags (#111)", () => {
    const untagged: DesignMap = {
      components: [
        {
          code: "ui/Foo.kt#Bar",
          source: "bundle",
          ref: "r",
          previewId: [{ previewId: "app.FooKt.Bar" }],
        },
      ],
    };
    const { matches } = resolvePreviewIds([{ id: "app.FooKt.Bar" }], untagged);
    expect(matches.get("app.FooKt.Bar")).toEqual({
      code: "ui/Foo.kt#Bar",
      linkMethod: "manifest",
      confidence: "high",
    });
  });
});
