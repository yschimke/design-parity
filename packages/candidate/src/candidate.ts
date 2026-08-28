/**
 * Assemble a {@link CandidateRender} from rendered previews.
 *
 * {@link toCandidateRender} is a pure mapper over {@link RenderedPreview}s (no
 * I/O), so it is trivially unit-testable; {@link renderCandidate} is the
 * convenience that drives the real CLI end to end.
 */
import { relative, sep } from "node:path";

import type { CandidateRender, Image, SemanticTree } from "@design-parity/core";

import type { CommandRunner } from "./exec.js";
import {
  SpawnComposePreviewCli,
  sizeFromParams,
  stateFromParams,
  gutterFor,
  themeForPreview,
  type ComposePreviewCli,
  type RenderRequest,
  type RenderedPreview,
} from "./cli.js";
import { NoPreviewsError } from "./errors.js";

export interface ToCandidateOptions {
  /**
   * Root the image `uri`s are made relative to (the convention is repo-relative
   * paths). When omitted, the CLI's absolute `pngPath` is kept as-is.
   */
  repoRoot?: string;
}

/** Pure mapping: rendered previews → a {@link CandidateRender}. */
export function toCandidateRender(
  componentId: string,
  previews: RenderedPreview[],
  opts: ToCandidateOptions = {},
): CandidateRender {
  if (previews.length === 0) throw new NoPreviewsError();
  const images = previews.map((p) => toImage(p, opts.repoRoot));
  return { componentId, images, semantics: pickSemantics(previews) };
}

function toImage(p: RenderedPreview, repoRoot: string | undefined): Image {
  const { params } = p.entry;
  const image: Image = {
    state: stateFromParams(params),
    uri: toUri(p.entry.pngPath, repoRoot),
    width: p.pngWidth,
    height: p.pngHeight,
  };
  const theme = themeForPreview(params, p.entry.id);
  if (theme) image.theme = theme;
  const size = sizeFromParams(params);
  if (size) image.size = size;
  // A live render declares its gutter the same way a bundled one does; without
  // this the CLI path kept the false gutter-induced score the bundle path had
  // just been fixed for.
  const gutter = gutterFor(params);
  if (gutter) image.gutter = gutter;
  if (p.semantics) image.semantics = p.semantics;
  return image;
}

function toUri(pngPath: string, repoRoot: string | undefined): string {
  if (!repoRoot) return pngPath;
  return relative(repoRoot, pngPath).split(sep).join("/");
}

/**
 * Pick the semantics tree for the candidate. Prefer the light-theme capture
 * (the diff engine keys tokens off a single tree); fall back to the first
 * available, and to an empty tree when the renderer emitted none.
 */
function pickSemantics(previews: RenderedPreview[]): SemanticTree {
  const withSemantics = previews.filter((p) => p.semantics);
  const light = withSemantics.find((p) => p.semantics?.theme === "light");
  const chosen = (light ?? withSemantics[0])?.semantics;
  return chosen ?? { root: {} };
}

export interface RenderCandidateOptions extends RenderRequest {
  /** Code handle for the produced {@link CandidateRender}. */
  componentId: string;
  /** Gradle project root (the consumer repo / sample module). */
  projectDir: string;
  /** Binary to invoke; default `"compose-preview"`. */
  cliPath?: string;
  /** Process runner; default spawns the real binary. */
  runner?: CommandRunner;
  /** Root the image `uri`s are relative to; defaults to `projectDir`. */
  repoRoot?: string;
  /** Inject a pre-built driver (e.g. a fake in tests); overrides the above. */
  cli?: ComposePreviewCli;
}

/**
 * Render the changed component via the upstream `compose-preview` CLI and
 * normalize the result into a {@link CandidateRender}.
 *
 * @throws MissingComposePreviewError if the CLI is not installed.
 * @throws NoPreviewsError if nothing matched.
 * @throws RenderError if the build/render failed.
 */
export async function renderCandidate(
  options: RenderCandidateOptions,
): Promise<CandidateRender> {
  const { componentId, projectDir, cliPath, runner, repoRoot, cli, ...req } =
    options;
  const driver =
    cli ?? new SpawnComposePreviewCli({ projectDir, cliPath, runner });
  const previews = await driver.render(req);
  return toCandidateRender(componentId, previews, {
    repoRoot: repoRoot ?? projectDir,
  });
}
