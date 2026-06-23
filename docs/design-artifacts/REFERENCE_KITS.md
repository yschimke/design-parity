# Reference Figma kits (seed only — code is the source of truth)

This catalog pipeline is **code-led**. The artifacts it produces are derived from
the *rendered code* of each component system via `compose-preview` data products,
so they are correct by construction: the padding, corner radius, type, colour,
and touch-target numbers are whatever the components actually resolve at render
time, not what a spec says they should be.

The published Figma kits below are **reference / one-off seed material**, used to:

- bootstrap the component **inventory** (what belongs on the sticker sheet) and
  the **naming** (so `Button/Filled` lines up with the kit's frame name), and
- give designers a familiar starting structure to merge our authoritative
  renders into.

They are **not** authority. Where a kit and our render disagree, the kit is
wrong: file the divergence against the kit, do not "fix" our output to match it.
The correspondence between a code component and its kit frame is recorded the
same way the rest of design-parity records it — in `design-map.json` — so the
once-off import is auditable and a later kit refresh re-imports cleanly.

## Kits by system

### Compose M3 (`androidx.compose.material3`, incl. `material3.adaptive`)
- **Material 3 Design Kit** — https://www.figma.com/community/file/1035203688168086460/material-3-design-kit
- **Material Design 3 Components** — https://www.figma.com/community/file/1228357783685927211/material-design-3-components
- **Material 3 & Android 15** — https://www.figma.com/community/file/809865700885504168/material-3-android-15
- **Android UI Kit** (canonical layouts / adaptive) — https://www.figma.com/community/file/1478523627015571873/android-ui-kit

### Wear Compose M3 (`androidx.wear.compose.material3`)
- **M3 Wear OS Apps Design Kit** — https://www.figma.com/community/file/1506418396052412186/m3-wear-os-apps-design-kit
- **M3 Wear OS Tiles Design Kit** — https://www.figma.com/community/file/1507852095734722321/m3-wear-os-tiles-design-kit
- (legacy, for coverage cross-check) **Wear OS Material Design Kit 2021** —
  https://www.figma.com/community/file/1201317683854299165/wear-os-material-design-kit-2021
- Index of the above on developer.android.com:
  https://developer.android.com/design/ui/wear/guides/get-started/design-kits

### Glimmer (`androidx.xr.glimmer`, Android XR / AI glasses)
- **Jetpack Compose Glimmer UI** — https://www.figma.com/community/file/1579881278082580424/jetpack-compose-glimmer-ui
- Guidance: https://developer.android.com/design/ui/ai-glasses/guides/styles/overview

### Wear widgets / Glance (`androidx.glance` app widgets + Glance Wear Widgets)
- **Widget Canonical Builder** — https://www.figma.com/community/file/1478519017421157788/widget-canonical-builder
- **Widget Kit** — https://www.figma.com/community/file/1029752635205954705/widget-kit
- Glance 1.1 component design specs ship inside the **Android UI Kit** (above).
- Guidance: https://developer.android.com/design/ui/widget and
  https://android-developers.googleblog.com/2025/03/design-with-widget-canonical-layouts.html

> Note: `glance-wear-tiles` is deprecated and is being replaced by the new
> **Glance Wear Widgets** library; pin the live coordinate at build time. The M3
> Wear OS Tiles kit is the closest reference until a dedicated Glance-wear kit
> ships.

## Size breakpoints to mirror per system

The catalog renders each component across the same breakpoints its published kit
documents, so the sheet matches how designers already think about the system:

| System | Breakpoints / surfaces |
| --- | --- |
| Compose M3 (+Adaptive) | window size classes: `compact` (≤600dp), `medium` (600–840dp), `expanded` (≥840dp); light + dark |
| Wear Compose M3 | small round (≈192dp), large round (≈227dp); plus square; light + dark (Wear is dark-first) |
| Glimmer | AI-glasses display surface(s) per the Glimmer preview guide; additive/transparent ground |
| Wear widgets / Glance | widget cell sizes from the canonical builder (text, toolbar, etc. layouts) across breakpoints |
