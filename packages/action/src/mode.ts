/**
 * Decide what the Action does for the triggering event, mirroring the sibling
 * `compose-ai-tools` `apply` selector (issue #56):
 *
 * - **`comment`** — a `pull_request`: render the changed components, run the
 *   pipeline, and post/update the single verdict comment (today's behavior).
 * - **`baseline`** — a `push` to the long-lived `development-branch`: render the
 *   full mapped surface and publish the browsable artifacts (per-component
 *   `report.html` triptychs + a machine-readable `verdict.json`) to a permanent
 *   artifact branch, force-updated each run. This is the always-current parity
 *   state of the dev branch and the baseline a PR can diff against.
 * - **`skip`** — nothing applies (e.g. a push to a non-dev branch).
 *
 * Pure: no env reads, no I/O — the entrypoint feeds it the resolved inputs.
 */
export type ActionMode = "baseline" | "comment" | "skip";

export interface ModeInputs {
  /** `GITHUB_EVENT_NAME` (e.g. `pull_request`, `push`, `workflow_dispatch`). */
  eventName?: string;
  /** `GITHUB_REF_NAME` — the short branch/tag name of the triggering ref. */
  refName?: string;
  /** The long-lived branch whose pushes flip the Action into baseline mode. */
  developmentBranch: string;
  /** `INPUT_MODE` override: `auto` (default), `baseline`, `comment`, or `skip`. */
  override?: string;
  /** A resolved PR number, used only as the `auto` fallback for odd events. */
  prNumber?: number;
}

const EXPLICIT: ReadonlySet<string> = new Set(["baseline", "comment", "skip"]);

/**
 * Map the event (or an explicit `mode` override) to the Action mode. A
 * `workflow_dispatch` sitting on the development branch behaves like a push
 * (manual baseline refresh); elsewhere it falls back to comment mode.
 */
export function selectMode(inputs: ModeInputs): ActionMode {
  const override = (inputs.override ?? "auto").trim();
  if (EXPLICIT.has(override)) return override as ActionMode;

  const onDevBranch = inputs.refName === inputs.developmentBranch;
  switch (inputs.eventName) {
    case "pull_request":
    case "pull_request_target":
      return "comment";
    case "push":
      return onDevBranch ? "baseline" : "skip";
    case "workflow_dispatch":
      return onDevBranch ? "baseline" : "comment";
    default:
      // Unknown event: comment if a PR is in context, otherwise nothing to do.
      return inputs.prNumber ? "comment" : "skip";
  }
}
