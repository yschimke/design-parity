import { describe, it, expect } from "vitest";

import type {
  FigmaNodeDoc,
  FigmaStyleMeta,
  VariablesResponse,
} from "../src/figma-api.js";
import { normalizeReference } from "../src/normalize.js";

/** A FLOAT-only Variables collection with a single mode. */
function floats(
  collectionName: string,
  vars: Record<string, number>,
): VariablesResponse {
  const ids = Object.keys(vars);
  return {
    meta: {
      variableCollections: {
        C: {
          id: "C",
          name: collectionName,
          defaultModeId: "m",
          modes: [{ modeId: "m", name: "Mode 1" }],
          variableIds: ids,
        },
      },
      variables: Object.fromEntries(
        ids.map((name) => [
          name,
          { id: name, name, resolvedType: "FLOAT" as const, valuesByMode: { m: vars[name]! } },
        ]),
      ),
    },
  };
}

const node: FigmaNodeDoc = { id: "1", name: "Frame", type: "FRAME" };

function normalize(
  variables: VariablesResponse,
  opts: { node?: FigmaNodeDoc; styles?: Record<string, FigmaStyleMeta> } = {},
) {
  return normalizeReference({
    componentId: "c#C",
    ref: "figma:KEY/1:1",
    node: opts.node ?? node,
    variables,
    ...(opts.styles ? { styles: opts.styles } : {}),
    referenceImages: [],
  }).themeTokens;
}

describe("themeTokens numeric extraction", () => {
  it("classifies FLOATs onto radius/spacing by their name hint, keeping the path", () => {
    const tokens = normalize(
      floats("Tokens", { "radius/medium": 8, "space/large": 24 }),
    );
    expect(tokens?.radius).toEqual({ "radius/medium": 8 });
    expect(tokens?.spacing).toEqual({ "space/large": 24 });
  });

  it("falls back to the collection name when the variable name has no hint", () => {
    const tokens = normalize(floats("Radius", { medium: 8, small: 4 }));
    expect(tokens?.radius).toEqual({ medium: 8, small: 4 });
    expect(tokens?.spacing).toBeUndefined();
  });

  it("leaves an un-hinted FLOAT out rather than guessing a scale", () => {
    const tokens = normalize(floats("Elevation", { "elevation/raised": 3 }));
    expect(tokens).toBeUndefined();
  });
});

describe("themeTokens typography extraction", () => {
  it("lifts a TEXT style referenced in the subtree, keyed by its style name", () => {
    const textNode: FigmaNodeDoc = {
      id: "1",
      name: "Frame",
      type: "FRAME",
      children: [
        {
          id: "2",
          name: "Heading",
          type: "TEXT",
          styles: { text: "S:1" },
          style: { fontFamily: "Roboto", fontSize: 22, fontWeight: 400, lineHeightPx: 28 },
        },
      ],
    };
    const styles = { "S:1": { key: "k", name: "Title/Large", styleType: "TEXT" as const } };
    const tokens = normalize({}, { node: textNode, styles });
    expect(tokens?.typography).toEqual({
      "title/large": { fontFamily: "Roboto", fontSize: 22, fontWeight: 400, lineHeight: 28 },
    });
  });

  it("ignores a node whose style reference isn't a TEXT style", () => {
    const textNode: FigmaNodeDoc = {
      id: "1",
      name: "Frame",
      type: "FRAME",
      children: [
        {
          id: "2",
          name: "Box",
          type: "RECTANGLE",
          styles: { fill: "S:fill" },
          style: { fontSize: 12 },
        },
      ],
    };
    const styles = { "S:fill": { key: "k", name: "Brand/Blue", styleType: "FILL" as const } };
    expect(normalize({}, { node: textNode, styles })).toBeUndefined();
  });
});
