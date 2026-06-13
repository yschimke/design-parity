import { describe, it, expect } from "vitest";

import type { AdapterContext } from "@design-parity/core";

import {
  atfFindings,
  touchTargetFindings,
  textStringFindings,
  translationFindings,
  nativeFindings,
  hierarchyToSemanticTree,
  parseScreenBounds,
  daemonSource,
  type DaemonDataClient,
} from "../src/index.js";

const ctx: AdapterContext = { repoRoot: "/repo", env: {} };

describe("native data-product mappers", () => {
  it("parseScreenBounds parses 'l,t,r,b' px into Bounds", () => {
    expect(parseScreenBounds("120,440,184,504")).toEqual({
      x: 120,
      y: 440,
      width: 64,
      height: 64,
    });
    expect(parseScreenBounds(undefined)).toBeUndefined();
    expect(parseScreenBounds("bad")).toBeUndefined();
  });

  it("atfFindings splits contrast checks from other a11y, mapping ATF level → severity", () => {
    const findings = atfFindings({
      findings: [
        {
          level: "ERROR",
          type: "TextContrastCheck",
          message: "Contrast 2.1:1 is too low.",
          viewDescription: "Label",
          boundsInScreen: "0,0,10,10",
        },
        {
          level: "WARNING",
          type: "TouchTargetSizeCheck",
          message: "Below 48dp.",
        },
        { level: "INFO", type: "SpeakableTextPresentCheck", message: "ok" },
      ],
    });
    expect(findings.map((f) => [f.kind, f.severity])).toEqual([
      ["contrast", "error"],
      ["a11y", "warn"],
      ["a11y", "info"],
    ]);
    expect(findings[0]?.message).toContain("(Label)");
    expect(findings[0]?.detail?.["bounds"]).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it("touchTargetFindings flags belowMinimum as error, other findings as warn", () => {
    const findings = touchTargetFindings({
      targets: [
        { nodeId: "n0", widthDp: 32, heightDp: 32, findings: ["belowMinimum"], boundsInScreen: "0,0,32,32" },
        { nodeId: "n1", widthDp: 48, heightDp: 48, findings: ["overlap"] },
        { nodeId: "n2", widthDp: 48, heightDp: 48 }, // no findings → ignored
      ],
    });
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ kind: "a11y", severity: "error" });
    expect(findings[1]).toMatchObject({ kind: "a11y", severity: "warn" });
  });

  it("textStringFindings flags truncated/overflowing entries as i18n", () => {
    const findings = textStringFindings({
      entries: [
        { text: "Continue", didOverflowWidth: true, maxLines: 1, lineCount: 1 },
        { text: "OK", truncated: false, overflow: false }, // fine → ignored
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "i18n", severity: "warn" });
    expect(findings[0]?.message).toContain("Continue");
  });

  it("translationFindings flags strings missing locale coverage", () => {
    const findings = translationFindings({
      strings: [
        { resourceName: "greeting", locales: ["en"], missingLocales: ["fr", "de"] },
        { resourceName: "complete", locales: ["en", "fr", "de"], missingLocales: [] },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "i18n", severity: "warn" });
    expect(findings[0]?.detail?.["missingLocales"]).toEqual(["fr", "de"]);
  });

  it("nativeFindings orders a11y/contrast before i18n", () => {
    const findings = nativeFindings({
      atf: { findings: [{ level: "ERROR", type: "TextContrastCheck", message: "low" }] },
      textStrings: { entries: [{ text: "X", overflow: true }] },
    });
    expect(findings.map((f) => f.kind)).toEqual(["contrast", "i18n"]);
  });

  it("hierarchyToSemanticTree builds a tree from the flat node list", () => {
    const tree = hierarchyToSemanticTree(
      {
        nodes: [
          { role: "button", label: "Continue", boundsInScreen: "0,0,100,48", states: [], merged: true },
          { role: "text", label: "Hi", boundsInScreen: "0,60,40,80", states: [] },
        ],
      },
      "dark",
    );
    expect(tree.theme).toBe("dark");
    expect(tree.root.children).toHaveLength(2);
    expect(tree.root.children?.[0]).toEqual({
      role: "button",
      label: "Continue",
      bounds: { x: 0, y: 0, width: 100, height: 48 },
    });
  });

  it("hierarchyToSemanticTree degrades to an empty root with no nodes", () => {
    expect(hierarchyToSemanticTree(undefined)).toEqual({ root: {} });
  });
});

describe("daemonSource", () => {
  // A fake transport returning canned image + data products per (previewId, kind).
  function fakeClient(): DaemonDataClient {
    return {
      async image(previewId) {
        return previewId === "ee.app.HomeKt.Home"
          ? { uri: "data:image/png;base64,AAAA", width: 320, height: 240 }
          : undefined;
      },
      async fetch(previewId, kind) {
        if (previewId !== "ee.app.HomeKt.Home") return undefined;
        switch (kind) {
          case "a11y/atf":
            return { findings: [{ level: "ERROR", type: "TextContrastCheck", message: "low", viewDescription: "Title" }] };
          case "a11y/hierarchy":
            return { nodes: [{ role: "button", label: "Go", boundsInScreen: "0,0,48,48", states: [] }] };
          case "text/strings":
            return { entries: [{ text: "Long label", didOverflowWidth: true }] };
          default:
            return undefined;
        }
      },
    };
  }

  it("produces a CandidateRender (image + hierarchy semantics) keyed by code handle, plus native findings", async () => {
    const source = daemonSource({
      client: fakeClient(),
      previewIdFor: (code) => (code === "ui/Home.kt#Home" ? "ee.app.HomeKt.Home" : undefined),
      themeFor: () => "light",
    });

    const candidate = await source.getCandidate("ui/Home.kt#Home", ctx);
    expect(candidate?.componentId).toBe("ui/Home.kt#Home");
    expect(candidate?.previewId).toBe("ee.app.HomeKt.Home");
    expect(candidate?.images[0]).toMatchObject({ state: "default", theme: "light", width: 320 });
    expect(candidate?.semantics.root.children?.[0]?.role).toBe("button");

    const findings = await source.nativeFindingsFor("ui/Home.kt#Home", ctx);
    expect(findings?.map((f) => f.kind)).toEqual(["contrast", "i18n"]);
  });

  it("returns undefined for a component it has no preview id for", async () => {
    const source = daemonSource({
      client: fakeClient(),
      previewIdFor: () => undefined,
    });
    expect(await source.getCandidate("ui/Unknown.kt#X", ctx)).toBeUndefined();
    expect(await source.nativeFindingsFor("ui/Unknown.kt#X", ctx)).toBeUndefined();
  });
});
