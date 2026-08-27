# Known-differences conformance fixtures

`known-differences.zip` is the exact canonical
`compose-preview-known-differences/v1` fixture tree from
`yschimke/compose-ai-tools`.

**The pin is not written here.** It lives in
[`../../src/acceptance/vendor/PROVENANCE.json`](../../src/acceptance/vendor/PROVENANCE.json),
under `fixtures`, alongside the commit the vendored engine came from — because
they are the same commit, and must stay so. A kernel change moves the expected
scores in this corpus, so an engine and a corpus snapshotted from different
revisions make the conformance result meaningless while still passing. This
file previously restated the commit and digest, and had already drifted from
the archive committed beside it; the conformance suite now reads both from the
provenance record instead.

It is archived only to keep a large canonical corpus from becoming that many
maintained files in this repository. The conformance test expands it into a
temporary directory and runs every declared case and every declared pin.

Refresh it together with the engine — one commit, one command:

```sh
node packages/diff/test/sync-known-differences-vendor.mjs PATH_TO_CHECKOUT
```

`sync-known-differences-fixtures.mjs` still snapshots the corpus alone, for the
rare case where only it needs regenerating; both build the archive through
`vendor-archive.mjs`, so they cannot disagree about its bytes.
