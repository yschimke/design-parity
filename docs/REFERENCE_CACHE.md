# The reference cache

**Import the design side on its own schedule; read it during the run.**

A parity run used to re-fetch every reference from Figma, in full, on every
commit. This documents why that was wrong, what replaced it, and how to turn it
on. Issue [#289](https://github.com/yschimke/design-parity/issues/289).

## The problem, as observed

On a 77-component catalog ([m3-catalog run
31229088486](https://github.com/yschimke/m3-catalog/actions/runs/31229088486)),
**18 components produced a verdict**. The other 59 reported:

```
Adapter/diff error (failed soft): figma: rate limited (429) for
  /v1/files/ocdacdEsnHipMJD3egzxKb/nodes?ids=53923%3A28845.
```

Three things compounded, and the third is what made it damaging:

1. **Fetches were per component.** ~2–3 requests × N components, in a burst,
   against a limiter that is per token.
2. **A 429 threw immediately.** The client parsed `Retry-After` and nothing
   consumed it.
3. **Publishing replaced the branch.** A component that rate-limited *this* run
   had its previous report deleted rather than kept.

So a run that covered a quarter of the catalog looked exactly like one that
covered all of it — and which quarter changed run to run.

(1) and (2) are fixed: the REST client retries, honouring `Retry-After`
([#290](https://github.com/yschimke/design-parity/pull/290)), and the adapter
reads a whole catalog's structure in a handful of batched requests
([#294](https://github.com/yschimke/design-parity/pull/294)). (3) is fixed by
carry-forward publishing ([#291](https://github.com/yschimke/design-parity/pull/291)).
All three reduce the symptom. **None of them removes the coupling that causes
it**, which is what this doc is about.

## The shape of the fix

The two sides move at completely different speeds. Code changes many times a
day; a published design kit changes rarely. Paying the full reference cost on
every commit is paying for a side that did not move — and paying it against a
rate limiter.

So they are split:

| | Cadence | Figma calls | Failure mode |
| --- | --- | --- | --- |
| **Import** (`design-parity import`) | Scheduled / dispatched / on kit change | 1 per unchanged file; 2 per stale node | Partial — costs freshness, loses nothing |
| **Parity run** (`design-parity run`) | Every commit | **Zero** | Cache miss on a named component |

The cache is a directory, committed to a branch exactly like the artifacts are —
no hosted dependency ([Principle 1](./PRINCIPLES.md)), no live source at run
time, and a diff that is reproducible because the reference is *pinned* rather
than re-fetched.

## What is on disk

```
design-parity/reference          ← a branch, one commit per import
├── index.json                   ← the manifest
└── <fileKey>/
    ├── variables.json           ← one per file, not one per node
    └── <nodeId>/                ← `1:42` is spelled `1-42` (filesystem-safe)
        ├── node.json            ← the structure the tokens come from
        └── image.svg            ← the rendered reference
```

`index.json` carries, per node, the file `version` that was in effect when it
was fetched and the timestamp it was fetched at:

```json
{
  "formatVersion": 1,
  "files": {
    "ocdacdEsnHipMJD3egzxKb": {
      "version": "2149807103",
      "lastModified": "2026-08-01T09:12:44Z",
      "fetchedAt": "2026-08-08T06:00:11.402Z",
      "variables": "ocdacdEsnHipMJD3egzxKb/variables.json"
    }
  },
  "entries": [
    {
      "fileKey": "ocdacdEsnHipMJD3egzxKb",
      "nodeId": "53923:28845",
      "fileVersion": "2149807103",
      "fetchedAt": "2026-08-08T06:00:11.402Z",
      "node": "ocdacdEsnHipMJD3egzxKb/53923-28845/node.json",
      "image": "ocdacdEsnHipMJD3egzxKb/53923-28845/image.svg",
      "imageFormat": "svg"
    }
  ]
}
```

Those two fields are the whole mechanism. `fileVersion` says whether an entry
is stale; `fetchedAt` says what to refresh first.

## Why it converges

**A metadata short-circuit.** `GET /v1/files/:key?depth=1` carries `version`,
which changes on any edit. One request answers "can *any* reference in this file
have moved?" — so an unchanged kit costs exactly one request, not 154.

**Oldest-first.** What could not be fetched this time is the oldest thing in the
cache next time, so it goes to the front of the queue. An import that only ever
gets through half the catalog still reaches all of it, in two runs rather than
never. `--max` makes this explicit for a kit too large for one job.

**Nothing is deleted because a request failed.** A node that fails keeps the
entry it already had — blobs included — *and keeps its old `fileVersion`*, so it
stays stale and stays queued. A node is refreshed only when **both** its
structure and its image arrived, so a half-updated entry never reaches the
branch. On a 429 the import stops that file rather than spending its retry
budget proving the limiter is still there.

Publishing is a commit, not a force-push: the branch is diffable over time and a
bad import is one revert away. An import that changed nothing does not commit.

## Turning it on

Two workflows. The import:

```yaml
# .github/workflows/design-parity-import.yml
on:
  schedule: [{ cron: '0 6 * * *' }]
  workflow_dispatch:
jobs:
  import:
    uses: yschimke/design-parity/.github/workflows/design-parity-import-reusable.yml@main
    permissions:
      contents: write
    secrets:
      figma-token: ${{ secrets.FIGMA_TOKEN }}
```

…and the parity run, pointed at the same branch:

```yaml
jobs:
  parity:
    uses: yschimke/design-parity/.github/workflows/design-parity-reusable.yml@main
    permissions:
      contents: write
    with:
      module: ':catalog'
      shards: 6
      reference-cache-branch: design-parity/reference   # ← this
```

**Bootstrap the cache before you point at it.** Run the import once by hand
(`workflow_dispatch`) before the first parity run. Until the branch exists there
is nothing to read, and `require-reference-cache` (default `true`) fails the run
rather than letting it quietly fetch everything live.

That ordering is the whole adoption rule, and it is easy to get wrong in a way
nothing reports: wear-m3-catalog set `reference-cache-branch` without ever
running the import, so for months every run fetched all 581 references live
behind a single warning while the workflow file said it made no Figma calls. If
you must land the parity wiring first, set `require-reference-cache: false`
explicitly and treat it as a TODO — a visible opt-out beats a silent fallback.

**That opt-out needs a `figma-token`.** The run's credential guard skips only
when a token *and* a cache branch are both absent, so a configured-but-missing
branch with no token sails past it and then fails every Figma reference
individually — a soft-failed board rather than the live fallback you asked for.
Opting out means choosing live fetching, so pass the credential live fetching
needs.

Locally:

```sh
FIGMA_TOKEN=… npx design-parity import --repo . --cache .design-parity/reference
npx design-parity run --repo . --components … \
  --reference-cache .design-parity/reference --reference-cache-only
```

### Options worth knowing

| Input | Why you'd set it |
| --- | --- |
| `max` | Cap how many nodes one import refreshes. With oldest-first, a kit too large for one job imports over several runs. |
| `force` | Re-read everything, ignoring `version`. For when you suspect the cache itself is wrong — not for routine use, since the version check is what makes an unchanged kit cost one request. |
| `prune` | Drop cached nodes the map no longer references. Off by default: pruning against a map that failed to regenerate throws away references the next import has to re-fetch. |
| `design-map-command` | Only when the map is generated (a Gradle discovery pass). A committed map needs neither Java nor Gradle in the import job. |
| `placeholder-fill` | What to paint where the kit left an image slot empty. Defaults to `flat`. See below. |

### Empty image slots

A Figma `IMAGE` fill with no image behind it renders as Figma's checkerboard,
and caching that verbatim makes the reference a bad instrument. A checkerboard
turns a small geometry error into a large pixel difference and then stops
responding. Measured over a 236×132 region against the kit's own grid:

| geometry error | checkerboard | flat fill |
| --- | --- | --- |
| 1dp shift | 6.8% of pixels differ | 0.8% |
| 3dp shift | 20.3% | 2.5% |
| 10dp shift | 67.8% | 8.5% |
| a 42dp slot against the kit's 64dp | 49.6% | 55.9% |

It amplifies about 8×, and by 10dp it reads the same as a component that is
entirely wrong. The last row is the real problem: two checkerboards at
different *pitches* differ in ~50% of pixels however small the underlying
error, because the grids decorrelate. A consumer whose slot is the wrong height
scores the same as one drawing nothing at all.

So the import repaints those fills. `placeholder-fill` takes:

- **`flat`** (default) — the mean of the tile's own two colours, `#ececec` for
  the Wear M3 kit. The only option whose reported difference stays monotonic
  across the whole error range.
- **`checkerboard`** — cache Figma's output verbatim, when fidelity matters more
  than measurement.
- **`transparent`** — paint `none`. Note this is the mirror failure of the
  checkerboard: sensitive to a 1dp shift, but flat by 10dp, because once the two
  outlines separate the difference stops growing.
- **`#rrggbb`** / `#rrggbbaa` — an explicit colour.

Only the *paint* changes. The path keeps its position, size and corner radius,
so the slot's geometry is still fully compared and a wrong frame still diffs —
the opposite of masking the region, which would answer the saturation problem by
throwing away the measurement.

Detection is structural — a regular, two-colour, alternating grid — not a
checksum list, so a kit shipping its own placeholder is covered and real artwork
never is. Every substitution is logged per node with the tile's checksum and
colours, because the cached reference deliberately stops matching what Figma
renders for those nodes. The import also reports `placeholders=<n>`.

**Consumers must draw the same placeholder** for the comparison to mean
anything. That coupling is a documented contract on both sides, not something
the run can check.

## What the run does with it

`--reference-cache <dir>` reads the cache and falls back to the API on a miss.
`--reference-cache-only` — what the workflow passes — makes a miss an error
instead. That distinction is the point: without it, a miss quietly reaches for
the network and the run is rate-limitable again, just less often.

The same reasoning applies one level up, to the *branch* rather than a node.
Those flags are only passed when the branch clones; a branch that is missing
entirely used to mean no flags at all, and therefore a fully live run. That is
what `require-reference-cache` closes — an absent cache is now a loud setup
error, not a silent return to per-run fetching.

A miss is a per-component error, which the pipeline already fails soft on
(Principle: a broken adapter must not break the run). It names the node and says
to run the import. **One honest gap on a board beats a silently dropped row** —
that was the original complaint.

A run reading the cache needs **no Figma token at all**. The parity workflow
still accepts one, and uses it when no cache branch is configured.

Two things the cache does *not* cover, which fall back to the API exactly as
before:

- A `ref` that only Code Connect can resolve (the import warns and skips it —
  resolving it needs the repo checkout, which the import job may not have).
- Any source that is not Figma. Stitch, Claude Design and bundle references are
  already committed or already local.

## Verdict semantics

The verdict is computed over the **union** — this run's rows plus the rows
carried forward — not over the refreshed subset. A known blocking finding does
not stop being one because this run could not re-measure it, and under
`design-led` a silently-dropped component is exactly the failure mode that makes
a green run untrustworthy.

It is still gated on the parity direction: under `code-led` a carried failure
does not block, because the same row would not have blocked when it was fresh.

The landing page carries per-row freshness (`from <commit>`), so a stale block is
visible *as* stale rather than being indistinguishable from a fresh one.

## Interaction with the run-level skip

`cache-paths` + the run manifest already let a run stand on the published board
when nothing moved ([#293](https://github.com/yschimke/design-parity/pull/293)).
With a reference cache configured, the reference ingredient of that key becomes
the **cache branch's head commit** rather than a live `version` lookup per file
— so the skip decision, too, makes zero Figma calls. The two features compose:
the skip avoids rebuilding a board that would come out identical; the cache
makes the rebuild cheap and reliable when it does happen.

## Where the code is

| Piece | Where |
| --- | --- |
| On-disk format, reader, writer | [`packages/adapters/figma/src/reference-cache.ts`](../packages/adapters/figma/src/reference-cache.ts) |
| Import policy (short-circuit, oldest-first, partial) | [`packages/action/src/import.ts`](../packages/action/src/import.ts) |
| `design-parity import` | [`packages/action/src/cli/import-cli.ts`](../packages/action/src/cli/import-cli.ts) |
| Adapter reading the cache | [`packages/adapters/figma/src/adapter.ts`](../packages/adapters/figma/src/adapter.ts) |
| Import workflow | [`.github/workflows/design-parity-import-reusable.yml`](../.github/workflows/design-parity-import-reusable.yml) |
| Parity workflow wiring | [`.github/workflows/design-parity-reusable.yml`](../.github/workflows/design-parity-reusable.yml) |
