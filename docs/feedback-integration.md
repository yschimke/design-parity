# Feedback integration

**Status:** design sketch (no code yet). Companion to
[`report-format.md`](./report-format.md) and
[`correspondence-and-token-matching.md`](./correspondence-and-token-matching.md).

Today the bot's output is one-way: it renders the candidate, diffs it against the
reference, and **emits** a verdict — the idempotent PR comment
(`packages/action/src/github/surface.ts`) and a self-contained per-component
`report.html` (`packages/report-html`). A human reading either can't *act* from
where they are. This doc sketches how a finding becomes durable, routable
**feedback** — a GitHub issue, or a comment pinned on the Figma reference — without
breaking the report's offline/deterministic guarantees, and with an auth model
that doesn't turn the render host into an anonymous spam cannon.

## The two flows people conflate

- **Feedback *out* of a finding** — escalate a machine finding somewhere durable.
  The bot (or a reviewer clicking a button) is the author.
- **Feedback *in* from a human** looking at the diff — a reviewer leaves a note.
  A person is the author.

They share one pipeline. The verdict already produces structured `Finding`s
(`packages/core/src/types.ts`); everything below adds **sinks** and one **routing
key**, not a new pipeline:

```
Finding[]  ──▶  fingerprint  ──▶  route (default from direction, overridable)  ──▶  sink
(diff engine)   (stable id)       (github-issue | figma-comment | pr-comment)     (write)
```

## Fingerprint (the one new key)

Every escalation is keyed by a stable **fingerprint** so re-runs *update* rather
than duplicate — the same discipline `surface.ts` already uses with
`REPORT_MARKER` for the PR comment. Proposed:

```
fingerprint = sha1(componentId + "\0" + kind + "\0" + normalize(message))
```

`normalize` strips volatile numerics that don't change the *identity* of a finding
(a contrast ratio of 4.4 vs 4.3 is the same finding). The fingerprint is embedded
as a hidden marker in each sink (issue body, Figma comment body) so the writer can
find-and-update its own prior artifact. It is also the key for the override table
(below) and for dedup across both sinks.

## Routing, and the override

`ParityDirection` (`packages/core/src/types.ts`) already decides who is canonical;
it supplies the **default** sink, exactly like `selectMode`
(`packages/action/src/mode.ts`) derives a default that an explicit override wins.

- `design-led` → the code is wrong → **GitHub** (issue / PR).
- `code-led` → the design is stale → **Figma** (comment on the reference).

Keep **feedback routing separate from parity direction itself** — direction also
governs whether a finding *blocks* the PR; redirecting where a *note* goes must not
flip the blocking semantics. Model the route as its own downstream decision that
*reads* direction as a default:

```ts
interface FeedbackRoute {
  fingerprint: string;
  sinks: FeedbackSink[];                 // a SET — "also file it", not only "instead"
  origin: "direction" | "policy" | "human";
}
type FeedbackSink = "github-issue" | "figma-comment" | "pr-comment";
```

Resolution is a precedence chain, most-specific wins:

1. **`direction`** — the default, from `ParityDirection`.
2. **`policy`** — a committed override in `.design-parity.json` (repo-wide) or
   `design-map.json` (per-component): "this component's feedback always goes to
   Figma regardless of direction." Deterministic, survives re-runs, no human in
   the loop.
3. **`human`** — an ad-hoc, per-finding redirect at review time. Always wins.

Because routing is overridable, the route itself must be **durable**: persist
`fingerprint → {sinks, origin}` (at least for `human` overrides) so a later run
doesn't recompute `direction` and post a *second* copy to the other sink. A
`human` origin is pinned — `direction`/`policy` can't silently recompute over it.

## Sinks

- **GitHub issue** — extend the existing `fetch`-based client
  (`packages/action/src/github/rest.ts`) with `searchIssues`/`createIssue`/
  `updateIssue`. Body carries the fingerprint marker, the finding `detail`
  (expected/actual), and a link back to the report + PR. Escalate only findings
  that outlive the PR (design-system bugs, deferred `error`-severity a11y/contrast)
  — never "every finding → an issue."
- **Figma comment** — `POST /v1/files/:key/comments` with
  `client_meta: { node_id, node_offset: {x,y} }` pins the comment to the reference
  node at a pixel coordinate. **This is writable over plain REST** — unlike
  Code-to-Canvas image write-back (`packages/adapters/figma/src/canvas-writer.ts`),
  which needs a plugin/Dev-Mode bridge because REST can't edit nodes. The two hard
  inputs already exist: `parseFigmaRef` gives `fileKey`+`nodeId`, and `overlay.ts`
  already computes finding regions **in the reference's own coordinate space**, so
  a `Bounds` maps almost directly to `node_offset`. (The current
  `packages/adapters/figma/src/rest-client.ts` is GET-only — add a POST path.)
- **PR comment** — the existing surface; the default sink for advisory notes.

## Delivery surfaces

Three surfaces, rising cost. The cheap two cover most of it and keep the report a
static artifact.

1. **Unattended (Action).** The PR-comment path already exists. Add
   direction-gated auto-escalation: `design-led` `error`-findings → a GitHub issue;
   `code-led` findings → a pinned Figma comment. Both idempotent by fingerprint.
2. **Static, no backend — prefilled links.** The `report.html` is deliberately
   self-contained (data-URI PNGs, inline CSS/JS, no external assets; committed to
   `design-artifacts/*`, attached to PRs, opened via htmlpreview) and a static file
   can't POST. So per finding, emit a **prefilled GitHub issue link**
   (`github.com/OWNER/REPO/issues/new?title=…&body=…`, body carrying the
   fingerprint + report URL) and a **Figma deep-link** to the node. The human picks
   the direction by choosing which link to click — zero backend, offline-safe, the
   report stays byte-deterministic.
3. **Interactive — via the trusted preview host.** For an in-report "Send feedback"
   button (or in-report Figma-comment posting, which the browser *cannot* do
   directly — Figma's REST API has no browser CORS), route through the
   `compose-preview serve` host (`preview.coo.ee`). It already serves the reports
   same-origin, already has a **trust store** and a "public render executes no code,
   privileged levers are opt-in" posture (see
   `compose-ai-tools/docs/public-preview-server.md`). Add a **`POST /api/feedback`**
   endpoint; the host holds the credentials, does the GitHub/Figma write, and
   enforces dedup + trust. **Progressive enhancement, so determinism holds:** the
   emitted HTML is byte-identical and fully viewable offline; the script posts to a
   *relative* URL and feature-detects at load (`GET /healthz` / check
   `location.origin`) — a live host shows the button, a bare file falls back to the
   prefilled links of (2).

## Auth (the load-bearing part)

A write endpoint on a host that holds privileged credentials is a **confused-deputy**
risk: whoever reaches it could make the host write wherever its creds allow. Three
rules, then a ladder of who-authenticates.

### Rule 1 — the sink target is resolved server-side, never sent by the client

The browser sends a **fingerprint** ("escalate this finding"), *never* a target
("file an issue on `owner/repo`" / "comment on file `X`"). The host resolves the
repo + Figma node from the **trusted session** it already holds (the verdict +
catalog + `design-map.json`). A forged request can therefore only ever act on the
targets *this session already maps to* — it can't pivot to an arbitrary repo or
file. This single rule is what makes the endpoint safe to expose at all.

### Rule 2 — least-privilege, server-only credentials

Tokens live only on the host (env / secret store), never in the report, never in
logs. Scope them to the minimum and to the parity targets:

- **GitHub:** a **GitHub App** (not a PAT) installed only on the parity repos, with
  `issues:write` (+ `contents:read` if needed). Installation tokens are per-repo and
  auto-expire (~1h). Issues authored by the App show as `app-name[bot]` — acceptable,
  and consistent with the repos' "…[bot] is exempt" attribution rule (and issues
  aren't commits anyway).
- **Figma:** a token with only `file_comments:write`. A **PAT** posts as one service
  account (every comment reads as "design-parity-bot"); **OAuth** posts as the real
  user (see the ladder). Either way the call is **server-side** — Figma has no
  browser CORS, so the token never needs to reach, and never reaches, the browser.

### Rule 3 — a write is a new trust class; gate it like `--allow-render-trusted`

`--public` render is "safe by construction" only because it executes no code and
every privileged lever defaults off. "File an issue on your repo" / "post a Figma
comment" is a genuinely new capability. Mirror the existing gating rather than
inventing a posture: **operator opt-in flag, only for a `Trusted` session/catalog,
fail-closed** (an `Unverified`/spoofed catalog can't escalate at all), plus
per-session/per-fingerprint **rate limiting** (dedup already collapses repeats) and
a message-length cap.

### Who authenticates — a ladder (pick per deployment)

| Mode | Who calls | Writes as | Best for | Cost |
|---|---|---|---|---|
| **A. Host token** | anyone with `SERVE_TOKEN` | the host's bot identity | private/team box (non-`--public`) | trivial; no per-person attribution, no public box |
| **B. Viewer OAuth** | the reviewer signs in (GitHub App user-to-server; Figma OAuth + PKCE) | **the reviewer** | public/shared box, best attribution | OAuth app + callback/token exchange; dead offline |
| **C. Signed capability** | CI mints a short-lived signed token (HMAC/JWT: `{repo, figmaFile, fingerprints, exp}`) embedded in the report; JS presents it back | the host, bounded by the token | the unattended CI-generated PR report where no human logs in | bounded blast radius; token is bearer → short-lived, single-scope |

**Recommendation:** **B** as the strong default for public/shared hosts — it
*dissolves* the confused-deputy problem because the capability is the viewer's own
(GitHub/Figma themselves enforce that a user can only write where they already have
access), and it gives real attribution. **A** for a private box. **C** for the
unattended PR-report flow. Regardless of mode, **Rule 1 always holds** — the target
is resolved from the trusted session, never from the client.

Two constraints the ladder must respect:

- **C breaks committed determinism.** A per-run signed token varies each run, so a
  report carrying one is *not* byte-deterministic and must **not** be committed to
  `design-artifacts/*` — C is only for the ephemeral, PR-attached report. The
  committed catalog reports use A/B (login at view time) or fall back to the
  prefilled links.
- **CSRF/origin.** The endpoint is state-changing: require same-origin (report
  served by the host), check `Origin`/`Sec-Fetch-Site`, carry the credential in a
  header (not an ambient cookie), and use the standard `state` param for the OAuth
  flows.

## What lands where (two repos, matching the existing split)

Mirrors how candidate-render already lives on the compose side and reference/diff
on the design-parity side:

- **design-parity** — the fingerprint util (`@design-parity/core` or a small new
  package), the routing/override resolver + persisted route table, the GitHub-issue
  and Figma-comment sink clients, and `report-html` emitting the prefilled links
  (2) + the progressive-enhancement client (3).
- **compose-ai-tools** (`compose-preview serve`) — the `POST /api/feedback`
  endpoint, the opt-in flag + trust gate + rate limit, credential handling, and the
  OAuth callback. Tracked as a companion follow-up; the OSS core still works
  standalone via surfaces (1) and (2) with **zero** hosted dependency
  (per `AGENTS.md` "OSS core vs hosting").

## Open questions

- Do `human` overrides live in the committed repo (auditable, PR-reviewed) or in
  host-side state (lower friction, but off the OSS-standalone path)? Leaning
  committed for `policy`, host-side for ad-hoc `human`.
- Figma comment **resolution** — should re-passing parity auto-resolve the pinned
  comment, or only stop re-posting? (Resolving needs the comment id round-tripped
  via the fingerprint marker.)
- Issue lifecycle — reopen on regression, or file fresh? (Fingerprint makes either
  possible; reopen is less noisy.)
