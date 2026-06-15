/**
 * Reverse correspondence index — design → code (issue #78 Phase 4).
 *
 * The resolver answers "which design does this code map to?". The reverse
 * direction — "which code implements this design node?" — is what a design tool
 * (or a designer) needs to act on a change, and the only design→code link a
 * source without Code Connect (Stitch, Claude Design, bundle) has. It's a pure
 * inversion of the committed inputs: the `design-map.json` (including every
 * variant-tagged node of a multi-node binding) plus any Code Connect links.
 *
 * A ref can map to more than one code handle (two components sharing a frame),
 * so lookups return a list; handles are de-duplicated and sorted for a
 * deterministic result.
 */
import type { DesignMap } from "@design-parity/core";
import { entryRefs } from "@design-parity/core";

import type { CodeConnectIndex } from "./resolver.js";

/** Design ref handle → the code handle(s) that implement it. */
export type ReverseIndex = ReadonlyMap<string, readonly string[]>;

/**
 * Build the design→code index from the committed manifest and Code Connect.
 * Every ref of a multi-node binding points back at the same code handle.
 */
export function buildReverseIndex(
  designMap?: DesignMap,
  codeConnect?: CodeConnectIndex,
): ReverseIndex {
  const index = new Map<string, string[]>();
  const add = (ref: string, code: string): void => {
    const list = index.get(ref) ?? [];
    if (!list.includes(code)) list.push(code);
    index.set(ref, list);
  };

  for (const entry of designMap?.components ?? []) {
    for (const variant of entryRefs(entry)) add(variant.ref, entry.code);
  }
  for (const [code, ref] of Object.entries(codeConnect ?? {})) add(ref, code);

  for (const list of index.values()) list.sort();
  return index;
}

/** The code handle(s) implementing `ref`, or an empty array when none. */
export function codeForRef(index: ReverseIndex, ref: string): readonly string[] {
  return index.get(ref) ?? [];
}
