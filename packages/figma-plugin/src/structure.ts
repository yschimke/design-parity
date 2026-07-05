/**
 * The structured-screen builder's plugin core: turn a placed container render and
 * its `/render/<id>.slots` response into stamped **slot frames** on the canvas — the
 * visible boxes a designer fills with child components.
 *
 * Pure scene logic over the injected {@link FigmaApi}, tested headlessly like
 * {@link ./scene.js}; the thin `figma/code.ts` bootstrap passes the real `figma` in.
 * Consumes the parsed slots from {@link ./slots.js} (the `/render/<id>.slots` client).
 */
import { STAMP, type FigmaApi, type FigmaNode } from "./scene.js";
import { slotHeight, slotWidth, type PreviewSlots } from "./slots.js";

/** The `role` stamp on a materialized slot frame (a sibling of scene.ts's `ROLE`). */
export const SLOT_ROLE = "slot";

/** The `role` stamp on a container whose slots have been materialized. */
export const SLOT_CONTAINER_ROLE = "slot-container";

/** One materialized slot: its name, the frame created for it, and its box size in px. */
export interface PlacedSlot {
  name: string;
  node: FigmaNode;
  width: number;
  height: number;
}

/**
 * Materialize every slot in [slots] as an empty frame under [container]: each is
 * positioned at the slot's bounds (relative to the container's top-left), sized to
 * the slot's box, and stamped with {@link SLOT_ROLE} + its name so a later fill or
 * refresh finds it. [container] is stamped {@link SLOT_CONTAINER_ROLE} with the
 * `previewId` it came from. Returns the placed slots in slot order.
 *
 * A slot's box is exactly the constraint a child rendered to fill it should get —
 * fetch that child at `?widthPx=<width>&heightPx=<height>` and drop it in the frame.
 */
export function placeSlots(
  figma: FigmaApi,
  container: FigmaNode,
  slots: PreviewSlots,
): PlacedSlot[] {
  container.setSharedPluginData(STAMP, "role", SLOT_CONTAINER_ROLE);
  container.setSharedPluginData(STAMP, "slotContainer", slots.previewId);
  const placed: PlacedSlot[] = [];
  for (const slot of slots.slots) {
    const width = slotWidth(slot);
    const height = slotHeight(slot);
    const frame = figma.createFrame();
    frame.name = `slot:${slot.name}`;
    // Append first, then set position: once parented, x/y are relative to the
    // container, so the slot sits exactly where the semantics bounds put it.
    container.appendChild(frame);
    frame.x = slot.bounds.left;
    frame.y = slot.bounds.top;
    frame.resize(width, height);
    frame.setSharedPluginData(STAMP, "role", SLOT_ROLE);
    frame.setSharedPluginData(STAMP, "slotName", slot.name);
    placed.push({ name: slot.name, node: frame, width, height });
  }
  return placed;
}

/** True for a frame [placeSlots] materialized as a slot. */
export function isSlotFrame(node: FigmaNode): boolean {
  return node.getSharedPluginData(STAMP, "role") === SLOT_ROLE;
}

/** The slot name stamped on a slot frame, or `""` when it carries none. */
export function slotName(node: FigmaNode): string {
  return node.getSharedPluginData(STAMP, "slotName");
}

/** The `previewId` stamped on a container whose slots were materialized, else `""`. */
export function slotContainerPreviewId(node: FigmaNode): string {
  return node.getSharedPluginData(STAMP, "slotContainer");
}
