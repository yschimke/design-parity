/**
 * Internationalization checks over a {@link CandidateRender}: pseudolocale text
 * expansion / truncation risk, hardcoded locale-specific formatting, RTL
 * mirroring expectations, and (opt-in) un-keyed strings. Pure and
 * deterministic — no network, no model, no live locale data.
 */
import type { CandidateRender, Finding } from "@design-parity/core";

import { type ResolvedConfig } from "./config.js";
import { accessibleName, firstTypography, walk } from "./semantics.js";
import {
  expansionFactor,
  LOCALE_FORMAT_PATTERNS,
  RTL_DIRECTIONAL_HINT,
  STRONG_RTL_CHARS,
} from "./thresholds.js";

const DEFAULT_FONT_SIZE = 14;

/** Estimate rendered text width (dp) without a font engine. Approximate. */
export function estimateWidth(
  text: string,
  fontSize: number,
  glyphAdvance: number,
): number {
  return text.length * fontSize * glyphAdvance;
}

/**
 * Pseudolocale text-expansion / truncation risk. Estimates how wide a label
 * grows under localization and flags nodes whose expanded text would overflow
 * the width they are allotted. `warn` (risk), never `error`: width estimation
 * is heuristic.
 */
export function checkTextExpansion(
  candidate: CandidateRender,
  cfg: ResolvedConfig,
): Finding[] {
  const findings: Finding[] = [];
  for (const { node } of walk(candidate.semantics.root)) {
    const name = accessibleName(node);
    const available = node.bounds?.width;
    if (!name || available === undefined) continue;
    if (node.role !== "text" && !firstTypography(node)) continue;

    const fontSize = firstTypography(node)?.fontSize ?? DEFAULT_FONT_SIZE;
    const base = estimateWidth(name, fontSize, cfg.glyphAdvance);
    const factor = expansionFactor(name.length);
    const expanded = Math.round(base * factor);
    if (expanded <= available) continue;

    findings.push({
      kind: "i18n",
      severity: "warn",
      message: `"${name}" risks truncation when localized: ≈${expanded}dp expanded vs ${available}dp available.`,
      detail: {
        label: name,
        availableWidth: available,
        estimatedWidth: Math.round(base),
        expansionFactor: factor,
        estimatedExpandedWidth: expanded,
      },
    });
  }
  return findings;
}

/**
 * Hardcoded locale-specific value formatting embedded in a label (currency,
 * dates, grouped numbers). These should run through a locale-aware formatter.
 */
export function checkLocaleFormatting(
  candidate: CandidateRender,
  _cfg: ResolvedConfig,
): Finding[] {
  const findings: Finding[] = [];
  for (const { node } of walk(candidate.semantics.root)) {
    const name = accessibleName(node);
    if (!name) continue;
    for (const { id, re } of LOCALE_FORMAT_PATTERNS) {
      if (!re.test(name)) continue;
      findings.push({
        kind: "i18n",
        severity: "warn",
        message: `"${name}" hardcodes locale-specific ${id} formatting; use a locale-aware formatter.`,
        detail: { label: name, format: id },
      });
      break; // one finding per node is enough
    }
  }
  return findings;
}

/**
 * RTL mirroring expectations. Directional iconography must mirror under RTL;
 * strong-RTL text confirms the layout has to flip. Only icon/image nodes are
 * considered for directional hints to keep false positives low.
 */
export function checkRtlMirroring(
  candidate: CandidateRender,
  _cfg: ResolvedConfig,
): Finding[] {
  const findings: Finding[] = [];
  for (const { node } of walk(candidate.semantics.root)) {
    const name = accessibleName(node) ?? "";
    const iconish = node.role === "icon" || node.role === "image";

    if (iconish && RTL_DIRECTIONAL_HINT.test(name)) {
      findings.push({
        kind: "i18n",
        severity: "warn",
        message: `Directional ${node.role} "${name}" must mirror under RTL; confirm auto-mirroring is enabled.`,
        detail: { role: node.role, label: name },
      });
    } else if (STRONG_RTL_CHARS.test(name)) {
      findings.push({
        kind: "i18n",
        severity: "info",
        message: `"${name}" contains right-to-left text; confirm the layout direction follows the locale.`,
        detail: { label: name },
      });
    }
  }
  return findings;
}

/**
 * Un-keyed user-facing strings. A render can't prove a string came from a
 * resource bundle, so this is **opt-in** ({@link ResolvedConfig.flagHardcodedStrings})
 * and advisory — it flags every natural-language label for author review.
 */
export function checkHardcodedStrings(
  candidate: CandidateRender,
  cfg: ResolvedConfig,
): Finding[] {
  if (!cfg.flagHardcodedStrings) return [];
  const findings: Finding[] = [];
  for (const { node } of walk(candidate.semantics.root)) {
    const name = accessibleName(node);
    if (!name || !/\p{L}/u.test(name)) continue;
    if (node.role !== "text" && !firstTypography(node)) continue;
    findings.push({
      kind: "i18n",
      severity: "info",
      message: `"${name}" is a literal string; confirm it resolves from an i18n resource, not a hardcoded value.`,
      detail: { label: name },
    });
  }
  return findings;
}
