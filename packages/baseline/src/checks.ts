/**
 * The starter check config for a bootstrapped repo.
 *
 * This is the committed input `@design-parity/checks` consumes — its
 * {@link ChecksConfig}, not a parallel shape — so bootstrap emits exactly what
 * the steady-state checks read (Principles 1, 2). The defaults are opinionated
 * for a freshly bootstrapped repo: target WCAG AA contrast, and turn on the
 * hardcoded-string lint so i18n drift surfaces from day one.
 */
import type { ChecksConfig } from "@design-parity/checks";

/** The opinionated default {@link ChecksConfig} for a bootstrapped repo. */
export function defaultCheckConfig(): ChecksConfig {
  return {
    contrastLevel: "AA",
    flagHardcodedStrings: true,
  };
}
