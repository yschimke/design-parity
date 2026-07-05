/**
 * Resolve the **parity direction** — who owns the source of truth — into the
 * two modes the importer acts on.
 *
 * A consumer repo declares its direction in `.design-parity.json`
 * (`"code-led" | "design-led" | "auto"`, the `@design-parity/policy` concept).
 * The plugin can't read that file or run the policy resolver from inside Figma,
 * so it receives whatever the caller resolved (or `"auto"` / nothing) and maps it
 * here. The rule is deliberately asymmetric and safe: **only an explicit
 * `code-led` lets the importer own the file**; everything else — `design-led`,
 * an unresolved `auto`, an unknown string, or nothing — is treated as
 * **design-led**, so an uncertain direction never clobbers a designer.
 */
export type ParityDirection = "code-led" | "design-led";

/** The page a design-led import writes its (reference-only) renders onto. */
export const REFERENCE_PAGE = "Code renders (reference)";

export function resolveDirection(raw: string | null | undefined): ParityDirection {
  return raw === "code-led" ? "code-led" : "design-led";
}
