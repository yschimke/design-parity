# @design-parity/adapter-figma

The Figma `ReferenceAdapter`. Figma is the keystone source — the only one with a
machine-resolvable design↔code link (**Code Connect**). This adapter uses the
**REST API + Code Connect**, never the Dev Mode MCP server (that is
local/desktop-session oriented and wrong for a hosted bot).

## What it does

`resolve(componentId, ref, ctx)`:

1. **Resolve the node.** If `ref` is a handle (`figma:<fileKey>/<nodeId>` or a
   figma.com URL) it's parsed directly. Otherwise the adapter reads the repo's
   Code Connect output (`figma.code-connect.json`, or `FIGMA_CODE_CONNECT_FILE`)
   to map the component to a node.
2. **Fetch structure** — `GET /v1/files/:key/nodes` (padding, corner radius,
   fills, text style).
3. **Fetch variables** — `GET /v1/files/:key/variables/local`, mapping
   collection modes (Light/Dark) to themed colors. Degrades gracefully to
   structure-only tokens when variables aren't entitled.
4. **Render the reference image(s)** — `GET /v1/images`, downloaded and written
   under `outDir`.
5. **Normalize** to a `DesignReference` with `linkMethod: "code-connect"`.

## Auth

Reads credentials from `AdapterContext.env`:

- `FIGMA_OAUTH_TOKEN` → `Authorization: Bearer` (preferred), or
- `FIGMA_TOKEN` / `FIGMA_PAT` / `FIGMA_ACCESS_TOKEN` → `X-Figma-Token`.

Missing credentials, `401/403`, `429` (rate limit, with `Retry-After`), and a
missing node each raise a typed `FigmaError` subclass.

## Usage

```ts
import { createFigmaAdapter } from "@design-parity/adapter-figma";

const adapter = createFigmaAdapter({
  // optionally render one image per theme from separate frames
  resolveTargets: (ref) => [
    { nodeId: ref.nodeId, theme: "light", size: "compact" },
    { nodeId: "1:43", theme: "dark", size: "compact" },
  ],
});

const reference = await adapter.resolve(
  "ui/Button.kt#PrimaryButton",
  "figma:AbCdEf123456/1:42",
  { repoRoot: process.cwd(), env: process.env },
);
```

Network is injectable (`fetch`) and the client is mockable, so unit tests run
fully offline (see `test/`).

## Theming note

Figma's image render uses a node's default variable mode; the REST API can't
switch modes per render. So themed **tokens** come from variables (all modes),
while themed **images** come from rendering separate per-theme frames via
`resolveTargets`.
