/**
 * Build a {@link DesignReference} from a fetched Stitch design plus the images
 * the adapter rasterized. Tokens come from the primary screen's Tailwind
 * classes. No I/O — the adapter does the fetching and rasterizing.
 */
import type { DesignReference, Image } from "@design-parity/core";

import type { StitchDesign } from "./stitch-client.js";
import { tokensFromHtml } from "./tailwind-tokens.js";

export interface NormalizeInput {
  componentId: string;
  ref: string;
  design: StitchDesign;
  referenceImages: Image[];
}

/** Normalize to a `DesignReference` with `linkMethod: "manifest"`. */
export function normalizeReference(input: NormalizeInput): DesignReference {
  const primary = input.design.screens[0];
  const tokens = primary ? tokensFromHtml(primary.html) : undefined;

  const ref: DesignReference = {
    componentId: input.componentId,
    source: "stitch",
    linkMethod: "manifest",
    ref: input.ref,
    referenceImages: input.referenceImages,
  };
  if (tokens) ref.tokens = tokens;
  return ref;
}
