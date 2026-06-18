# Adopting design-parity on a Compose Multiplatform project

A step-by-step guide to put a Compose Multiplatform (CMP) project under design
parity. CMP is the cheapest candidate-render path — the Desktop/JVM target
renders previews with **no Android emulator** (docs/PRINCIPLES.md Principle 6;
issue [#30](https://github.com/yschimke/design-parity/issues/30)) — so it's the
recommended way to try the tool end to end.

This guide is source-agnostic: it works with **Claude Design** or **Stitch**
references (and Figma / image bundles too). Where a step differs, both are shown.

## How the pieces fit

```
@Preview (CMP module)                          design reference
        │ compose-preview (Desktop/JVM render)         │ claude-design HTML export
        ▼                                              ▼  or stitch:<proj>/<screen>
  preview bundle (PNG+zip)  ──▶  design-parity diff  ◀──  DesignReference
                                       │
                                       ▼
                          verdict (md) + report.html
```

The **candidate** side comes from compose-ai-tools' `compose-preview`; the
**reference** side and the **correspondence** (which design maps to which code)
are design-parity's job.

## What you need

Everything but your own app is a **published artifact** — nothing here needs a
source checkout.

- [`design-parity`](https://www.npmjs.com/package/design-parity) — the tool
  itself, on npm; run it with `npx design-parity …` (no checkout).
- the **`compose-preview` toolchain** (built in
  [`yschimke/compose-ai-tools`](https://github.com/yschimke/compose-ai-tools)),
  consumed as published artifacts — **no checkout of that repo**:
  - the **Gradle plugin** from Maven Central, applied in your app to emit the
    preview bundles design-parity reads —
    `plugins { id("ee.schimke.composeai.preview") version "0.15.0" }`;
  - **and/or** the **`compose-preview` CLI** binary, for on-demand renders and
    the daemon — install once with
    `curl -fsSL https://raw.githubusercontent.com/yschimke/skills/main/scripts/install.sh | bash`.
- **your CMP app** — the subject under parity.

The default bundle path needs only the **plugin** (the static reader is pure JS,
no JVM); the CLI / daemon paths need only the installed **binary**. The
compose-ai-tools repo is a link for docs and issues — never a build dependency
of this pipeline.

## Rendering target: get faithfulness right first

Parity asserts **candidate render ≈ what ships**, so render on a target that
represents the shipped UI:

- **Shared, platform-agnostic UI** (composables in `commonMain`, Material3, no
  Android-only APIs/resources) → the **Desktop/JVM** render is a faithful proxy.
  This is the cheap path; prefer it.
- **Platform-specific UI** (Android-only APIs, `actual` impls, Android resources)
  → a Desktop render won't match the shipped Android pixels. Render those on
  Android (heavier), or lift the screen's composable into `commonMain` so it can
  render on Desktop.

If the project isn't CMP yet, adding a `jvm()`/desktop target and moving the
target screens' previews into a desktop-visible source set is usually a modest
change — and it's what unlocks the emulator-free path.

## Step 1 — Render candidates (Desktop → bundles)

1. Apply the compose-ai-tools `compose-preview` Gradle plugin (see that repo's
   README and the `compose-preview` skill).
2. Ensure the `@Preview`s you want under parity are in a **desktop-visible source
   set** (`commonMain`, or `desktopMain`).
3. Render them on Desktop and emit the **portable preview bundles** (PNG+zip
   polyglots). design-parity reads these statically — no second render.

**Theme (read this for CMP):** CMP apps usually theme via `MaterialTheme` / a
`CompositionLocal`, so the Android night-mode `uiMode` is unset and a candidate
image would get no `theme` — which then fails to pair with a `theme`-tagged
reference. design-parity derives theme in precedence order
([#48](https://github.com/yschimke/design-parity/issues/48)):

1. an explicit `theme` hint on the preview/capture (`"light"`/`"dark"`) — set
   this when you theme via a `CompositionLocal`;
2. the Android `uiMode`;
3. the preview id's **trailing** `_Dark`/`_Light`/`Night` token (only the last
   `[_\-. ()]`-separated token, so `Home_LightOn` is *not* mistaken for light).

**Semantics:** make sure the bundle carries the semantics blob (a11y tree +
resolved fg/bg colours + typography, the
[#38 contract](https://github.com/yschimke/design-parity/issues/38)). With it the
full a11y/i18n + contrast + token checks run; without it they degrade gracefully
to visual/structural-only. See [candidate-sources.md](./candidate-sources.md).

## Step 2 — Provide design references

Pick one source and commit/point at the references:

- **Claude Design** — commit the **HTML export** of each screen into the repo
  (e.g. `design/Home.html`); the `claude-design` adapter rasterizes it. No API
  token, fully offline, deterministic. Best fit for a first adoption.
- **Stitch** — reference each screen as `stitch:<projectId>/<screenId>` (two
  parts, separated by `/` — this is what `stitch-ref.ts` parses; a single-part
  `stitch:<id>` is rejected as `StitchBadRefError`). Needs auth, the SDK, and a
  headless Chrome — see **Stitch setup** below before you run.

### Stitch setup

The `claude-design` path is fully offline, but Stitch resolves references through
the Stitch SDK and rasterizes them in a real browser, so it has three
prerequisites the guide above doesn't (all enforced by the adapter at runtime —
see [`packages/adapters/stitch/README.md`](../packages/adapters/stitch/README.md)):

1. **A credential.** The adapter reads one env var, in this order — the first set
   wins: `STITCH_API_KEY` → `STITCH_TOKEN` → `STITCH_ACCESS_TOKEN` →
   `GOOGLE_STITCH_TOKEN`. None set → `StitchAuthError`; a rejected one is mapped
   from the SDK.
2. **The `@google/stitch-sdk` peer dep.** It's deliberately kept out of
   design-parity's hard dependencies so installs stay clean, so install it
   yourself in the project you run from (`npm i @google/stitch-sdk`). Absence →
   `StitchSdkError`.
3. **A headless Chrome/Chromium** on `PATH` (or pointed at by `CHROME_PATH`) for
   rasterization — no browser is bundled, mirroring the candidate renderer.

`claude-design` needs none of these; if a first Stitch adoption is fighting all
three at once, prove the pipeline on a `claude-design` HTML export first, then
switch the source.

## Step 3 — Map code ↔ design

Commit a root `design-map.json` linking each **code handle** (`path#Member`) to
its reference. Because a bundle/daemon candidate is keyed by a compose-preview
**preview id** (`<fqClass>.<function>`), add the `previewId` field to reconcile
the two namespaces ([#44](https://github.com/yschimke/design-parity/issues/44)):

```json
{ "components": [
  { "code": "ui/Home.kt#HomeScreen", "source": "claude-design",
    "ref": "design/Home.html", "previewId": "app.ui.HomeKt.HomeScreen_Light" }
]}
```

For Stitch use `"source": "stitch", "ref": "stitch:<projectId>/<screenId>"`
(e.g. `stitch:design/abc123`). Optionally add
`.design-parity.json` to set the parity **direction** (`design-led` blocks PRs on
a failure; `code-led` is advisory).

## Step 4 — Run it

No design-parity checkout needed — the CLI runs straight from npm:

```sh
npx design-parity run \
  --repo . \
  --components "ui/Home.kt#HomeScreen" \
  --candidate-bundles build/compose-previews/ \
  --out .design-parity/out
```

You get the markdown verdict on stdout **and** a self-contained
`.design-parity/out/<component>/report.html` per component — reference | candidate
| diff with the pixelmatch heatmap inlined, findings in value order (a11y/i18n,
then tokens, then pixels) — issues
[#49](https://github.com/yschimke/design-parity/issues/49) /
[#50](https://github.com/yschimke/design-parity/issues/50).

## Step 5 — Wire CI (optional)

Run the GitHub Action (`@design-parity/action`) so PRs render previews and get a
verdict comment: `design-led` blocks on parity failures, `code-led` stays
advisory.

## First-run playbook

Sequencing that keeps the first adoption tractable:

1. **Prove one screen end to end first.** Pick a single *shared, static* screen
   (no Bluetooth / permission / connection state) and drive it all the way to a
   `report.html` before mapping the rest. The pipeline spans the tool, the
   published renderer toolchain, and your app — get one green verdict before scaling.
2. **Only the preview surface needs to be CMP.** Don't make the whole app
   multiplatform. Lift the pure composable + a preview into `commonMain` /
   `desktopMain`; if a screen genuinely needs Android APIs, leave it on the Android
   render path rather than fighting it.
3. **Inject deterministic fake state into previews.** Live data (nodes, messages,
   connection state) breaks determinism (Principle 1). Use preview-parameter
   providers with sample state — never real transport, clock, or network.
4. **Verify the renderer side in isolation first.** Before blaming a bad verdict on
   design-parity: render one preview to PNG with the `compose-preview` skill and
   confirm the **bundle carries the semantics blob with resolved fg/bg colours**.
   Missing colours silently degrade contrast/a11y to visual-only — and that's a
   compose-ai-tools fix, not design-parity. The blob is where the high-value
   findings live (Principle 2).
5. **Remove pairing as a variable, then add it back.** The most common day-one
   failure is candidate/reference not pairing (no theme from a `CompositionLocal`,
   or a size mismatch). Start with **one variant** — single theme, default state,
   theme hint set — get it pairing, *then* add dark/other variants. Don't debug
   content drift and pairing at the same time.
6. **Start `code-led` (advisory), flip to `design-led` later.** A blocking check on
   day one kills trust before thresholds are calibrated. Run advisory, eyeball the
   `report.html` (not just the markdown verdict), tune `pixelThreshold` /
   `visualDimTolerancePx`, then gate.
7. **File friction back as issues, scoped per repo.** A CMP subject surfaces gaps
   an Android trial won't — the `localComposeWeb` stub and desktop-vs-design DPI.
   (CMP render-path detection itself is handled (#30): `cliRenderSource` prefers
   the emulator-free Desktop/JVM render for a CMP-capable module — see
   [candidate-sources.md](./candidate-sources.md).) One fix = one PR; be
   deliberate about whether it belongs in design-parity, compose-ai-tools, or the app.
8. **Defer other form factors.** If there are Wear/other surfaces, they're a
   different size class and render path — out of scope until the phone screens are proven.

## Gotchas (all handled — just know them)

- **DPI / density:** the Desktop render resolution won't exactly match the design
  export. design-parity tolerates a sub-pixel dimension delta and diffs over the
  overlap instead of scoring 100%
  ([#47](https://github.com/yschimke/design-parity/issues/47), default 8px — raise
  `visualDimTolerancePx` if your scale gap is larger).
- **Theme / size pairing:** set the theme hint (#48); size normalizes
  automatically (compact/medium/expanded).
- **preview-id ↔ code-handle:** use the `previewId` field (#44); unreconciled ids
  surface a warning, not a silent non-pair.
- **CMP Web/wasm render** (`localComposeWebSource`) is a deliberate stub — the
  [feasibility verdict](./cmp-web-wasm-feasibility.md) is *defer* (it needs a
  headless browser, an upstream wasm render entrypoint, and a web a11y export).
  Use the **Desktop** path today.
- **Live iteration:** the daemon path
  ([#43](https://github.com/yschimke/design-parity/issues/43)) can ingest the
  renderer's native a11y/i18n findings instead of re-deriving them.

## Conventions

`agent/...` branches; human-only git authorship (no AI attribution); one issue =
one branch + one PR; build + test + CI green before merge; keep README/docs in
sync. See [AGENTS.md](../AGENTS.md).
