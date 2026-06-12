import { describe, it, expect } from "vitest";

import {
  parseCodeConnectDocs,
  resolveFromCodeConnect,
} from "../src/code-connect.js";

const docs = [
  {
    figmaNode: "https://www.figma.com/design/AbCdEf123456/UI?node-id=1-42",
    component: "PrimaryButton",
    source: "ui/Button.kt",
  },
  {
    // points at another file's page — unparseable here, must be skipped
    figmaNode: "not-a-figma-url",
    component: "Broken",
    source: "ui/Broken.kt",
  },
];

describe("parseCodeConnectDocs", () => {
  it("indexes by the fully-qualified handle and the bare component", () => {
    const map = parseCodeConnectDocs(docs);
    expect(map.get("ui/Button.kt#PrimaryButton")).toEqual({
      fileKey: "AbCdEf123456",
      nodeId: "1:42",
    });
    expect(map.get("PrimaryButton")?.nodeId).toBe("1:42");
  });

  it("skips docs whose figmaNode can't be parsed", () => {
    const map = parseCodeConnectDocs(docs);
    expect(map.has("ui/Broken.kt#Broken")).toBe(false);
  });

  it("accepts a { docs: [...] } envelope", () => {
    const map = parseCodeConnectDocs({ docs });
    expect(map.size).toBeGreaterThan(0);
  });
});

describe("resolveFromCodeConnect", () => {
  const map = parseCodeConnectDocs(docs);

  it("resolves an exact handle", () => {
    expect(resolveFromCodeConnect("ui/Button.kt#PrimaryButton", map)?.nodeId).toBe(
      "1:42",
    );
  });

  it("falls back to the member name after #", () => {
    expect(resolveFromCodeConnect("other/Path.kt#PrimaryButton", map)?.nodeId).toBe(
      "1:42",
    );
  });

  it("returns undefined when unknown", () => {
    expect(resolveFromCodeConnect("ui/Nope.kt#Nope", map)).toBeUndefined();
  });
});
