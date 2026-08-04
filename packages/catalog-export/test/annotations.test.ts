import { describe, expect, it } from "vitest";

import {
  ANNOTATION_SCHEMA,
  buildAnnotationManifest,
  componentAnnotations,
  isEmptyAnnotationManifest,
  referenceAnnotations,
  treeAnnotations,
  withReferenceAnnotations,
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

  it("keys every ideal variant's sticker id to the component's layers", () => {
    const manifest = buildAnnotationManifest([
      component({
        redlines,
        variants: {
          ideal: [
            { path: "l.png", state: "default", theme: "light" },
            { path: "d.png", state: "default", theme: "dark" },
          ],
        },
      }),
    ]);
    expect(manifest.schema).toBe(ANNOTATION_SCHEMA);
    expect(Object.keys(manifest.previews).sort()).toEqual([
      "button-filled__ideal__default__dark",
      "button-filled__ideal__default__light",
    ]);
    expect(manifest.previews["button-filled__ideal__default__light"][0].label).toBe("pad 8dp");
  });

  it("skips an image with no previewId and nothing derivable to route on", () => {
    // No `state`, so no sticker id can be derived either — genuinely unaddressable.
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

describe("reference annotations", () => {
  const reference = {
    componentId: "Button/Filled",
    source: { kind: "figma" },
    referenceImages: [],
    linkMethod: "manual",
    layout: {
      root: {
        role: "button",
        label: "Button",
        bounds: { x: 0, y: 0, width: 200, height: 48 },
        tokens: { spacing: { padding: 16, gap: 8 }, radius: { cornerRadius: 20 } },
        children: [
          {
            role: "text",
            label: "Label",
            bounds: { x: 46, y: 26, width: 128, height: 20 },
            tokens: { typography: { labelLarge: { fontSize: 14, lineHeight: 20 } } },
          },
        ],
      },
    },
  } as never;

  it("walks the captured geometry into both layers", () => {
    const annotations = referenceAnnotations(reference);
    expect(annotations.some((a) => a.kind === "layout")).toBe(true);
    // px, not sp: this tree came from a design tool (see TypeUnit).
    expect(annotations.find((a) => a.kind === "typography")?.label).toBe("labelLarge 14px/20");
  });

  it("is empty for a source that captured no geometry", () => {
    // A raster-only reference has nothing to annotate — a property of the source,
    // not a failure.
    expect(referenceAnnotations({ ...(reference as object), layout: undefined } as never)).toEqual(
      [],
    );
  });

  it("keys layers by the publisher's reference id, not the componentId", () => {
    const manifest = withReferenceAnnotations(buildAnnotationManifest([]), {
      "design-button-filled-light": reference,
    });
    expect(Object.keys(manifest.references)).toEqual(["design-button-filled-light"]);
    expect(manifest.previews).toEqual({});
  });

  it("skips references that produced no annotations", () => {
    const manifest = withReferenceAnnotations(buildAnnotationManifest([]), {
      bare: { ...(reference as object), layout: undefined } as never,
    });
    expect(manifest.references).toEqual({});
    expect(isEmptyAnnotationManifest(manifest)).toBe(true);
  });

  it("builds both columns the same way, so agreeing specs read identically", () => {
    // The point of the two-column view: same extraction on both sides means a
    // difference in the label is a real difference in the spec.
    // Same unit on both sides, so this compares the extraction rather than the
    // unit labelling — the geometry and structure must still match exactly.
    const fromReference = referenceAnnotations(reference).find((a) => a.kind === "typography");
    const fromCandidate = treeAnnotations(reference.layout, "px").find((a) => a.kind === "typography");
    expect(fromReference).toEqual(fromCandidate);
  });
});

/**
 * Both cases below were found by inspecting a *published* manifest, not by
 * reasoning about the code — the meshcore-mobile catalog produced 19 annotated
 * references and zero annotated previews, with type sizes like "52.5sp".
 */
describe("published-catalog regressions", () => {
  const redlines = [
    {
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      padding: { top: 8, bottom: 8, start: 8, end: 8 },
    },
  ];

  it("keys on the derived sticker id when the catalog recorded no previewId", () => {
    // 62 of 70 components had redlines and none had a previewId, so requiring it
    // dropped every one and the Actual column rendered bare.
    const manifest = buildAnnotationManifest([
      component({
        componentId: "Device/Populated",
        redlines,
        variants: { ideal: [{ path: "x.png", state: "default", size: "compact" }] },
      }),
    ]);
    expect(Object.keys(manifest.previews)).toEqual(["device-populated__ideal__default__compact"]);
  });

  it("emits previewId as an alias, never as the only key", () => {
    // previewId is the fully-qualified Compose id, which the compare page does not route on —
    // keying solely on it produced a manifest the server silently ignored.
    const manifest = buildAnnotationManifest([
      component({
        componentId: "Device/Populated",
        redlines,
        variants: {
          ideal: [{ path: "x.png", state: "default", previewId: "a.b.CKt.SomePreview_light" }],
        },
      }),
    ]);
    expect(Object.keys(manifest.previews).sort()).toEqual([
      "a.b.CKt.SomePreview_light",
      "device-populated__ideal__default",
    ]);
  });

  it("quotes a design tool's type sizes in px, not sp", () => {
    // A 3x Figma board reports fontSize 52.5; calling that "52.5sp" claims a spec
    // three times the design's and would read as a huge false discrepancy.
    const reference = {
      layout: {
        root: {
          bounds: { x: 0, y: 0, width: 100, height: 40 },
          tokens: { typography: { text: { fontSize: 52.5, lineHeight: 63.5 } } },
        },
      },
    } as never;
    const [annotation] = referenceAnnotations(reference);
    expect(annotation.label).toBe("text 52.5px/63.5");
    expect(annotation.detail?.unit).toBe("px");
  });

  it("keeps sp for the candidate side, whose semantics resolve real sp", () => {
    const [annotation] = componentAnnotations(
      component({
        semantics: {
          root: {
            bounds: { x: 0, y: 0, width: 8, height: 8 },
            tokens: { typography: { bodyLarge: { fontSize: 16, lineHeight: 24 } } },
          },
        },
      }),
    );
    expect(annotation.label).toBe("bodyLarge 16sp/24");
    expect(annotation.detail?.unit).toBe("sp");
  });
});
