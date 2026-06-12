/**
 * Error types for the candidate renderer wrapper.
 *
 * The candidate side is owned by the upstream `compose-preview` CLI, so the
 * failure modes that matter are environmental: the CLI is missing, it found no
 * previews, or the build/render itself failed. Each is a distinct class so a
 * caller (or the Action) can branch and surface an actionable message.
 */

/** Base class so callers can `instanceof CandidateError` to branch. */
export class CandidateError extends Error {
  override name = "CandidateError";
}

/** The `compose-preview` CLI is not installed / not on `PATH`. */
export class MissingComposePreviewError extends CandidateError {
  override name = "MissingComposePreviewError";
  constructor(cliPath: string, cause?: unknown) {
    super(
      `compose-preview CLI not found (tried '${cliPath}').\n` +
        `The candidate side renders via the upstream compose-preview CLI — it is not\n` +
        `reimplemented here. To fix:\n` +
        `  1. Install it (bootstrap installer): https://github.com/yschimke/compose-ai-tools\n` +
        `  2. Ensure 'compose-preview' is on PATH, or pass { cliPath } at the binary.\n` +
        `  3. Verify with: compose-preview --version`,
      { cause },
    );
  }
}

/** The CLI ran but found no previews to render (CLI exit code 3). */
export class NoPreviewsError extends CandidateError {
  override name = "NoPreviewsError";
  constructor(detail?: { module?: string; filter?: string; id?: string }) {
    const where = detail
      ? [
          detail.module ? `module='${detail.module}'` : undefined,
          detail.id ? `id='${detail.id}'` : undefined,
          detail.filter ? `filter='${detail.filter}'` : undefined,
        ]
          .filter(Boolean)
          .join(", ")
      : "";
    super(
      `compose-preview found no @Preview functions to render` +
        (where ? ` for ${where}` : "") +
        `. Check the module has the compose-preview Gradle plugin applied and that` +
        ` the filter/id matches a preview id (compose-preview list).`,
    );
  }
}

/** The CLI failed to build or render (CLI exit codes 1/2, or bad output). */
export class RenderError extends CandidateError {
  override name = "RenderError";
  /** CLI exit code, when the failure came from a completed process. */
  readonly code?: number;
  constructor(message: string, detail: { code?: number; stderr?: string } = {}) {
    const tail = detail.stderr?.trim();
    super(tail ? `${message}\n${tail}` : message);
    this.code = detail.code;
  }
}
