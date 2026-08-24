import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, sep } from "node:path";

import { BUDGET } from "./vendor/known-differences.js";

type ReadOptions = { prefix?: number };
type ArtifactAnswer =
  | Uint8Array
  | { bytes: Uint8Array; byteLength: number }
  | { error: string }
  | null;

/**
 * Build the synchronous, bounded reader required by the v1 evaluator.
 *
 * Containment is resolved against each acceptance's own directory, symlinks are never followed
 * across that boundary, and case is checked explicitly so macOS/Windows agree with Linux and URL
 * readers. Size is checked from `stat` before a full artifact is allocated.
 */
export function artifactReader(root: string): (path: string, options?: ReadOptions) => ArtifactAnswer {
  const unsafeRoot = existsSync(root) && lstatSync(root).isSymbolicLink();
  const resolvedRoot = existsSync(root) ? realpathSync(root) : root;
  return (path, options) => {
    if (unsafeRoot) return { error: "path-not-contained" };
    const full = join(root, ...path.split("/"));
    if (!existsSync(full)) return null;
    try {
      let parent = root;
      for (const segment of path.split("/")) {
        if (!readdirSync(parent).includes(segment)) return null;
        parent = join(parent, segment);
        if (lstatSync(parent).isSymbolicLink()) return { error: "path-not-contained" };
      }
      const resolved = realpathSync(full);
      const id = path.split("/")[0]!;
      const requestedAcceptance = join(resolvedRoot, id);
      const acceptance = existsSync(requestedAcceptance)
        ? realpathSync(requestedAcceptance)
        : requestedAcceptance;
      if (resolved !== acceptance && !resolved.startsWith(acceptance + sep)) {
        return { error: "path-not-contained" };
      }
      const expectedSuffix = sep + path.split("/").join(sep);
      if (!resolved.endsWith(expectedSuffix)) return null;
      const stats = statSync(resolved);
      if (!stats.isFile()) return null;
      if (stats.size > BUDGET.maxArtifactBytes) return { error: "artifact-too-large" };
      if (options?.prefix === undefined) return new Uint8Array(readFileSync(resolved));

      const buffer = Buffer.alloc(Math.min(options.prefix, stats.size));
      const handle = openSync(resolved, "r");
      try {
        let read = 0;
        while (read < buffer.length) {
          const count = readSync(handle, buffer, read, buffer.length - read, read);
          if (count === 0) break;
          read += count;
        }
        return { bytes: new Uint8Array(buffer.subarray(0, read)), byteLength: stats.size };
      } finally {
        closeSync(handle);
      }
    } catch {
      return null;
    }
  };
}
