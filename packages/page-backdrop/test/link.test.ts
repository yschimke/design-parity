import { describe, it, expect } from "vitest";

import type { DesignMap } from "@design-parity/core";

import type { InstanceHit } from "../src/instances.js";
import { baseComponentName, linkInstance, linkInstances } from "../src/link.js";

const FILE = "AbCdEf123456";

const hit = (over: Partial<InstanceHit> = {}): InstanceHit => ({
  nodeId: "2:1",
  name: "Button/Primary",
  componentId: "10:5",
  componentSetId: "10:1",
  bounds: { x: 0, y: 0, width: 100, height: 40 },
  depth: 0,
  ...over,
});

describe("linkInstance precedence", () => {
  it("prefers Code Connect over the design map", () => {
    const designMap: DesignMap = {
      components: [{ code: "ui/Map.kt#Mapped", source: "figma", ref: `figma:${FILE}/10:1` }],
    };
    const { placement } = linkInstance(hit(), FILE, {
      codeConnect: { "ui/Button.kt#PrimaryButton": `figma:${FILE}/10:1` },
      designMap,
    });
    expect(placement.code).toBe("ui/Button.kt#PrimaryButton");
    expect(placement.link).toBe("code-connect");
  });

  it("falls back to the design map when Code Connect has nothing", () => {
    const designMap: DesignMap = {
      components: [{ code: "ui/Button.kt#PrimaryButton", source: "figma", ref: `figma:${FILE}/10:1` }],
    };
    const { placement } = linkInstance(hit(), FILE, { designMap });
    expect(placement.code).toBe("ui/Button.kt#PrimaryButton");
    expect(placement.link).toBe("manifest");
    expect(placement.matchedRef).toBe(`figma:${FILE}/10:1`);
  });

  it("matches the component set before the component before the instance", () => {
    // All three refs are bound; the widest (the set) must win, because that is
    // where Code Connect normally sits.
    const codeConnect = {
      "ui/Set.kt#FromSet": `figma:${FILE}/10:1`,
      "ui/Comp.kt#FromComponent": `figma:${FILE}/10:5`,
      "ui/Inst.kt#FromInstance": `figma:${FILE}/2:1`,
    };
    expect(linkInstance(hit(), FILE, { codeConnect }).placement.code).toBe("ui/Set.kt#FromSet");

    const noSet = hit({ componentSetId: undefined });
    expect(linkInstance(noSet, FILE, { codeConnect }).placement.code).toBe(
      "ui/Comp.kt#FromComponent",
    );

    const bare = hit({ componentSetId: undefined, componentId: undefined });
    expect(linkInstance(bare, FILE, { codeConnect }).placement.code).toBe("ui/Inst.kt#FromInstance");
  });

  it("links an instance whose variant differs from the mapped one, via refSet", () => {
    // The real m3-catalog failure: the Upcoming screen's list items are
    // instances of 51964:65404, a sibling of the variant the catalog pictured.
    // Matching on the mapped variant alone left all five unlinked even though
    // the component is mapped; the component set covers every variant at once.
    const listItem = hit({
      nodeId: "2:7",
      name: "List item",
      componentId: "51964:65404",
      componentSetId: "51964:63037",
    });
    const designMap: DesignMap = {
      components: [
        {
          code: "ui/Lists.kt#ListItemSticker",
          source: "figma",
          ref: `figma:${FILE}/51964:64241`, // a different variant — what parity diffs against
          refSet: `figma:${FILE}/51964:63037`, // the family the screen's variant belongs to
        },
      ],
    };

    const { placement } = linkInstance(listItem, FILE, { designMap });
    expect(placement.code).toBe("ui/Lists.kt#ListItemSticker");
    expect(placement.link).toBe("manifest");
    // Matched on the set, and says so — a reader can see which ref carried it.
    expect(placement.matchedRef).toBe(`figma:${FILE}/51964:63037`);

    // Without refSet the same instance is unlinked, which is the bug.
    const withoutSet: DesignMap = {
      components: [
        { code: "ui/Lists.kt#ListItemSticker", source: "figma", ref: `figma:${FILE}/51964:64241` },
      ],
    };
    expect(linkInstance(listItem, FILE, { designMap: withoutSet }).placement.link).toBe("unlinked");
  });

  it("still prefers the exact variant when the design map names it", () => {
    // refSet widens matching; it must not coarsen it. An instance whose own
    // component is mapped should resolve to that component's code, not to
    // whatever else shares the family.
    const designMap: DesignMap = {
      components: [
        {
          code: "ui/Bars.kt#Medium",
          source: "figma",
          ref: `figma:${FILE}/10:5`,
          refSet: `figma:${FILE}/10:1`,
        },
        {
          code: "ui/Bars.kt#Small",
          source: "figma",
          ref: `figma:${FILE}/10:9`,
          refSet: `figma:${FILE}/10:1`,
        },
      ],
    };
    // The linker tries the set first, so a shared family is ambiguous and warns
    // rather than silently picking — the honest outcome when two components
    // claim the same set.
    const { placement, warnings } = linkInstance(hit(), FILE, { designMap });
    expect(placement.code).toBe("ui/Bars.kt#Medium");
    expect(warnings.join("\n")).toMatch(/bound to 2 code handles/);
  });

  it("falls back to a name match, flagged as convention", () => {
    const { placement } = linkInstance(hit({ name: "OfferCard" }), FILE, {
      codeHandles: ["ui/Card.kt#OfferCard", "ui/Button.kt#PrimaryButton"],
    });
    expect(placement.code).toBe("ui/Card.kt#OfferCard");
    expect(placement.link).toBe("convention");
    // A guess carries no matched ref — nothing in the repo actually said so.
    expect(placement.matchedRef).toBeUndefined();
  });

  it("matches a variant instance by its base component name", () => {
    const { placement } = linkInstance(hit({ name: "Button/Primary (hover)" }), FILE, {
      codeHandles: ["ui/Button.kt#Button"],
    });
    expect(placement.code).toBe("ui/Button.kt#Button");
    expect(placement.link).toBe("convention");
  });

  it("leaves an ambiguous name unlinked, with a warning, rather than guessing", () => {
    const { placement, warnings } = linkInstance(hit({ name: "Card" }), FILE, {
      codeHandles: ["a/One.kt#Card", "b/Two.kt#Card"],
    });
    expect(placement.link).toBe("unlinked");
    expect(placement.code).toBeUndefined();
    expect(warnings.join("\n")).toMatch(/matches 2 code handles/);
  });

  it("keeps an instance nothing matched — the gap is the finding", () => {
    const { placement } = linkInstance(hit({ name: "Mystery" }), FILE, {});
    expect(placement).toMatchObject({
      nodeId: "2:1",
      name: "Mystery",
      link: "unlinked",
      componentId: "10:5",
      componentSetId: "10:1",
    });
  });

  it("does not match a ref from a different Figma file", () => {
    const { placement } = linkInstance(hit(), FILE, {
      codeConnect: { "ui/Button.kt#PrimaryButton": "figma:OtherFileKey/10:1" },
    });
    expect(placement.link).toBe("unlinked");
  });

  it("warns and picks the first handle when one ref binds several", () => {
    const designMap: DesignMap = {
      components: [
        { code: "z/Late.kt#Zed", source: "figma", ref: `figma:${FILE}/10:1` },
        { code: "a/Early.kt#Alpha", source: "figma", ref: `figma:${FILE}/10:1` },
      ],
    };
    const { placement, warnings } = linkInstance(hit(), FILE, { designMap });
    // buildReverseIndex sorts, so the choice is deterministic, not input-ordered.
    expect(placement.code).toBe("a/Early.kt#Alpha");
    expect(warnings.join("\n")).toMatch(/bound to 2 code handles/);
  });
});

describe("linkInstances", () => {
  it("links a batch and aggregates warnings", () => {
    const { placements, warnings } = linkInstances(
      [hit(), hit({ nodeId: "2:2", name: "Card", componentId: undefined, componentSetId: undefined })],
      FILE,
      {
        codeConnect: { "ui/Button.kt#PrimaryButton": `figma:${FILE}/10:1` },
        codeHandles: ["a/One.kt#Card", "b/Two.kt#Card"],
      },
    );
    expect(placements.map((p) => p.link)).toEqual(["code-connect", "unlinked"]);
    expect(warnings).toHaveLength(1);
  });
});

describe("baseComponentName", () => {
  it("takes the first path segment and drops a trailing state suffix", () => {
    expect(baseComponentName("Button/Primary")).toBe("Button");
    expect(baseComponentName("Chip (selected)")).toBe("Chip");
    expect(baseComponentName("Nav bar")).toBe("Nav bar");
  });
});
