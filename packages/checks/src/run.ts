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
 * Run every check over the reference/candidate pair. The reference is accepted
 * for parity with the issue's `(DesignReference, CandidateRender)` contract and
 * reserved for reference-aware checks; today's checks evaluate the candidate's
 * own rendered semantics, which is what the WCAG/i18n specs are defined over.
 */
export function runChecks(
  _reference: DesignReference,
  candidate: CandidateRender,
  config: ChecksConfig = {},
): Finding[] {
  return [...runA11yChecks(candidate, config), ...runI18nChecks(candidate, config)];
}
