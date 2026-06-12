import { StitchBadRefError } from "./errors.js";

/**
 * A Stitch design handle: the two coordinates the SDK needs to fetch a screen.
 * Stitch has no machine link, so these come from `design-map.json`.
 */
export interface StitchRef {
  /** Stitch project / design id. */
  projectId: string;
  /** Screen id within the project. */
  screenId: string;
}

/**
 * Parse a design-map `ref` into a {@link StitchRef}.
 *
 * Accepts `stitch:<projectId>/<screenId>` (the manifest form). Both segments
 * may contain letters, digits, `.`, `_`, and `-`.
 *
 * @throws {StitchBadRefError} if the shape doesn't match.
 */
export function parseStitchRef(ref: string): StitchRef {
  const m = /^stitch:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(ref.trim());
  if (!m) throw new StitchBadRefError(ref);
  return { projectId: m[1]!, screenId: m[2]! };
}

/** Whether a `ref` is a Stitch handle this adapter can parse directly. */
export function isStitchRef(ref: string): boolean {
  try {
    parseStitchRef(ref);
    return true;
  } catch {
    return false;
  }
}

/** Format a {@link StitchRef} back into the manifest `stitch:<project>/<screen>` form. */
export function formatStitchRef({ projectId, screenId }: StitchRef): string {
  return `stitch:${projectId}/${screenId}`;
}
