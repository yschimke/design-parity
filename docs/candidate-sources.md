# Candidate sources

The **candidate** side of parity — the PR's code, rendered — is a pluggable
strategy, not one fixed render path. `@design-parity/candidate` defines a single
seam and four backends. A run picks one (or composes several) without the diff
engine or the Action knowing which produced the `CandidateRender`.

```ts
interface CandidateSource {
  readonly kind: string;
  getCandidate(
    componentId: string,
    ctx: AdapterContext,
  ): Promise<CandidateRender | undefined>;
}
```

`getCandidate` returns `undefined` when *this* source has no candidate for the
component — a normal outcome, not an error. `firstAvailable([...])` combines
sources in preference order (cheap/static first, expensive/live later) and
returns the first non-`undefined`; a source that *throws* is a hard failure and
is **not** swallowed.

## The four strategies

| Source | `kind` | Phase | Cost | Needs | Produces semantics? |
| --- | --- | --- | --- | --- | --- |
| `bundleCandidateSource` | `bundle` | **1 — shipped** | cheapest | nothing (pure JS) | yes (from the bundle blob) |
| `cliRenderSource` | `cli` | shipped (wrap) | high | JVM/Android + `compose-preview` CLI | yes (CLI data product) |
| `localComposeWebSource` | `local-compose-web` | **stub** | low | a CMP/wasm render entrypoint | (future) |
| `daemonSource` | `daemon` | **stub** | low per render, warm | a running compose-preview daemon/session API | (future) |

### 1. `bundleCandidateSource` — static preview-bundle reader (Phase 1 of #38)

Reads compose-ai-tools **portable preview bundles**: a PNG+zip **polyglot** —
the leading bytes are a cover PNG with the bundle **zip appended**. The reader
locates the appended zip via the End-Of-Central-Directory record and unzips it
in pure JS (`fflate`) — **no JVM, no live render**. The project's own
compose-ai-tools CI already produces these, so design-parity consumes them
directly instead of shelling out to a second render.

Zip layout consumed:

- `bundle.json` — `{ schemaVersion, previewIds, coverPreviewId, classpath[] }`.
- `previews.json` — `{ schema, module, variant, previews: [{ id, functionName,
  className, sourceFile, params, captures[] }] }`. The preview `id`
  (`<fqClass>.<function>[_<variant>]`) maps to `componentId`; `params`
  (`uiMode`, `widthDp`, …) map to `theme` (via `themeFromUiMode`) and `size`
  (via `normalizeSize`).
- `previews/<id>.png` — the rendered image. Emitted as a
  `data:image/png;base64,…` URI (bundle PNGs are not on disk); dimensions are
  read from the PNG IHDR.
- **`previews/<id>.semantics.json`** — the per-preview/capture a11y + semantics
  blob, per the [#38 contract](https://github.com/yschimke/design-parity/issues/38).
  This is the location design-parity chose and documents. A capture entry may
  override it with an explicit `semantics` path. The blob is a `SemanticTree`-
  shaped payload (`role`/`label`/`bounds` + `tokens.colors`/`typography`),
  theme-tagged, mapped through `normalizeSemantics` into the core `SemanticTree`.

Because the semantics travel **in the bundle**, the full a11y/i18n + contrast +
token checks run with no JVM re-render — the original issue's "Phase 2" is no
longer required. A bundle that omits the semantics blob degrades gracefully to
visual/structural-only (the checks tolerate missing fields).

**When to use:** the project already runs compose-ai-tools and emits bundles in
CI. The default, cheapest, fully-offline path.

### 2. `cliRenderSource` — wrap the `compose-preview` CLI

Adapts the existing `renderCandidate` (which shells out to the published
`compose-preview` CLI) to the same seam. Rendering is **not** reimplemented
here. `optionsFor(componentId)` maps a component to its render request
(module/filter/id); return `undefined` to decline a component.

**When to use:** no pre-generated bundles, but the JVM/Android toolchain (or the
CLI) is available in the step to render on demand.

### 3. `localComposeWebSource` — local in-process render *(stub)*

Would render a Compose Multiplatform component **in-process** via Compose for
Web / wasm in a headless JS runtime — no JVM, no Android emulator. This is the
cheapest *live* path for CMP projects (docs/PRINCIPLES.md, Principle 6) and
opens the door to rendering candidates in a JS playground. **Not implemented**:
needs the wasm render entrypoint. Throws `NotImplementedError`.

### 4. `daemonSource` — compose-preview daemon/session *(stub)*

Would drive a long-lived compose-preview **daemon / session API** — a warm JVM
that re-renders interactively and serves data products (a11y/semantics) on
demand via `fetchData`. Best for fast iterative local use. **Not implemented**:
needs the session/data-product API to be published. Throws
`NotImplementedError`.

## Wiring into the Action / CLI

`@design-parity/action` builds a `CandidateProvider` from these sources
(`buildCandidateProvider`). The CLI accepts, in addition to today's precomputed
`CandidateRender[]` JSON, a **preview-bundle directory or list of polyglot
PNGs**:

```sh
design-parity run --components ui/Button.kt#PrimaryButton \
  --candidate-bundles .compose-previews/   # a dir of *.png bundles, or a,b,c list
```

When both `--candidates` (JSON) and `--candidate-bundles` are given, bundles are
tried first and the JSON is the fallback override.
