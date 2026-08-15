/**
 * The page walk: what it collects, and which instances survive classification.
 *
 * Hand-built trees, because the interesting cases are structural — a hidden
 * ancestor, a variant that must not be reported as its own component, an
 * instance of something nothing references.
 */
import type { FigmaNodeDoc } from "@design-parity/adapter-figma";
import { describe, expect, it } from "vitest";

import { classifyInstances, walkPage } from "../src/index.js";

const box = { x: 0, y: 0, width: 100, height: 40 };

function node(partial: Partial<FigmaNodeDoc> & { id: string; type: string }): FigmaNodeDoc {
  return { name: partial.id, absoluteBoundingBox: box, ...partial } as FigmaNodeDoc;
}

/**
 * A page with one visible set, one hidden set, and instances of both — the
 * shape every real kit page turns out to have.
 */
const page = node({
  id: "page",
  name: "Buttons",
  type: "CANVAS",
  children: [
    node({
      id: "set:button",
      name: "Button",
      type: "COMPONENT_SET",
      cornerRadius: 8,
      children: [
        node({ id: "v:enabled", name: "State=Enabled", type: "COMPONENT" }),
        node({ id: "v:disabled", name: "State=Disabled", type: "COMPONENT" }),
      ],
    }),
    node({
      id: "set:hidden",
      name: "Snackbar",
      type: "COMPONENT_SET",
      visible: false,
      children: [node({ id: "v:snack", name: "Lines=One", type: "COMPONENT" })],
    }),
    node({
      id: "frame:examples",
      name: "Examples",
      type: "FRAME",
      children: [
        node({
          id: "i:snack-example",
          name: "Snackbar",
          type: "INSTANCE",
          componentId: "v:snack",
        }),
        node({
          id: "i:button-no-icon",
          name: "Button",
          type: "INSTANCE",
          componentId: "v:enabled",
          componentProperties: {
            "Show icon#1:0": { type: "BOOLEAN", value: false },
            "State#2:0": { type: "VARIANT", value: "Enabled" },
          },
        }),
      ],
    }),
    node({
      id: "frame:hidden",
      name: "Scratch",
      type: "FRAME",
      visible: false,
      children: [
        node({
          id: "i:invisible",
          name: "Button",
          type: "INSTANCE",
          componentId: "v:enabled",
          componentProperties: { "Show icon#1:0": { type: "BOOLEAN", value: true } },
        }),
      ],
    }),
  ],
});

describe("walkPage", () => {
  const walk = walkPage(page);

  it("records component sets but not their variants as separate components", () => {
    expect(walk.components.map((c) => c.id)).toEqual(["set:button", "set:hidden"]);
    expect(walk.components[0]?.children.map((v) => v.id)).toEqual([
      "v:enabled",
      "v:disabled",
    ]);
  });

  it("propagates hidden-ness down from an ancestor", () => {
    expect(walk.components.find((c) => c.id === "set:hidden")?.hidden).toBe(true);
    expect(walk.components.find((c) => c.id === "set:button")?.hidden).toBe(false);
  });

  it("skips instances under a hidden ancestor", () => {
    // A hidden instance cannot be exported, so recording it as a render handle
    // would produce a reference that resolves to a blank image.
    expect(walk.instances.map((i) => i.id)).toEqual([
      "i:snack-example",
      "i:button-no-icon",
    ]);
  });

  it("strips the opaque id suffix from property names and drops variant axes", () => {
    const instance = walk.instances.find((i) => i.id === "i:button-no-icon");
    // `State` is a VARIANT: it is already in the variant's own name, and
    // recording it twice invites the two to disagree.
    expect(Object.keys(instance?.properties ?? {})).toEqual(["Show icon"]);
    expect(instance?.properties["Show icon"]?.value).toBe(false);
  });

  it("flags instances that sit under an Examples frame", () => {
    expect(walk.instances.find((i) => i.id === "i:snack-example")?.example).toBe(true);
  });

  it("reports how deep it reached, so a shallow bound is legible", () => {
    expect(walk.deepest).toBe(2);
  });
});

describe("classifyInstances", () => {
  const walk = walkPage(page);

  it("keeps a hidden set's example as its render handle", () => {
    const { renderInstances } = classifyInstances(walk, new Set());
    expect(renderInstances.map((i) => i.id)).toEqual(["i:snack-example"]);
  });

  it("keeps property instances only for referenced sets", () => {
    // Nothing referenced: a kit page holds hundreds of unrelated screen
    // instances, and keeping them all makes the index a copy of the document.
    expect(classifyInstances(walk, new Set()).propertyInstances).toEqual([]);

    const referenced = classifyInstances(walk, new Set(["v:disabled"]));
    expect(referenced.propertyInstances.map((i) => i.id)).toEqual([
      "i:button-no-icon",
    ]);
  });

  it("ignores instances carrying no non-variant properties", () => {
    // The snackbar example has none, so it is a render handle and nothing else.
    const { propertyInstances } = classifyInstances(walk, new Set(["v:snack"]));
    expect(propertyInstances).toEqual([]);
  });
});
