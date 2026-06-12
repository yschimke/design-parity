# @design-parity/adapter-stitch

The Google Stitch `ReferenceAdapter`. Stitch ships `@google/stitch-sdk` + an MCP
server but has **no Code Connect equivalent**, so — unlike Figma's machine link —
correspondence is resolved through the repo's `design-map.json`. The reference is
always produced with `linkMethod: "manifest"`.

## What it does

`resolve(componentId, ref, ctx)`:

1. **Resolve the handle.** A direct `stitch:<projectId>/<screenId>` ref is parsed
   as-is. Otherwise the adapter loads `design-map.json` (`designMapPath`, or
   `DESIGN_MAP_FILE`, else `<repoRoot>/design-map.json`) and `findByCode` maps the
   component to its Stitch ref — the manifest is the only correspondence layer.
2. **Fetch HTML+Tailwind** through the Stitch SDK (one or more screen variants).
3. **Rasterize** each screen headlessly to a reference PNG; dimensions are read
   straight from the PNG IHDR so they can't drift from the bytes the diff engine
   compares against.
4. **Extract Tailwind-derived tokens** — spacing/radius/background off the
   container, colour + typography off the title and body — into `DesignTokens`.
5. **Normalize** to a `DesignReference` with `linkMethod: "manifest"`.

## Auth

The default SDK client reads a credential from `AdapterContext.env`, in order:
`STITCH_API_KEY`, `STITCH_TOKEN`, `STITCH_ACCESS_TOKEN`, `GOOGLE_STITCH_TOKEN`.

A missing credential raises `StitchAuthError`; a rejected one is mapped from the
SDK. A component with no matching `design-map.json` entry raises
`StitchManifestError`; an unparseable ref raises `StitchBadRefError`.

## Usage

```ts
import { createStitchAdapter } from "@design-parity/adapter-stitch";

const adapter = createStitchAdapter();

const reference = await adapter.resolve(
  "ui/Card.kt#OfferCard",
  "stitch:design/abc123", // or the code handle, resolved via design-map.json
  { repoRoot: process.cwd(), env: process.env },
);
```

## Injectable seams

Both the SDK and the rasterizer are interfaces, so unit tests run with **no live
source and no browser** (see `test/`):

- `StitchClient.fetchDesign(ref)` → `StitchDesign` (`{ screens }`). The default
  `createSdkStitchClient` lazily drives `@google/stitch-sdk`, kept out of the
  package's hard dependencies so install stays clean; absence is a clear
  `StitchSdkError`.
- `Rasterizer.rasterize({ html, css })` → PNG bytes. The default
  `browserRasterizer` drives a headless Chrome/Chromium found on `PATH` (or
  `CHROME_PATH`) — never a bundled browser-automation dependency, mirroring the
  candidate renderer.
