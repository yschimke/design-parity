/**
 * Accessibility + i18n checks — the highest-value signal (Principle 2), so the
 * verdict leads with them.
 *
 * These checks are owned by `@design-parity/checks` (issue #10), which has
 * landed: the {@link defaultChecks} provider delegates straight to its
 * `runChecks`. The {@link ChecksProvider} seam stays so a consumer can inject a
 * stricter config or a future provider without the diff engine changing — but
 * the default is the real package, not a stub.
 */
import { runChecks, type ChecksConfig } from "@design-parity/checks";
import type {
  CandidateRender,
  DesignReference,
  Finding,
} from "@design-parity/core";

/** What an a11y/i18n check provider receives. Source-agnostic by construction. */
export interface ChecksInput {
  reference: DesignReference;
  candidate: CandidateRender;
  /** Committed thresholds/levels passed through to the provider. */
  config: ChecksConfig;
}

/**
 * The a11y + i18n seam. An implementation inspects the candidate (never a live
 * model) and returns deterministic findings. Async is allowed so a heavier
 * provider can read files, but it must not depend on network or a model at run
 * time.
 */
export interface ChecksProvider {
  run(input: ChecksInput): Finding[] | Promise<Finding[]>;
}

/**
 * The default provider: `@design-parity/checks` (#10). Deterministic, offline,
 * and committed — WCAG contrast, touch targets, semantic roles/labels, plus the
 * i18n risks (text expansion, RTL, hardcoded strings).
 */
export const defaultChecks: ChecksProvider = {
  run({ reference, candidate, config }: ChecksInput): Finding[] {
    return runChecks(reference, candidate, config);
  },
};

export type { ChecksConfig };
