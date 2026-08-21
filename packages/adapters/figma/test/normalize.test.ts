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

describe("board density converts a capture into the code's units (#375)", () => {
  // A 3× board states a 16dp gutter as 48, a 26dp corner as 78 and 14sp type at
  // 42. Comparing those against a render that already resolved dp invents a
  // threefold divergence, which is what `DesignMapEntry.density` exists to stop
  // — and, until this hop existed, never could.
  const scaled: FigmaNodeDoc = {
    id: "1:1",
    name: "Card",
    type: "FRAME",
    paddingLeft: 48,
    cornerRadius: 78,
    absoluteBoundingBox: { x: 0, y: 0, width: 576, height: 312 },
    children: [
      {
        id: "1:2",
        name: "Label",
        type: "TEXT",
        characters: "Hello",
        absoluteBoundingBox: { x: 36, y: 36, width: 504, height: 54 },
        style: { fontSize: 42, lineHeightPx: 48, letterSpacing: 1.2 },
      },
    ],
  } as unknown as FigmaNodeDoc;

  const at = (density?: number) =>
    normalizeReference({
      componentId: "c#C",
      ref: "figma:KEY/1:1",
      node: scaled,
      variables: floats("Numbers", {}),
      referenceImages: [],
      ...(density === undefined ? {} : { density }),
    });

  it("divides the captured specs through", () => {
    const ref = at(3);
    expect(ref.tokens?.spacing).toEqual({ padding: 16 });
    expect(ref.tokens?.radius).toEqual({ corner: 26 });
    expect(ref.tokens?.typography?.label).toMatchObject({
      fontSize: 14,
      lineHeight: 16,
      letterSpacing: 0.4,
    });
  });

  it("stamps the factor on the layout, for the boxes it did NOT convert", () => {
    // `bounds` stay in the board's pixels — they are anchors over the captured
    // image — so anything measuring them has to be told the scale. That is what
    // makes a scaled board's geometry usable by the inset corroboration (#371).
    const layout = at(3)?.layout;
    expect(layout?.density).toBe(3);
    expect(layout?.boundsDensity).toBe(3);
  });

  it("changes nothing at all when no density is stated", () => {
    // The whole point: inert for every project that has not opted in. An
    // unstated scale is "already in the code's units", not a guess at 1×.
    const ref = at();
    expect(ref.tokens?.spacing).toEqual({ padding: 48 });
    expect(ref.tokens?.radius).toEqual({ corner: 78 });
    expect(ref.tokens?.typography?.label).toMatchObject({ fontSize: 42, lineHeight: 48 });
    expect(ref.layout?.density).toBeUndefined();
    expect(ref.layout?.boundsDensity).toBeUndefined();
  });

  it("leaves the design-system Variables table alone", () => {
    // A published style's properties are read off the board and carry its
    // pixels; a Variable is a number the designer declared, and nothing says it
    // was authored at the board's scale. Scaling it would be the guess this
    // field exists to avoid.
    const ref = normalizeReference({
      componentId: "c#C",
      ref: "figma:KEY/1:1",
      node: scaled,
      variables: floats("Numbers", { "radius/large": 78 }),
      referenceImages: [],
      density: 3,
    });
    expect(ref.themeTokens?.radius).toMatchObject({ "radius/large": 78 });
  });
});
