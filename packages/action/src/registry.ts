/**
 * The `source → adapter` registry.
 *
 * Each adapter only declares a const `source`; nothing maps a {@link DesignSource}
 * to a concrete {@link ReferenceAdapter}. That map can't live in `core` (core must
 * not depend on adapters), so it lives here — the one place that imports all three
 * drivers. Per-adapter options are injectable so tests and the CLI can supply
 * credentials, output dirs, or fakes.
 */
import type { DesignSource, ReferenceAdapter } from "@design-parity/core";
import { createFigmaAdapter } from "@design-parity/adapter-figma";
import { createStitchAdapter } from "@design-parity/adapter-stitch";
import { ClaudeDesignAdapter } from "@design-parity/adapter-claude-design";

export type AdapterRegistry = Record<DesignSource, ReferenceAdapter>;

export interface RegistryOptions {
  figma?: Parameters<typeof createFigmaAdapter>[0];
  stitch?: Parameters<typeof createStitchAdapter>[0];
  claudeDesign?: ConstructorParameters<typeof ClaudeDesignAdapter>[0];
}

/** Build the default registry wiring all three reference drivers. */
export function createAdapterRegistry(opts: RegistryOptions = {}): AdapterRegistry {
  return {
    figma: createFigmaAdapter(opts.figma),
    stitch: createStitchAdapter(opts.stitch),
    "claude-design": new ClaudeDesignAdapter(opts.claudeDesign),
  };
}
