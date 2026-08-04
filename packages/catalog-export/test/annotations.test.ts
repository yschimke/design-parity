import { describe, expect, it } from "vitest";

import {
  ANNOTATION_SCHEMA,
  buildAnnotationManifest,
  componentAnnotations,
  isEmptyAnnotationManifest,
} from "../src/annotations.js";
import type { CatalogComponent } from "../src/types.js";

function component(overrides: Partial<CatalogComponent> = {}): CatalogComponent {
  return {
    componentId: "Button/Filled",
    variants: { ideal: [{ path: "a.png", previewId: "button__light" }] },
    greenlines: [],
    redlines: [],
    ...overrides,
  } as CatalogComponent;
}

describe("layout annotations", () => {
  it("collapses four equal edges into a single padding phrase", () => {
    const [annotation] = componentAnnotations(
      component({
        redlines: [
          {
            bounds: { x: 0, y: 0, width: 100, height: 40 },
            padding: { top: 16, bottom: 16, start: 16, end: 16 },
            gap: 8,
            cornerRadius: 20,
            label: "Button",
          },
        ],
      }),
    );
    expect(annotation.kind).toBe("layout");
    expect(annotation.label).toBe("pad 16dp · gap 8dp · r 20dp");
    expect(annotation.role).toBe("Button");
    expect(annotation.detail).toMatchObject({ gap: "8", cornerRadius: "20" });
  });

  it("writes a symmetric box as vertical/horizontal", () => {
    const [annotation] = componentAnnotations(
      component({
        redlines: [
          {
            bounds: { x: 0, y: 0, width: 100, height: 40 },
            padding: { top: 12, bottom: 12, start: 16, end: 16 },
          },
        ],
      }),
    );
    expect(annotation.label).toBe("pad 12dp/16dp");
  });

  it("spells out asymmetric padding per edge rather than averaging it", () => {
    const [annotation] = componentAnnotations(
      component({
        redlines: [
          {
            bounds: { x: 0, y: 0, width: 100, height: 40 },
            padding: { top: 4, bottom: 12, start: 16, end: 8 },
          },
        ],
      }),
    );
    expect(annotation.label).toBe("pad t 4dp e 8dp b 12dp s 16dp");
  });

  it("drops a redline with a box but no spacing spec", () => {
    // The box is already visible in the render; an unlabelled rectangle adds noise.
    expect(
      componentAnnotations(
        component({ redlines: [{ bounds: { x: 0, y: 0, width: 10, height: 10 } }] }),
      ),
    ).toEqual([]);
  });

  it("trims trailing zeros off fractional measurements", () => {
    const [annotation] = componentAnnotations(
      component({ redlines: [{ bounds: { x: 0, y: 0, width: 8, height: 8 }, gap: 7.25 }] }),
    );
    expect(annotation.label).toBe("gap 7.3dp");
  });
});

describe("typography annotations", () => {
  const semantics = {
    root: {
      role: "column",
      children: [
        {
          role: "text",
          label: "Send",
          bounds: { x: 4, y: 6, width: 40, height: 12 },
          tokens: { typography: { labelLarge: { fontSize: 14, lineHeight: 20, fontWeight: 500 } } },
        },
        // No bounds — nowhere to anchor, so it must not produce an annotation.
        {
          role: "text",
          tokens: { typography: { bodySmall: { fontSize: 12 } } },
        },
      ],
    },
  };

  it("labels a resolved type style with size and line height", () => {
    const annotations = componentAnnotations(component({ semantics }));
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      kind: "typography",
      label: "labelLarge 14sp/20",
      role: "Send",
    });
    expect(annotations[0].detail).toMatchObject({ token: "labelLarge", fontWeight: "500" });
  });

  it("omits the line height when the token does not carry one", () => {
    const [annotation] = componentAnnotations(
      component({
        semantics: {
          root: {
            bounds: { x: 0, y: 0, width: 8, height: 8 },
            tokens: { typography: { bodySmall: { fontSize: 12 } } },
          },
        },
      }),
    );
    expect(annotation.label).toBe("bodySmall 12sp");
  });

  it("skips a style with no font size, which has nothing to state", () => {
    expect(
      componentAnnotations(
        component({
          semantics: {
            root: {
              bounds: { x: 0, y: 0, width: 8, height: 8 },
              tokens: { typography: { mystery: { fontWeight: 700 } } },
            },
          },
        }),
      ),
    ).toEqual([]);
  });
});

describe("manifest", () => {
  const redlines = [
    { bounds: { x: 0, y: 0, width: 10, height: 10 }, padding: { top: 8, bottom: 8, start: 8, end: 8 } },
  ];

  it("keys every ideal variant's preview id to the component's layers", () => {
    const manifest = buildAnnotationManifest([
      component({
        redlines,
        variants: {
          ideal: [
            { path: "l.png", previewId: "button__light" },
            { path: "d.png", previewId: "button__dark" },
          ],
        },
      }),
    ]);
    expect(manifest.schema).toBe(ANNOTATION_SCHEMA);
    expect(Object.keys(manifest.previews).sort()).toEqual(["button__dark", "button__light"]);
    expect(manifest.previews.button__light[0].label).toBe("pad 8dp");
  });

  it("skips images with no preview id, which the server cannot route to", () => {
    const manifest = buildAnnotationManifest([
      component({ redlines, variants: { ideal: [{ path: "a.png" }] } }),
    ]);
    expect(isEmptyAnnotationManifest(manifest)).toBe(true);
  });

  it("omits components that produced no annotations", () => {
    const manifest = buildAnnotationManifest([component({ redlines: [] })]);
    expect(manifest.previews).toEqual({});
    expect(isEmptyAnnotationManifest(manifest)).toBe(true);
  });

  it("leaves references empty — the catalog is not the source of design geometry", () => {
    expect(buildAnnotationManifest([component({ redlines })]).references).toEqual({});
  });
});
