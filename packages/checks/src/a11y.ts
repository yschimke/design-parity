/**
 * Accessibility checks over a {@link CandidateRender}: WCAG contrast, touch
 * target size, and semantic role/label presence. Each returns `Finding[]`;
 * pure and deterministic, no network or model.
 */
import type { CandidateRender, Finding } from "@design-parity/core";

import { contrastRatio, parseColor, round2 } from "./color.js";
import { type ResolvedConfig } from "./config.js";
import {
  accessibleName,
  firstTypography,
  isLargeText,
  resolveColorUp,
  themesInTree,
  walk,
} from "./semantics.js";
import { CONTRAST, INTERACTIVE_ROLES, TOUCH_TARGET } from "./thresholds.js";

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const isInteractive = (role: string | undefined): boolean =>
  role !== undefined && (INTERACTIVE_ROLES as readonly string[]).includes(role);
const isText = (role: string | undefined): boolean => role === "text";

/**
 * WCAG 1.4.3 / 1.4.6 text contrast, per theme. Pairs each text node's
 * foreground with the nearest resolvable background and compares the ratio
 * against the AA (and AAA) minimum for its size.
 */
export function checkContrast(
  candidate: CandidateRender,
  cfg: ResolvedConfig,
): Finding[] {
  const root = candidate.semantics.root;
  const themes = cfg.themes ?? themesInTree(root);
  const findings: Finding[] = [];

  for (const entry of walk(root)) {
    const { node } = entry;
    if (!isText(node.role) && !firstTypography(node)) continue;
    const name = accessibleName(node);
    const large = isLargeText(firstTypography(node));
    const aa = large ? CONTRAST.aaLarge : CONTRAST.aaNormal;
    const aaa = large ? CONTRAST.aaaLarge : CONTRAST.aaaNormal;
    const required = cfg.contrastLevel === "AAA" ? aaa : aa;

    for (const theme of themes) {
      const fgHex = resolveColorUp(entry, "fg", theme);
      const bgHex = resolveColorUp(entry, "bg", theme);
      if (!fgHex || !bgHex) continue; // can't assess — don't guess
      const fg = parseColor(fgHex);
      const bg = parseColor(bgHex);
      if (!fg || !bg) continue;

      const ratio = round2(contrastRatio(fg, bg));
      const label = name ? `"${name}"` : `${theme}-theme text`;
      const detail = {
        theme,
        ratio,
        foreground: fgHex,
        background: bgHex,
        required,
        largeText: large,
      };

      if (ratio < required) {
        findings.push({
          kind: "contrast",
          severity: "error",
          message: `${cap(theme)}-theme contrast ${ratio}:1 for ${label} fails WCAG ${cfg.contrastLevel} (needs ${required}:1).`,
          detail,
        });
      } else if (ratio < aaa) {
        findings.push({
          kind: "contrast",
          severity: "info",
          message: `${cap(theme)}-theme contrast ${ratio}:1 for ${label} meets AA but not AAA (needs ${aaa}:1).`,
          detail: { ...detail, required: aaa },
        });
      }
    }
  }
  return findings;
}

/**
 * Touch-target minimum size (Material 3 48dp; WCAG 2.5.8 AA floor 24dp). Below
 * the AA floor is an error; between the floor and the configured minimum warns.
 */
export function checkTouchTargets(
  candidate: CandidateRender,
  cfg: ResolvedConfig,
): Finding[] {
  const findings: Finding[] = [];
  for (const { node } of walk(candidate.semantics.root)) {
    if (!isInteractive(node.role) || !node.bounds) continue;
    const smaller = Math.min(node.bounds.width, node.bounds.height);
    if (smaller >= cfg.minTouchTarget) continue;

    const name = accessibleName(node);
    const subject = name ? `"${name}"` : `${node.role}`;
    const detail = {
      role: node.role,
      width: node.bounds.width,
      height: node.bounds.height,
      minimum: cfg.minTouchTarget,
    };
    findings.push(
      smaller < TOUCH_TARGET.aaFloor
        ? {
            kind: "a11y",
            severity: "error",
            message: `Touch target ${node.bounds.width}×${node.bounds.height}dp for ${subject} is below the WCAG 2.5.8 floor (${TOUCH_TARGET.aaFloor}dp).`,
            detail,
          }
        : {
            kind: "a11y",
            severity: "warn",
            message: `Touch target ${node.bounds.width}×${node.bounds.height}dp for ${subject} is below the ${cfg.minTouchTarget}dp minimum.`,
            detail,
          },
    );
  }
  return findings;
}

/**
 * Semantic presence: interactive and image nodes must expose an accessible
 * name (label / content description). Focus order and state announcements are
 * not modeled by {@link SemanticNode} yet, so they are intentionally not
 * asserted here — adding them is a contract change in `@design-parity/core`.
 */
export function checkSemantics(
  candidate: CandidateRender,
  _cfg: ResolvedConfig,
): Finding[] {
  const findings: Finding[] = [];
  for (const { node } of walk(candidate.semantics.root)) {
    const role = node.role;
    if (role === undefined) continue;
    const named = accessibleName(node) !== undefined;

    if (isInteractive(role) && !named) {
      findings.push({
        kind: "a11y",
        severity: "error",
        message: `Interactive ${role} has no accessible label.`,
        detail: { role, bounds: node.bounds },
      });
    } else if (role === "image" && !named) {
      findings.push({
        kind: "a11y",
        severity: "warn",
        message: `image has no content description; confirm it is decorative.`,
        detail: { role, bounds: node.bounds },
      });
    }
  }
  return findings;
}
