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
| `daemonSource` | `daemon` | **2 — shipped (#43, #55)** | low per render, warm | a running compose-ai-tools daemon | yes (compose/semantics → a11y/hierarchy) **+ native findings** |

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
  (`uiMode`, `widthDp`, …) map to `theme` (via `themeForPreview`) and `size`
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

### 3. `localComposeWebSource` — Compose-for-Web / wasm render *(stub)*

Would render a Compose Multiplatform component via Compose for Web / wasm (real
Compose UI on an HTML canvas via Skia), screenshotting it in a headless browser
— no Android emulator (docs/PRINCIPLES.md, Principle 6). **Not implemented**, by
decision: the feasibility verdict (issue #30 stretch) is **defer**. It needs a
headless browser rather than pure Node, an upstream compose-ai-tools wasm render
entrypoint, and a web a11y/semantics export the Principle-2 checks rely on — so
the **Desktop/JVM** path stays the recommended emulator-free renderer. Throws
`NotImplementedError`. Full write-up:
[cmp-web-wasm-feasibility.md](./cmp-web-wasm-feasibility.md).

### 4. `daemonSource` — compose-ai-tools daemon, native findings (#43)

Drives a long-lived compose-ai-tools **daemon** (a warm JVM that re-renders
interactively and serves data products on demand) over the
{@link DaemonDataClient} transport seam — production speaks the
JSON-RPC-over-stdio protocol (compose-ai-tools `docs/daemon/PROTOCOL.md`, e.g.
`compose-preview bundle daemon <bundle>`); tests inject a fake.

**Decision (issue #43): on the daemon path design-parity ingests the renderer's
*native* a11y/i18n findings** rather than re-running its own checks — the
renderer already computed them from the live render. Per preview the source:

- maps the rendered capture → the candidate `Image` (`data:` or path);
- builds the `SemanticTree` from `compose/semantics` when available — the
  **nested** SemanticsNode projection, so the tree reflects real structure and
  each text node carries its resolved fg/bg colours (`layout*Color`, converted
  from `#AARRGGBB` to CSS `#RRGGBBAA`) and font size, letting **colour-based
  contrast run from the tree**; `compose/theme`'s colour scheme seeds a
  root-level background so text without its own background still resolves one.
  Falls back to the **flat** `a11y/hierarchy` (every node off a synthetic root,
  contrast left to native `a11y/atf`) when the richer product isn't served
  (#55);
- maps the native data products → `Finding[]`:

  | Data product | → Finding |
  | --- | --- |
  | `a11y/atf` (incl. contrast) | `contrast` / `a11y` (ERROR→error, WARNING→warn) |
  | `a11y/touchTargets` | `a11y` (belowMinimum→error, else warn) |
  | `text/strings` (truncated/overflow) | `i18n` (text-expansion risk) |
  | `i18n/translations` (missing locales) | `i18n` (coverage) |

The source exposes `nativeFindingsFor(componentId)`; the action injects those as
the diff's `checks` provider (`diff(reference, candidate, { checks })`), so they
**supersede** `@design-parity/checks` for that component while the parity diff
(token / visual / semantic-vs-reference) still runs — **reusing the existing
`ChecksProvider` seam, no diff change** (the orchestrator's `nativeChecks`
option). `@design-parity/checks` remains the path for sources with no native
findings (static bundle, figma, stitch, claude-design).

The mappers are pure and unit-tested against captured/mocked `data/fetch`
payloads (no live daemon required). Driving a live daemon end-to-end is the
remaining trial step.

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

With `--out <dir>`, each component writes into its **own subdir**
(`<out>/<sanitised-component-id>/`) so multiple components never overwrite each
other's artifacts (#49): the triptych PNGs land there alongside a self-contained
`report.html` — the reference | candidate | diff comparison page, with each
pair's pixelmatch heatmap inlined (#50). The run prints the page paths.

### Reconciling preview ids with code handles (#44)

A bundle/daemon candidate is identified by a compose-ai-tools **preview id**
(`<fqClass>.<function>`, e.g. `ee.app.ButtonKt.PrimaryButton`), but the
orchestrator pairs a candidate to its reference **by `componentId`**, and
references use a **code handle** (`path#Member`, e.g.
`ui/Button.kt#PrimaryButton`). Left alone, the two namespaces never match.

`buildCandidateProvider` bridges them through `@design-parity/resolver`'s
`resolvePreviewIds`, mirroring the resolver's precedence:

1. **Explicit** — a `previewId` field on the matching `design-map.json` entry
   (high confidence). Use this when the convention can't recover the path
   (e.g. the bundle's `sourceFile` isn't repo-relative):

   ```json
   { "code": "ui/Button.kt#PrimaryButton", "source": "bundle",
     "ref": "design/button", "previewId": "ee.app.ButtonKt.PrimaryButton" }
   ```

2. **Convention** — `sourceFile#functionName` from the bundle's own
   `previews.json` entry (low confidence), when no explicit link exists.

The matched candidate is re-keyed to the **code handle** (`componentId`) so it
pairs with its reference, while the raw preview id is preserved on
`CandidateRender.previewId`. A preview id that maps to neither surfaces a
**warning** in the run report rather than silently failing to pair.

### Deriving an image's theme (#48)

Pairing keys on `state/theme/size`, so a candidate image needs a `theme` to line
up with a `theme`-tagged reference. `themeForPreview` derives it in precedence
order:

1. **Explicit hint** — `params.theme` (`"light"`/`"dark"`) on the preview or
   capture. **Set this when the app themes via a `CompositionLocal`** (e.g.
   `ProvideHaTheme(HaTheme.Dark)`) rather than the Android night-mode config: in
   that case every preview reports `uiMode: 0` and the theme is otherwise
   undiscoverable.
2. **`uiMode`** — the Android `Configuration.UI_MODE_NIGHT_*` bits, when the app
   themes through `uiMode`.
3. **Name convention** — the preview id's **trailing** `dark`/`light`/`night`
   token (`Tile_LightOn_Dark` → dark). Only the last `[_\-. ()]`-separated token
   is read, so an embedded word like `Tile_LightOn` is **not** mistaken for a
   light-theme variant. Low confidence.

A producer that themes via a `CompositionLocal` should prefer setting `theme` on
the bundle/daemon image directly (option 1) — the convention is a best-effort
fallback for when it can't.
