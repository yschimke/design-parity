import { FigmaBadRefError } from "./errors.js";

/** A Figma file key + node id, the two coordinates every REST call needs. */
export interface FigmaRef {
  fileKey: string;
  /** Canonical form with a colon, e.g. `"1:42"` (URLs use `1-42`). */
  nodeId: string;
}

/** Figma URLs encode the node id with a dash; the REST API wants a colon. */
function canonicalNodeId(raw: string): string {
  return raw.replace(/-/g, ":");
}

/**
 * Parse a design-map `ref` or a figma.com URL into a {@link FigmaRef}.
 *
 * Accepts:
 * - `figma:<fileKey>/<nodeId>` (our manifest form), nodeId as `1:42` or `1-42`
 * - `https://www.figma.com/design/<fileKey>/<name>?node-id=<1-42>`
 * - `https://www.figma.com/file/<fileKey>/...?node-id=<1-42>`
 *
 * @throws {FigmaBadRefError} if neither shape matches.
 */
export function parseFigmaRef(ref: string): FigmaRef {
  const trimmed = ref.trim();

  // figma:<fileKey>/<nodeId>
  const manifest = /^figma:([A-Za-z0-9]+)\/([0-9]+[:-][0-9]+)$/.exec(trimmed);
  if (manifest) {
    return { fileKey: manifest[1]!, nodeId: canonicalNodeId(manifest[2]!) };
  }

  // figma.com URL
  if (/^https?:\/\/(www\.)?figma\.com\//.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const parts = url.pathname.split("/").filter(Boolean);
      const kind = parts[0]; // "design" or "file"
      const fileKey = parts[1];
      const node = url.searchParams.get("node-id");
      if ((kind === "design" || kind === "file") && fileKey && node) {
        return { fileKey, nodeId: canonicalNodeId(node) };
      }
    } catch {
      /* fall through to the throw below */
    }
  }

  throw new FigmaBadRefError(ref);
}

/** Whether a `ref` is a Figma handle this adapter can parse without Code Connect. */
export function isFigmaRef(ref: string): boolean {
  try {
    parseFigmaRef(ref);
    return true;
  } catch {
    return false;
  }
}

/** Format a {@link FigmaRef} back into the manifest `figma:<key>/<node>` form. */
export function formatFigmaRef({ fileKey, nodeId }: FigmaRef): string {
  return `figma:${fileKey}/${nodeId}`;
}
