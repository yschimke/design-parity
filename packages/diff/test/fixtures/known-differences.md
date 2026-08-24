# Known-differences conformance fixtures

`known-differences.zip` is the exact canonical
`compose-preview-known-differences/v1` fixture tree from
`yschimke/compose-ai-tools` commit
`47243aa900e4ff371f820eb51107cb383ca25542`.
Its deterministic archive SHA-256 is
`1814f88704a15996611b77f3c6fdc34fbaff3cfe50f54bddaec2e671909af66c`.

It is archived only to keep a 1,360-file test corpus from becoming 1,360
maintained files in this repository. The conformance test expands it into a
temporary directory and runs every declared case and every declared pin.

Refresh it from a checkout at the pinned commit:

```sh
node packages/diff/test/sync-known-differences-fixtures.mjs ../compose-ai-tools
```
