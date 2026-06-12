/**
 * Parsing for a committed Claude Design HTML export.
 *
 * Claude Design is a research preview with **no read API and no Figma export**
 * (see this repo's AGENTS.md and the issue-4 brief). The only machine-readable
 * artifact is an HTML export a human commits into their repo. We own the
 * reverse direction — the `compose-preview-design-board` skill builds the HTML
 * imported *into* Claude Design — so we control its shape: a normal HTML
 * document carrying one embedded handoff manifest:
 *
 * ```html
 * <script type="application/design-parity+json">
 *   { "componentId": "...", "tokens": { ... }, "images": [ ... ] }
 * </script>
 * ```
 *
 * Everything in the manifest is optional. When `images` is absent the adapter
 * rasterizes the document itself; when present, each entry either points at a
 * committed PNG (`src`) or is rendered on demand.
 */
import type { DesignTokens, Theme } from "@design-parity/core";

/** The `<script type="...">` mime the handoff manifest is carried in. */
export const HANDOFF_MIME = "application/design-parity+json";

/** One image variant declared by the export. */
export interface HandoffImage {
  /** Variant state, defaults to `"default"`. */
  state?: string;
  theme?: Theme;
  /** Logical breakpoint label, e.g. `"compact"`, `"medium"`. */
  size?: string;
  /**
   * Path to a pre-rendered PNG, **relative to the HTML file**. When omitted the
   * adapter rasterizes this variant from the document headlessly.
   */
  src?: string;
}

/** The parsed embedded handoff manifest. */
export interface HandoffManifest {
  /** Optional cross-check against the resolver-supplied component id. */
  componentId?: string;
  /**
   * Design tokens, either inline or — when a string — a path to a JSON token
   * file relative to the HTML file (a Claude Design "handoff" token export).
   */
  tokens?: DesignTokens | string;
  images?: HandoffImage[];
}

const HANDOFF_RE = new RegExp(
  `<script\\b[^>]*\\btype\\s*=\\s*["']${HANDOFF_MIME.replace(
    /[.+]/g,
    "\\$&",
  )}["'][^>]*>([\\s\\S]*?)</script>`,
  "i",
);

/**
 * Extract the handoff manifest from an HTML export.
 *
 * @returns the parsed manifest, or `undefined` when the document carries no
 *   handoff block (a raw export the adapter must rasterize wholesale).
 * @throws if a handoff block is present but its body is not valid JSON.
 */
export function parseHandoff(
  html: string,
  label = "<html>",
): HandoffManifest | undefined {
  const match = HANDOFF_RE.exec(html);
  if (!match) return undefined;

  const body = (match[1] ?? "").trim();
  if (body === "") {
    throw new Error(
      `claude-design: '${label}' has an empty ${HANDOFF_MIME} handoff block`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new Error(
      `claude-design: '${label}' handoff block is not valid JSON`,
      { cause },
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `claude-design: '${label}' handoff block must be a JSON object`,
    );
  }
  return parsed as HandoffManifest;
}
