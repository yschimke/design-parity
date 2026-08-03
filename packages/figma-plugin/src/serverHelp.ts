/**
 * Turn a failed **Override editor** load into an *educational* message.
 *
 * The Override editor's live customization + arbitrary-size rendering need a
 * running `compose-preview serve` host — but a raw "Failed to fetch" teaches a
 * designer nothing. Given the outcome of a load attempt (unreachable host, an
 * HTTP error, a non-serve host, or an empty system), {@link diagnoseServerLoad}
 * produces a title + one-line detail + concrete **steps** (how to start a host,
 * what still works offline). The UI renders it; this stays pure and testable.
 *
 * Pure: no `figma`, no `fetch`, no DOM.
 */

/** Why a load failed. */
export type ServerIssue = "unreachable" | "http-error" | "not-serve-host" | "no-previews";

/** The rendered help for a failed load: a heading, a detail line, and fix-it steps. */
export interface ServerHelp {
  issue: ServerIssue;
  title: string;
  detail: string;
  /** Ordered, plain-text remediation steps (commands shown inline). */
  steps: string[];
}

/** What a load attempt produced — exactly one failure field is set. */
export interface ServerLoadOutcome {
  serverBase: string;
  system: string;
  /** `fetch` itself rejected (host down / connection refused / domain not allowed). */
  networkError?: string;
  /** The host responded, but not OK. */
  httpStatus?: number;
  /** The response parsed but wasn't a `compose-preview-serve/v2` previews payload. */
  badSchema?: boolean;
  /** The response was a valid payload but carried zero previews. */
  emptyPreviews?: boolean;
}

/** How to start a serve host, tailored to the system being loaded. */
function startSteps(system: string): string[] {
  return [
    `Start a host: compose-preview serve --catalogs ${system || "<system>"}`,
    "It listens on http://localhost:8723 by default — enter that as the Preview server.",
    "For a localhost host, add http://localhost:* to the plugin manifest's networkAccess.devAllowedDomains (dev builds only).",
    "No server needed to browse: Add components inserts published renders offline — a server is only for Customize live and arbitrary-size rendering.",
  ];
}

/**
 * Diagnose a failed Override-editor load into an educational {@link ServerHelp}.
 * The failure field set on `outcome` selects the message; `unreachable` is the
 * default when none is set (a bare fetch rejection).
 */
export function diagnoseServerLoad(outcome: ServerLoadOutcome): ServerHelp {
  const { serverBase, system } = outcome;
  const base = serverBase || "the preview server";

  if (outcome.httpStatus !== undefined) {
    return {
      issue: "http-error",
      title: `Server responded ${outcome.httpStatus}`,
      detail: `Reached ${base} but it returned ${outcome.httpStatus} for system “${system}”. The host is up, but that system or path isn't served.`,
      steps: [
        `Check the system id matches one the host serves (its --catalogs), e.g. compose-preview serve --catalogs ${system || "<system>"}.`,
        "Confirm the Preview server URL has no trailing path — just the host, e.g. http://localhost:8723.",
      ],
    };
  }

  if (outcome.badSchema) {
    return {
      issue: "not-serve-host",
      title: "That host isn't a compose-preview serve host",
      detail: `Reached ${base}, but the response isn't a compose-preview-serve/v2 previews payload.`,
      steps: [
        "Point at a compose-preview serve host (it advertises serveSchema: compose-preview-serve/v2).",
        ...startSteps(system),
      ],
    };
  }

  if (outcome.emptyPreviews) {
    return {
      issue: "no-previews",
      title: `No previews for “${system}”`,
      detail: `${base} is up but serves no previews for that system.`,
      steps: [
        `Check the system id — it must match a served catalog (${system || "<system>"}).`,
        `Serve it: compose-preview serve --catalogs ${system || "<system>"}.`,
      ],
    };
  }

  // Default: fetch rejected → the host is unreachable.
  return {
    issue: "unreachable",
    title: "No compose-preview server reachable",
    detail: `Couldn't reach ${base}. Live customization + arbitrary-size rendering need a running compose-preview serve host.`,
    steps: startSteps(system),
  };
}
