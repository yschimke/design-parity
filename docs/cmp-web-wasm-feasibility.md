# Compose for Web / wasm candidate renderer — feasibility verdict

Issue [#30](https://github.com/yschimke/design-parity/issues/30) (docs/PRINCIPLES.md
Principle 6) floats a **Compose-for-Web / wasm** candidate-render backend as a
stretch goal: render candidates in a headless browser — "the lightest path and
the one that could run in a JS playground" — behind the same `CandidateRender`
contract as the JVM/Desktop and Android paths. This is the written-up feasibility
verdict that acceptance criterion #3 asks for, in lieu of landing it.

The seam already exists: `localComposeWebSource` in
[`packages/candidate/src/sources.ts`](../packages/candidate/src/sources.ts) is a
`CandidateSource` stub that throws `NotImplementedError`. This doc records *why*
it is still a stub and what would have to be true to implement it.

## TL;DR — **Defer. Keep the stub; Desktop/JVM stays the recommended path.**

Web/wasm rendering is **technically viable for pixels** (it's the same Skia
engine as the Desktop renderer), but it is **not the cheapest path today**, and
it **can't yet produce design-parity's headline signal** (a11y/i18n). Three
blockers, none of which design-parity can close on its own:

1. **It needs a headless browser, not pure Node.** The wasm render targets an
   HTML `<canvas>` via a WebGL context. That requires a headless Chromium
   (Playwright/Puppeteer), which is *heavier* than the JVM Desktop render we
   already support — so the "lightest path / runs in a JS playground" premise
   doesn't hold for an automated, headless parity run.
2. **No a11y/i18n data products on web.** design-parity *leads with* a11y + i18n
   (Principle 2), and on the Desktop/bundle/daemon paths those come from the
   renderer's `a11y/hierarchy` + `a11y/atf` + `text/strings` products. Compose
   for Web's accessibility support is still in progress (keyboard nav + basic
   screen-reader semantics; native-HTML a11y interop is explicitly "next"), and
   there is no equivalent structured export. A web render would silently degrade
   to **visual-only** — the least valuable signal (Principle 2).
3. **The render entrypoint is upstream, not here.** A wasm candidate needs a
   per-project `wasmJs` build of the previews plus a JS preview-host that mounts
   each `@Preview` into a canvas and exposes a screenshot hook. That is
   compose-ai-tools build infra (like the Desktop renderer and the daemon), not
   something `@design-parity/candidate` should reimplement (AGENTS.md: "do not
   reimplement rendering").

## What "Compose for Web" means here

Two distinct things ship under that name; only one is relevant:

- **`org.jetbrains.compose.web` (compose-html)** — a DOM/CSS API
  (`Div`/`Span`/…). It is *not* Compose UI, renders no `@Preview`, and shares no
  pixels with the shipped Android/Desktop UI. **Irrelevant** to parity.
- **Compose Multiplatform for Web (wasm + Canvas)** — real Compose UI rendered
  to an HTML `<canvas>` via **Skiko/Skia compiled to WebAssembly**
  (`CanvasBasedWindow`). This reached **Beta in Compose Multiplatform 1.9**
  (2025); with WasmGC now in every modern browser (Safari shipped it Dec 2024),
  it runs everywhere. **This is the candidate backend #30 means.**

Because the wasm Canvas path uses the **same Skia engine as the Desktop
renderer** (`ImageComposeScene` + Skia), pixel fidelity between a Web render and
a Desktop render should be high — which is exactly why it's tempting, and why,
if/when the blockers clear, it slots cleanly behind the existing contract.

## How a parity render would have to work

```
@Preview (commonMain)  ──wasmJs build──▶  preview-host.wasm + JS harness
                                                  │  (mount preview → <canvas>)
                                                  ▼
                                   headless Chromium (Playwright, WebGL)
                                                  │  screenshot the canvas
                                                  ▼
                                   PNG  ──▶  CandidateRender (contract unchanged)
```

The shape is identical to the bundle/daemon paths from design-parity's side —
it would produce a `CandidateRender` and (ideally) a `SemanticTree` — so the
`diff` engine and the Action stay source-agnostic. The cost is entirely in the
**producer**: the wasm preview-host and the headless-browser screenshot harness.

## Assessment by the dimensions that matter

| Dimension | Verdict | Notes |
| --- | --- | --- |
| **Pixel fidelity** | ✅ good | Same Skia engine as Desktop; renders should match closely. |
| **Runtime weight** | ❌ not the lightest | Needs headless Chromium + WebGL — heavier than the JVM Desktop render we already have. The "runs in a JS playground" pitch is true for a *human* poking at it, not for a headless CI render. |
| **a11y / i18n** | ❌ blocking | Web a11y is in progress; no `a11y/*` / `text/strings` data-product equivalent. Would degrade to visual-only, against Principle 2. |
| **Render entrypoint** | ❌ not in scope | Requires an upstream compose-ai-tools wasm preview-host; out of `@design-parity/candidate`'s remit. |
| **Determinism** | ⚠️ manageable | Browser font availability, canvas DPI, and antialiasing differ from Desktop; would need pinned fonts and a fixed device-pixel-ratio. Tractable, but extra work. |
| **Contract impact** | ✅ none | Slots behind `CandidateSource` / `CandidateRender` unchanged; no `diff` change. |

## Verdict and what would change it

**Keep `localComposeWebSource` a documented stub.** The **Desktop/JVM** target is
the emulator-free path design-parity recommends and supports today
(see [adopting-cmp.md](./adopting-cmp.md)); it already delivers Principle 6's
"no Android emulator" win with the full a11y/i18n signal. Web/wasm adds runtime
weight and *loses* the high-value checks, so it is not worth implementing yet.

Reassess when **any** of these lands:

- compose-ai-tools ships a **wasm preview-host + headless-screenshot** path (the
  render entrypoint), the way it ships the Desktop renderer and the daemon; and
- Compose for Web exposes **structured accessibility/semantics** that can be
  exported as the `a11y/hierarchy` + `a11y/atf` data products the diff consumes,
  so a web render isn't visual-only.

Until then the contract is deliberately ready for it: a future
`localComposeWebSource` implementation drops in behind the same seam with no
change to `diff`, the resolver, or the Action.

## Sources

- [Compose Multiplatform 1.9.0 — Compose for Web goes Beta (Kotlin Blog, 2025)](https://blog.jetbrains.com/kotlin/2025/09/compose-multiplatform-1-9-0-compose-for-web-beta/)
- [Core Framework and Skiko — Compose Multiplatform (DeepWiki)](https://deepwiki.com/JetBrains/compose-multiplatform/2.1-core-framework-and-skiko)
- [Accessibility — Kotlin Multiplatform docs](https://kotlinlang.org/docs/multiplatform/compose-accessibility.html)
- [Present and Future of Kotlin for Web (Kotlin Blog, 2025)](https://blog.jetbrains.com/kotlin/2025/05/present-and-future-kotlin-for-web/)
