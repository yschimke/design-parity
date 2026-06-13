/**
 * Code-to-Canvas push-back (issue #9) — the `code-led`, Figma-only stretch.
 *
 * After a parity run, optionally push each candidate render back into the
 * design tool so the design file reflects what shipped. This is **gated** three
 * ways (docs/PRINCIPLES.md, Principle 5):
 *
 *   1. an explicit opt-in flag, **and**
 *   2. the resolved direction is `code-led` (in `design-led` the design stays
 *      canonical and code is never pushed back), **and**
 *   3. the component's `source` is `figma`.
 *
 * Anything short of all three is a **no-op with a clear log line**. The actual
 * write goes through an injected {@link CanvasWriter}; with no writer configured
 * the run also no-ops (the Figma REST API is read-only, so a real writer needs a
 * companion plugin / Dev Mode bridge). This module is otherwise pure: it makes
 * no network or model calls itself.
 */
import type {
  AdapterContext,
  CanvasTarget,
  CanvasWriteResult,
  CanvasWriter,
  ResolvedDirection,
} from "@design-parity/core";

import type { ComponentResult, ParityReport } from "./orchestrate.js";

/** Whether a run, as a whole, is eligible to push candidates back. */
export interface PushBackGate {
  eligible: boolean;
  /** A clear, human-readable reason when not eligible (the no-op log line). */
  reason?: string;
}

/**
 * The overall gate: push-back runs only when explicitly opted in **and** the
 * direction is `code-led`. Pure and deterministic — the per-component
 * `source === "figma"` check happens during {@link pushBack}.
 */
export function decidePushBack(input: {
  enabled: boolean;
  direction: ResolvedDirection;
}): PushBackGate {
  if (!input.enabled) {
    return {
      eligible: false,
      reason: "Code-to-Canvas push-back is off (opt-in flag not set).",
    };
  }
  if (input.direction !== "code-led") {
    return {
      eligible: false,
      reason: `Code-to-Canvas push-back skipped: direction is '${input.direction}', not 'code-led' (design stays canonical).`,
    };
  }
  return { eligible: true };
}

/** A short, stable key for one candidate image (state/theme/size). */
function imageKey(target: CanvasTarget): string {
  const { state, theme, size } = target.image;
  return `${state}/${theme ?? "-"}/${size ?? "-"}`;
}

/**
 * The candidate images to push back for one component, or `[]` with the reason
 * it was skipped. A component is eligible only when it diffed cleanly against a
 * matching-source reference and carries a candidate render.
 */
function targetsFor(
  result: ComponentResult,
  source: CanvasWriter["source"],
): { targets: CanvasTarget[]; reason?: string } {
  if (result.source !== source) {
    return {
      targets: [],
      reason: `source is '${result.source ?? "unknown"}', not '${source}' — nothing to push back`,
    };
  }
  if (result.status !== "ok") {
    return { targets: [], reason: `component was ${result.status}, no candidate to push back` };
  }
  const ref = result.reference?.ref;
  if (!ref) {
    return { targets: [], reason: "no resolved design reference to write to" };
  }
  const images = result.candidate?.images ?? [];
  if (images.length === 0) {
    return { targets: [], reason: "no candidate render to push back" };
  }
  const targets = images.map<CanvasTarget>((image) => ({
    componentId: result.code,
    source,
    ref,
    image,
  }));
  return { targets };
}

export interface PushedImage {
  /** `state/theme/size` key of the pushed image. */
  key: string;
  result: CanvasWriteResult;
}

export interface PushBackComponent {
  code: string;
  pushed: PushedImage[];
}

export interface PushBackSkip {
  code: string;
  reason: string;
}

export interface PushBackError {
  code: string;
  message: string;
}

/** The outcome of a push-back pass over a {@link ParityReport}. */
export interface PushBackReport {
  /** True only when the gate let the run write at all (flag on, `code-led`, a writer). */
  attempted: boolean;
  /** Why the run did not attempt any write (the overall no-op log line). */
  reason?: string;
  pushed: PushBackComponent[];
  skipped: PushBackSkip[];
  /** Per-component write failures (fail-soft: never thrown). */
  errors: PushBackError[];
}

export interface PushBackOptions {
  report: ParityReport;
  /** The explicit opt-in flag — push-back only runs when this is `true`. */
  enabled: boolean;
  /** Writer for the design tool; absent means no-op (no transport configured). */
  writer?: CanvasWriter;
  /** Context the writer resolves image paths / credentials against. */
  ctx: AdapterContext;
  /** Sink for the clear log lines the acceptance criteria call for. */
  log?: (message: string) => void;
}

/**
 * Run Code-to-Canvas push-back for a completed parity report. Honors the
 * three-way gate, fails soft per component, and emits a clear log line in every
 * branch (no-op or not). Never throws.
 */
export async function pushBack(opts: PushBackOptions): Promise<PushBackReport> {
  const log = opts.log ?? (() => {});

  const gate = decidePushBack({
    enabled: opts.enabled,
    direction: opts.report.direction,
  });
  if (!gate.eligible) {
    log(`design-parity: ${gate.reason}`);
    return { attempted: false, reason: gate.reason, pushed: [], skipped: [], errors: [] };
  }

  if (!opts.writer) {
    const reason =
      "Code-to-Canvas push-back is enabled (code-led), but no canvas writer is " +
      "configured — set up a Figma bridge endpoint to push candidates back.";
    log(`design-parity: ${reason}`);
    return { attempted: false, reason, pushed: [], skipped: [], errors: [] };
  }

  const writer = opts.writer;
  const pushed: PushBackComponent[] = [];
  const skipped: PushBackSkip[] = [];
  const errors: PushBackError[] = [];

  for (const result of opts.report.results) {
    const { targets, reason } = targetsFor(result, writer.source);
    if (targets.length === 0) {
      skipped.push({ code: result.code, reason: reason ?? "not eligible" });
      continue;
    }

    const images: PushedImage[] = [];
    for (const target of targets) {
      try {
        const written = await writer.write(target, opts.ctx);
        images.push({ key: imageKey(target), result: written });
      } catch (err) {
        // Fail soft: one bad write must not abort the rest or throw.
        errors.push({ code: result.code, message: (err as Error).message });
      }
    }
    if (images.length > 0) pushed.push({ code: result.code, pushed: images });
  }

  log(
    `design-parity: Code-to-Canvas pushed ${pushed.length} component(s) back to ` +
      `'${writer.source}' (${skipped.length} skipped, ${errors.length} error(s)).`,
  );
  return { attempted: true, pushed, skipped, errors };
}
