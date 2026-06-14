# @design-parity/report-html

The per-run **self-contained HTML comparison page**: the rich artifact a
reviewer opens from a PR to actually *review* a mismatch.

Given the same `(DesignReference, CandidateRender, Verdict)` the markdown
summary uses — plus optional diff panels — `renderHtmlReport` emits **one
offline `.html` string**:

- **reference | candidate | diff** side by side per variant (paired by
  `state/theme/size`, tolerant when a side omits or relabels the size), with a
  vanilla opacity/overlay slider to wipe between reference and candidate.
- the verdict findings in **value order** (a11y + i18n → token → semantic →
  visual), each with its severity, and the token expected-vs-actual shown
  inline from `finding.detail`.
- everything inlined: CSS in a `<style>`, the slider JS in a `<script>`, and
  every image as a `data:image/png;base64,…` URI. **No external requests** — it
  opens from a file, as a CI artifact, or on GitHub Pages.

It is a **leaf consumer**: it depends only on `@design-parity/core`. The diff
panels arrive as a generic `DiffImage { key; png }`, so it never depends on
`@design-parity/diff`.

Output is **deterministic** — same input, byte-identical HTML. No timestamps,
random ids, or `Date.now()` (docs/PRINCIPLES.md, Principle 1).

## Usage

```ts
import { renderHtmlReport } from "@design-parity/report-html";

const html = renderHtmlReport({
  reference, // DesignReference
  candidate, // CandidateRender
  verdict, // Verdict
  diffImages: triptychs.map((t) => ({ key: t.key, png: t.png })), // optional
  repoRoot, // resolves reference/candidate Image.uri (defaults to cwd)
});
// write `html` to one .html file
```

Reference and candidate PNGs are read from disk via `repoRoot + Image.uri`
(the same resolution the diff engine uses) and inlined. A side with no images
(a semantic/token-only verdict) degrades cleanly — the findings still render.

## Branch landing page

`report.html` is per-component; `renderIndex` stitches a whole run together so
the published artifact branch has an entry point instead of a wall of
machine-named directories. Given the run's components it returns
`{ readme, html }`:

- `README.md` — what GitHub renders when you open the branch: a "generated, do
  not edit" banner, the source commit, and a table linking each component to
  its report.
- `index.html` — a self-contained landing page for GitHub Pages / local view.

Because GitHub serves a linked `.html` blob as source (the slider JS won't run),
pass the published `repoSlug` + `branch` to wrap the README's report links
through `htmlpreview.github.io` so they render on click; without them the links
are relative. Deterministic, same as `renderHtmlReport`.

## CLI

A small demo CLI ships as `design-parity-report`:

```sh
design-parity-report \
  --reference fixtures/figma/button-primary.reference.json \
  --candidate fixtures/candidate/button-primary.candidate.json \
  --verdict   out/verdict.json \
  --diff default/dark/compact=out/diff-dark.png \
  --repo . \
  --out report.html
```
