# Fixtures

Golden fixtures so every downstream package can code against stubs without a
live design source or renderer. Each `*.reference.json` is a normalized
[`DesignReference`](../packages/core/src/types.ts); `*.candidate.json` is a
[`CandidateRender`](../packages/core/src/types.ts). All `uri`s are
repo-relative paths to the PNGs alongside them.

| Path | Source | Used by |
| --- | --- | --- |
| `figma/button-primary.reference.json` + `.light.png` / `.dark.png` | Figma (Code Connect) | Issue 2 (figma adapter), Issue 6 (diff) |
| `stitch/offer-card.reference.json` + `.light.png` | Stitch (manifest) | Issue 3 (stitch adapter) |
| `claude-design/offer-card.reference.json` + `.light.png` (export: [`design/reference/offer-card.html`](../design/reference/offer-card.html)) | Claude Design (manifest, HTML export) | Issue 4 (claude-design adapter) |
| `bundle/offer-card.reference.json` + `bundle/offer-card/` (dir: `manifest.json` + `.light.png` / `.dark.png`) and `bundle/offer-card.zip` (same, zipped) | Bundle (manifest, image bundle) | Issue 32 (bundle adapter) |
| `candidate/button-primary.candidate.json` + `.png`s | candidate render | Issue 5 (candidate), Issue 6 (diff) |
| `design-map.json` | manifest | Issue 3/4/7 |
| `page-backdrop/pages.json` + `now-playing.png` + `render-*.png` | Figma page import | `@design-parity/page-backdrop` — a whole imported screen (nine instances covering all four link methods) plus the three code renders that overlay it, so the viewer builds with no Figma credentials and no renderer |

## The diff story (Figma button vs candidate)

The Figma reference and the candidate render are intentionally mismatched so
the diff engine (Issue 6) has deterministic findings to assert:

- **token**: candidate padding `12dp` vs spec `16dp`.
- **contrast**: dark-theme container drifts (`#7A72F0` vs spec `#8A82FF`),
  exercising the AA contrast check.
- **visual**: the dark-theme PNGs differ; light-theme PNGs match.

Regenerate the PNGs with `scripts/gen-fixtures.py` if the dimensions change.
