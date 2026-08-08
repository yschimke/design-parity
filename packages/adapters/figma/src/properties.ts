/**
 * What a rendered Figma reference actually depicts.
 *
 * `GET /v1/images` renders a node at its component-property **defaults**, and
 * those defaults appear nowhere in the variant's name. The M3 kit's `Button`
 * set defaults `Show icon` to `true`, so a node named
 * `Type=Round, Size=Small, State=Enabled` renders with an icon — and label-only
 * code is then diffed against an icon+label reference, with every downstream
 * surface reporting the mismatch as a parity failure.
 *
 * This module turns the definitions the API returns into the source-agnostic
 * {@link ReferenceProperty} list, resolved to the values *this* node rendered
 * with: variant axes off the node's own name, everything else off the default.
 * Pure — the adapter does the fetching.
 */
import type { ReferenceProperty, ReferencePropertyType } from "@design-parity/core";

import type {
  FigmaComponentPropertyDefinition,
  FigmaNodeDoc,
} from "./figma-api.js";
import { parseVariantName } from "./variant-name.js";

const TYPES: Record<
  FigmaComponentPropertyDefinition["type"],
  ReferencePropertyType
> = {
  VARIANT: "variant",
  BOOLEAN: "boolean",
  TEXT: "text",
  INSTANCE_SWAP: "instance-swap",
};

/**
 * Strip Figma's id suffix from a property key: `"Show icon#5590:0"` →
 * `"Show icon"`. The suffix is an internal handle, and a report that printed it
 * would be naming something the designer never sees in the kit.
 */
export function propertyName(key: string): string {
  const hash = key.indexOf("#");
  return (hash === -1 ? key : key.slice(0, hash)).trim();
}

/**
 * The properties a reference render used.
 *
 * @param node the node that was rendered (a variant `COMPONENT`, a
 *   `COMPONENT_SET`, or a plain frame).
 * @param set the `COMPONENT_SET` that owns `node`, when it has one. A variant
 *   carries no definitions of its own — they live on the set — so without this
 *   a variant reference reports no properties at all.
 * @returns one entry per declared property, sorted by name for determinism.
 *   Empty when the source declares none, which is the honest answer for a node
 *   that is not a component.
 */
export function referenceProperties(
  node: FigmaNodeDoc,
  set?: FigmaNodeDoc,
): ReferenceProperty[] {
  const definitions =
    set?.componentPropertyDefinitions ?? node.componentPropertyDefinitions;
  if (!definitions) return [];

  // A variant pins its axes in its own name; the set's `defaultValue` for an
  // axis is whichever variant the author happened to leave first, so the node
  // wins wherever it says anything.
  const axes = parseVariantName(node.name);

  const out: ReferenceProperty[] = [];
  for (const [key, definition] of Object.entries(definitions)) {
    const name = propertyName(key);
    if (!name) continue;
    const type = TYPES[definition.type];
    const value =
      (type === "variant" ? axes.get(name) : undefined) ??
      String(definition.defaultValue);
    const property: ReferenceProperty = { name, type, value };
    if (definition.variantOptions?.length) {
      property.options = [...definition.variantOptions];
    }
    out.push(property);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
