# Compose Multiplatform: detect, prefer, promote (Principle 6)

[Principle 6](../../../docs/PRINCIPLES.md) says the bot **prefers** the Compose
Multiplatform (CMP) render path when a project supports it, **promotes** CMP to
projects that don't, and **never requires** it — plain Jetpack Compose must keep
working, and the suggestion is advisory, never a gate.

This package ships the deterministic, offline half of that today. The live
render path is deferred (it needs a JVM/Compose toolchain we don't run in unit
tests) and is specified below as the next step.

## Shipped here (deterministic + unit-tested)

- **CMP capability detection** — `detectMaturity()` now scans committed Gradle
  build files (`build.gradle`, `build.gradle.kts`, `settings.gradle*`,
  `libs.versions.toml`) and reports `cmpCapable: boolean` plus an evidence trail
  (`cmp.signals`) on the existing `MaturityResult`. The 3-rung shape is
  unchanged — CMP is **orthogonal** to the maturity rung; a repo at any rung may
  or may not be CMP-capable. Signals detected:
  - `compose-plugin` — the `org.jetbrains.compose` Gradle plugin (id or
    `libs.plugins.compose…` alias);
  - `kotlin-multiplatform` — `kotlin("multiplatform")`, the
    `org.jetbrains.kotlin.multiplatform` plugin id, or a catalog coordinate;
  - `jvm-target` — a non-Android KMP target that can host a headless render
    (`jvm()`, `desktop`, `wasmJs`, `js`);
  - `compose-dependency` — a `compose-multiplatform` / `org.jetbrains.compose:`
    dependency.
  Detection is permissive by design: it's an advisory hint, so a false positive
  merely skips a suggestion and a false negative merely shows one.

- **CMP promotion** — `cmpSuggestion()` returns a non-blocking advisory string
  when (and only when) a repo is **not** CMP-capable; `undefined` when it
  already is. `planBootstrap()` attaches it as `plan.cmpSuggestion`, and the
  bootstrap CLI prints it. It is never an artifact and never a gate.

The scan is bounded and reuses the maturity walk (no second directory crawl):
the walk records build-file *paths*, then a small, bounded pass reads and
classifies only those files. Unreadable files degrade to "no signal", matching
the walk's tolerance.

## Deferred (needs the JVM/Compose toolchain — written up, not built)

### 1. Prefer the CMP desktop/JVM render in `@design-parity/candidate`

When `cmpCapable` is true, drive the published `compose-preview` CLI's
**desktop/JVM** render of candidate `@Preview`s (no Android emulator) instead of
the Android path, and fall back to Android-only Jetpack Compose unchanged when
it isn't. The output normalizes to the existing `CandidateRender` contract, so
`diff` stays source-agnostic — **no contract change**.

This is deferred because it invokes a real toolchain (Gradle + the Compose
desktop renderer) that isn't available in this repo's unit tests, and AGENTS.md
forbids reimplementing rendering. The capability flag built here is the input
that selects the renderer; wiring is the next PR.

**Feasibility: high.** `compose-preview` already supports a desktop/JVM render
path, and capability detection (this PR) supplies the deterministic switch. The
remaining work is plumbing + an integration test gated on the toolchain being
present (skipped otherwise), not new research.

### 2. Compose-for-Web / wasm headless-render backend (spike)

The lightest path: render candidates in a headless browser via Compose for Web /
wasm — the one that could run in a JS playground rather than a full CI toolchain.
If viable, it lands as an **alternate** candidate renderer behind the **same**
`CandidateRender` contract, selected when a `wasmJs`/`js` target is present
(already a detected `jvm-target` signal).

**Feasibility: plausible but unproven — a spike, not a commitment.** Compose for
Web/wasm rendering is newer and headless-capture tooling (a deterministic
PNG/snapshot out of a headless browser) is the open question. Verdict: keep it a
spike behind the contract; do not block the desktop/JVM path (item 1) on it.

## Non-negotiable

Plain Jetpack Compose stays a first-class, fully supported target. CMP is the
**recommended** path, not a requirement: the suggestion is advisory, no render
path is gated on capability, and an Android-only repo renders unchanged.
