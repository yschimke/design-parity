/**
 * Candidate render-path selection (docs/PRINCIPLES.md Principle 6).
 *
 * The candidate side is cheapest to render when the UI is Compose Multiplatform
 * (CMP): the Desktop/JVM target renders a preview with **no Android emulator**,
 * while plain Jetpack Compose drags in the heavier Android stack. So when a
 * module is CMP-capable the bot **prefers** the Desktop/JVM render path; when it
 * is not, it renders on Android **unchanged**. CMP is never required — a non-CMP
 * project just renders on Android, and the preference is advisory, never a gate.
 *
 * This module is the deterministic half of that choice on the candidate side: it
 * maps a committed CMP-capability verdict (the one `@design-parity/baseline`
 * detects at bootstrap and writes into `.design-parity.json`, read back at run
 * time per Principle 1 — no re-scan) to a {@link RenderPath}, and shapes the
 * upstream {@link RenderRequest} for that path. It does **not** reimplement
 * rendering or change the `CandidateRender` contract: both paths normalize to the
 * same contract, so `diff` stays source-agnostic.
 */
import type { RenderRequest } from "./cli.js";

/**
 * Which `compose-preview` render path a candidate render drives.
 *
 * - `"desktop"` — the Compose Multiplatform Desktop/JVM render. No Android
 *   emulator or device; faster, more portable, easy to run unattended. Preferred
 *   when the module is CMP-capable.
 * - `"android"` — the Android Jetpack Compose render (the heavier path). The
 *   universal fallback; always supported, never gated.
 */
export type RenderPath = "desktop" | "android";

/**
 * The minimal CMP-capability input the choice needs — the committed verdict
 * `@design-parity/baseline` writes (`ParityConfig.cmpCapable`), read back at run
 * time. Kept structural (not a dependency on `@design-parity/baseline`) so the
 * candidate package stays decoupled from bootstrap.
 */
export interface RenderPathCapability {
  /** True when the module/project is Compose-Multiplatform-capable. */
  cmpCapable: boolean;
}

/** A chosen {@link RenderPath} plus the rationale behind it (for diagnostics). */
export interface RenderPathChoice {
  path: RenderPath;
  /** Human-readable reason, for logs and an auditable "why this path" trail. */
  reason: string;
}

/**
 * Choose the candidate render path from the committed CMP-capability verdict
 * (Principle 6): prefer the emulator-free Desktop/JVM render when the module is
 * CMP-capable, else render on Android unchanged. Deterministic, no I/O, never a
 * gate — a non-CMP project simply resolves to `"android"`.
 */
export function chooseRenderPath(cap: RenderPathCapability): RenderPathChoice {
  return cap.cmpCapable
    ? {
        path: "desktop",
        reason:
          "module is Compose-Multiplatform-capable — preferring the emulator-free Desktop/JVM render (Principle 6)",
      }
    : {
        path: "android",
        reason:
          "no Compose Multiplatform signal — rendering on Android Jetpack Compose (the supported fallback)",
      };
}

/**
 * Shape a {@link RenderRequest} for the chosen path.
 *
 * The Android build `variant` is an Android-only concept — there are no Android
 * build variants on the Desktop/JVM render — so it is dropped on the `"desktop"`
 * path (carrying it would only pull the build toward the Android path). The
 * `"android"` path is returned unchanged, so Android-only modules render exactly
 * as before. Pure; never mutates its input.
 */
export function applyRenderPath<T extends RenderRequest>(
  path: RenderPath,
  req: T,
): T {
  if (path === "android" || req.variant === undefined) return req;
  // Desktop/JVM: strip the Android-only `variant` (copy, never mutate input).
  const next = { ...req };
  delete next.variant;
  return next;
}
