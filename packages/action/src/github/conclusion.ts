/**
 * Map a {@link ParityReport} to a GitHub check conclusion and a process exit
 * code. Blocking is owned by the parity direction (`design-led` blocks; `code-led`
 * is advisory) — the surface only translates it.
 */
import type { ParityReport } from "../orchestrate.js";

export type CheckConclusion = "success" | "failure" | "neutral";

/**
 * - `blocked` (design-led + a failure) → `failure` (red check, exit 1).
 * - any other failure/warn (advisory) → `neutral` (visible, non-blocking).
 * - clean pass → `success`.
 */
export function checkConclusion(report: ParityReport): CheckConclusion {
  if (report.blocked) return "failure";
  if (report.status === "pass") return "success";
  return "neutral";
}

/** Exit code for the Action step: non-zero only when blocking. */
export function exitCode(report: ParityReport): number {
  return report.blocked ? 1 : 0;
}
