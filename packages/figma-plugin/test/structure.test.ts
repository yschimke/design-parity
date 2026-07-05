import { describe, expect, it } from "vitest";

import { STAMP } from "../src/scene.js";
import type { PreviewSlots } from "../src/slots.js";
import {
  isSlotFrame,
  placeSlots,
  slotContainerPreviewId,
  slotName,
  SLOT_CONTAINER_ROLE,
  SLOT_ROLE,
} from "../src/structure.js";
import { createFakeFigma, type FakeNode } from "./fakeFigma.js";

const slots: PreviewSlots = {
  previewId: "Card/Slots",
  slots: [
    { name: "leadingIcon", bounds: { left: 8, top: 8, right: 48, bottom: 48 } },
    { name: "headline", bounds: { left: 60, top: 12, right: 200, bottom: 32 } },
  ],
};

describe("placeSlots", () => {
  it("materializes a stamped, positioned, sized frame per slot under the container", () => {
    const fake = createFakeFigma();
    const container = fake.figma.createFrame();

    const placed = placeSlots(fake.figma, container, slots);

    expect(placed.map((p) => p.name)).toEqual(["leadingIcon", "headline"]);
    // The container is stamped as a slot container carrying its previewId.
    expect(container.getSharedPluginData(STAMP, "role")).toBe(SLOT_CONTAINER_ROLE);
    expect(slotContainerPreviewId(container)).toBe("Card/Slots");

    // Each slot is a child frame at its bounds, sized to its box, stamped with its name.
    const icon = placed[0]!;
    expect((container as FakeNode).children).toContain(icon.node);
    expect(icon.node.name).toBe("slot:leadingIcon");
    expect(icon.node.x).toBe(8);
    expect(icon.node.y).toBe(8);
    expect((icon.node as FakeNode).width).toBe(40);
    expect((icon.node as FakeNode).height).toBe(40);
    expect(icon.width).toBe(40);
    expect(icon.height).toBe(40);
    expect(icon.node.getSharedPluginData(STAMP, "role")).toBe(SLOT_ROLE);
    expect(isSlotFrame(icon.node)).toBe(true);
    expect(slotName(icon.node)).toBe("leadingIcon");

    const headline = placed[1]!;
    expect(headline.node.x).toBe(60);
    expect(headline.node.y).toBe(12);
    expect((headline.node as FakeNode).width).toBe(140);
    expect((headline.node as FakeNode).height).toBe(20);
  });

  it("returns an empty list for a slotless container, still stamping it", () => {
    const fake = createFakeFigma();
    const container = fake.figma.createFrame();
    const placed = placeSlots(fake.figma, container, { previewId: "Plain", slots: [] });
    expect(placed).toEqual([]);
    expect(slotContainerPreviewId(container)).toBe("Plain");
    expect((container as FakeNode).children ?? []).toHaveLength(0);
  });
});

describe("isSlotFrame / slotName / slotContainerPreviewId", () => {
  it("are false/empty on a plain frame the builder did not stamp", () => {
    const fake = createFakeFigma();
    const plain = fake.figma.createFrame();
    expect(isSlotFrame(plain)).toBe(false);
    expect(slotName(plain)).toBe("");
    expect(slotContainerPreviewId(plain)).toBe("");
  });
});
