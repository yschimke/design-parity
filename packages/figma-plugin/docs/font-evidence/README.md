# Reference font fidelity (#482, MeshCore #361)

Reproduced on design-parity main `302cf5b`, using the lockfile's Playwright
1.64.1 / Chromium 156.0.8078.4 on Linux. No shipping plugin markup, app font
choice, or candidate renderer changes are involved.

[Before: current main on this host](before-add.png) ·
[After: pinned Inter](../ui-task-add.png)

Chromium's `CSS.getPlatformFontsForNode` reported `DejaVu Sans`,
`DejaVuSans-Bold`, `isCustomFont: false`, 13 glyphs for the visible header before
the change. It now reports Inter from the embedded webfont. The capture audits
visible text, probes normal weights 400/600/700 for both pinned families, and
records resolved identities in `ui-preview.manifest.json`.

The old input-hash gate remains and now includes the helper, font bytes, and
capture fontconfig settings. The capture preserves the caller's installed font
set and explicitly disables raster hinting/subpixel rendering through a final
fontconfig override and Chromium flag.
The browser CI job additionally compares all five regenerated PNGs with the
committed files in three separate browser launches: the normal system font set,
DejaVu-only (with the same rasterization settings), and DejaVu-only again.
`fc-list` must prove the font sets differ. All five PNGs were byte-identical
across those captures. This promises reproducibility for the pinned Linux
Chromium and raster settings, not arbitrary browser/OS rasterizers.

| View | Reproduced before | Pinned after |
| --- | --- | --- |
| add | 904×1768 | 904×1796 |
| library | 904×1928 | 904×1954 |
| customize | 904×2404 | 904×2440 |
| handoff | 904×2610 | 904×2646 |
| uibuilder | 904×1606 | 904×2082 |

Inter's usual Latin web subset omitted `→`, so the committed subset includes
symbols too. Native file-selector text and monospace fields are also explicitly
pinned in the capture stylesheet. See [font sources/licenses](../fonts/README.md).

Regression evidence: without the capture font stylesheet the new browser test
failed with the DejaVu header identity above. With the old export-driver
`document.fonts.ready` behavior, the corrupt-font regression failed with
`Missing expected rejection.` A failed face still lets `fonts.ready` resolve.
The initial GitHub browser run also reproduced `expected Inter 400; painted []`
after scrolling the Customize view. Offscreen probes can be culled. The audit
now puts probes in the visible viewport and captures a frame before querying
CDP, then removes the probes before writing evidence. All identity assertions
remain enforced. The next CI run passed identity checks but received PNG hash
`3e824d7a…` instead of local `e2ff4329…` for Add. This exposed per-OS raster
hints; those are now pinned in `fontconfig.conf` and included in the manifest.
CI retains its actual screenshots and font reports on success or failure.

The driver now explicitly loads declared faces and rejects failures/timeouts
with family, weight, style and status. Existing fail-soft/`--strict` policy is
preserved; this does not claim to validate undeclared system font identities.

Re-run after `npm ci`, `npm run build`, `npm run build:plugin --workspace
@design-parity/figma-plugin`, and `npx playwright install chromium`:

```sh
CHROME_PATH=$(node --input-type=module -e 'import {chromium} from "playwright"; console.log(chromium.executablePath())') \
  npm run preview:ui --workspace @design-parity/figma-plugin
node --test packages/figma-plugin/docs/reference-fonts.test.mjs \
  packages/figma-plugin/docs/ui-preview.test.mjs \
  packages/export-driver/reference-font-readiness.test.mjs
```

Local verification: full workspace build; 2,042 Vitest tests; 258 conformance
tests; export-driver suite (1,412 passed, 37 skips for external players/server
sources absent locally); five focused browser tests; workflow-probe and
set-version checks. The shell probe initially failed because this container
lacked jq; installing jq in temporary tooling made every probe pass.

Release ordering: the private plugin evidence fix requires no npm release.
The export-driver guard requires a design-parity release, then a
compose-ai-tools `.github/design-artifacts-driver` package.json **and lockfile**
bump, then a Tools release and consumer reusable-workflow pin bumps. MeshCore's
explicit HTML fonts and local checked capture are independent and work with the
current driver. No consumer bump or hosted regeneration is claimed here. Keep
existing font-install workarounds until those lanes are independently verified.
