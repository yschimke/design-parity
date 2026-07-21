/**
 * Load per-component spec tokens declared via a `design-map.json` entry's
 * `tokensFile` — a committed W3C DTCG document (issue #89). This is how a
 * component whose source doesn't expose tokens (bundle, claude-design), or whose
 * author wants to pin a spec, declares the tokens its render is checked against.
 *
 * Eager and deterministic (Principle 1): every referenced file is read once up
 * front, de-duped by path, so an unreadable or invalid token file surfaces as a
 * run warning instead of silently dropping a component's spec. The loaded tokens
 * are matched against the candidate by the Material-role heuristic (issue #87)
 * and the alias map (issue #78), same as any reference tokens.
 */
import { join } from "node:path";

import {
  loadDtcgTokens,
  type DesignMap,
  type DesignSource,
  type DesignTokens,
} from "@design-parity/core";

/**
 * Composite lookup key for the spec-token map. One code can bind several design
 * sources (issue #106), and each entry declares its own `tokensFile`, so the
 * spec tokens are keyed by `(code, source)` — not code alone — to keep a second
 * same-code entry from overwriting the first.
 */
export function specTokenKey(code: string, source: DesignSource): string {
  return `${code} ${source}`;
}

export interface SpecTokens {
  /**
   * `(code, source)` → the DTCG-declared spec tokens for that component, keyed
   * via {@link specTokenKey}.
   */
  byCode: Map<string, DesignTokens>;
  /** Unreadable/invalid token files and per-token DTCG read warnings. */
  warnings: string[];
}

/**
 * Resolve every `design-map` entry's `tokensFile` into a code → {@link DesignTokens}
 * map. A missing `designMap`, or no entry declaring a `tokensFile`, yields an
 * empty map and no warnings.
 */
export async function loadSpecTokens(
  designMap: DesignMap | undefined,
  repoRoot: string,
): Promise<SpecTokens> {
  const byCode = new Map<string, DesignTokens>();
  const warnings: string[] = [];
  if (!designMap) return { byCode, warnings };

  // De-dupe by path so a token file shared across components is read once;
  // `null` records a failed read so we don't retry (or re-warn) it.
  const cache = new Map<string, DesignTokens | null>();
  for (const entry of designMap.components) {
    if (entry.tokensFile === undefined) continue;
    let tokens = cache.get(entry.tokensFile);
    if (tokens === undefined) {
      try {
        const result = await loadDtcgTokens(join(repoRoot, entry.tokensFile));
        tokens = result.tokens;
        for (const w of result.warnings) warnings.push(`${entry.tokensFile}: ${w}`);
      } catch (err) {
        tokens = null;
        warnings.push((err as Error).message);
      }
      cache.set(entry.tokensFile, tokens);
    }
    if (tokens) byCode.set(specTokenKey(entry.code, entry.source), tokens);
  }
  return { byCode, warnings };
}
