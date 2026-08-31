/**
 * Orchestration: run the full a11y + i18n check suite over a
 * `(DesignReference, CandidateRender)` pair and return ordered findings.
 *
 * Per docs/PRINCIPLES.md Principle 2 the verdict leads with a11y then i18n, so
 * {@link runChecks} returns findings in that order; within each group, errors
 * precede warns precede infos.
 */
import type {
  CandidateRender,
  DesignReference,
  Finding,
} from "@design-parity/core";

import { checkContrast, checkSemantics, checkTouchTargets } from "./a11y.js";
import { parseColor } from "./color.js";
import { type ChecksConfig, resolveConfig } from "./config.js";
import {
  checkHardcodedStrings,
  checkLocaleFormatting,
  checkRtlMirroring,
  checkTextExpansion,
} from "./i18n.js";

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 } as const;

function bySeverity(a: Finding, b: Finding): number {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
}

function contrastFingerprint(finding: Finding): string | undefined {
  if (finding.kind !== "contrast" || finding.severity !== "error") return undefined;
  const { theme, foreground, background, required, largeText } = finding.detail ?? {};
  if (
    typeof theme !== "string" ||
    typeof foreground !== "string" ||
    typeof background !== "string" ||
    typeof required !== "number" ||
    typeof largeText !== "boolean"
  ) {
    return undefined;
  }
  return [
    theme.toLowerCase(),
    colorFingerprint(foreground),
    colorFingerprint(background),
    required,
    largeText,
  ].join("|");
}

function colorFingerprint(value: string): string {
  const color = parseColor(value);
  return color
    ? `${color.r},${color.g},${color.b},${color.a}`
    : value.trim().toLowerCase();
}

function markSharedReferenceContrast(
  reference: DesignReference,
  candidateFindings: Finding[],
  config: ChecksConfig,
): Finding[] {
  if (!reference.layout) return candidateFindings;
  const cfg = resolveConfig(config);
  const referenceFindings = checkContrast(
    {
      componentId: reference.componentId,
      images: reference.referenceImages,
      semantics: reference.layout,
    },
    cfg,
  );
  const shared = new Set(
    referenceFindings
      .map(contrastFingerprint)
      .filter((fingerprint): fingerprint is string => fingerprint !== undefined),
  );
  if (shared.size === 0) return candidateFindings;

  return candidateFindings
    .map((finding) => {
      const fingerprint = contrastFingerprint(finding);
      if (!fingerprint || !shared.has(fingerprint)) return finding;
      return {
        ...finding,
        severity: "warn" as const,
        message: `${finding.message} The design reference has the same contrast failure; track it as shared design debt.`,
        detail: { ...finding.detail, sharedWithReference: true },
      };
    })
    .sort(bySeverity);
}

/** All accessibility findings for a candidate, severity-ordered. */
export function runA11yChecks(
  candidate: CandidateRender,
  config: ChecksConfig = {},
): Finding[] {
  const cfg = resolveConfig(config);
  return [
    ...checkContrast(candidate, cfg),
    ...checkTouchTargets(candidate, cfg),
    ...checkSemantics(candidate, cfg),
  ].sort(bySeverity);
}

/** All internationalization findings for a candidate, severity-ordered. */
export function runI18nChecks(
  candidate: CandidateRender,
  config: ChecksConfig = {},
): Finding[] {
  const cfg = resolveConfig(config);
  return [
    ...checkTextExpansion(candidate, cfg),
    ...checkLocaleFormatting(candidate, cfg),
    ...checkRtlMirroring(candidate, cfg),
    ...checkHardcodedStrings(candidate, cfg),
  ].sort(bySeverity);
}

/**
 * Run every check over the reference/candidate pair. Candidate accessibility
 * defects remain blocking unless the reference semantics demonstrate the exact
 * same contrast pair; shared design debt stays visible as a warning without
 * turning a faithful design-led implementation into a parity failure.
 */
export function runChecks(
  reference: DesignReference,
  candidate: CandidateRender,
  config: ChecksConfig = {},
): Finding[] {
  return [
    ...markSharedReferenceContrast(
      reference,
      runA11yChecks(candidate, config),
      config,
    ),
    ...runI18nChecks(candidate, config),
  ];
}
