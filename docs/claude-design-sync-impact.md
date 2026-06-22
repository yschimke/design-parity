# Claude Design `/design-sync` — impact on the `claude-design` source

On **2026-06-17** Anthropic moved **Claude Design** from research preview to
**beta** and shipped a two-way bridge with Claude Code, headlined by a new
`/design-sync` command. This doc records what changed and what it means for
design-parity's [`@design-parity/adapter-claude-design`](../packages/adapters/claude-design)
source — whose entire premise (`README.md`: *"There is no Claude Design read
API"*) is the thing this update touches.

## TL;DR — **Strengthens the source. Update the premise, keep the adapter.**

`/design-sync` is **not** a public REST read API, so the adapter's
rasterise-a-committed-export shape stays valid. But the framing that Claude
Design is *"designless — no machine link, no authoritative pull from the tool"*
([correspondence-and-token-matching.md](./correspondence-and-token-matching.md))
is now too strong: the terminal sync **materialises a real, machine-readable
design system (tokens + components) as committed artifacts in the consumer
repo**. That is strictly better input than a one-off HTML export, and it lands
exactly where design-parity wants it — on disk, deterministic, no AI in the CI
loop (Principle 1). The work this implies is **documentation + adapter-premise
updates, not an architecture change**.

## What shipped

- **`/design-sync` (terminal ↔ canvas, both directions).** From Claude Code you
  *pull* a design system into the repo to build against real components, or
  *push* what you built back into Claude Design to keep editing on the canvas.
  A `/design` skill also works directly in the terminal. (Skills land in new
  sessions only; `/update` if absent.)
- **Design-system import** from a **GitHub repo, design files (incl. Figma
  `.fig` exports), or raw uploads** — batches ≤256 files, ≤256 KiB each.
- **Governed write path:** the sync runs **read → plan → write**; nothing is
  written without an approved `planId`, and it updates incrementally
  (component-by-component), never a wholesale library replacement.
- **Validate-and-correct:** Claude builds with the imported components, checks
  output against the system, and auto-corrects before surfacing a result.
- **Brand controls + admin role** to lock one approved system; fine-grained
  canvas editor; **PDF / PPTX export**.

What did **not** ship: a REST read endpoint or a Figma-style node-image / token
pull. `/design-sync` is a Claude Code skill that *produces committed files*, not
an authenticated API the adapter could call at run time.

## What it changes for design-parity

| Premise in the repo today | After `/design-sync` |
| --- | --- |
| *"There is no Claude Design read API … no machine link"* (adapter `README.md`) | Still no **read API**; but there is now a **terminal-driven, governed sync** that emits committed, machine-readable design-system artifacts. The honest framing is *"machine-**assisted** link, committed"* — not *"designless."* |
| *"only Figma has a machine link"* (`correspondence-and-token-matching.md:99`) | Figma is still the only *live REST* link, but Claude Design is no longer in the same "no authoritative pull" bucket as a hand-committed bundle. |
| Reference = a human-committed **HTML export** rasterised headlessly | HTML export remains a valid **fallback**; the richer reference is the synced **tokens + component set**, which can feed the token table directly (no rasterise needed for token checks). |
| Reverse direction (build HTML *into* Claude Design) owned by the external `compose-preview-design-board` skill | `/design-sync`'s **canvas push-back does this natively.** Reconcile so design-parity doesn't maintain a parallel reverse path. |
| Claude Design is `linkMethod: "manifest"`, code→design only | A synced system carries **component identity**, opening a real `ref → code` reverse index — already a "future" bullet at `correspondence-and-token-matching.md:335`. |

### Overlap with `baseline` — complementary, not competing

Claude Design's "import a system → validate → auto-correct" overlaps on the
surface with [`@design-parity/baseline`](../packages/baseline) (synthesise a
baseline when there's no design system) and with the diff verdict. They compose
rather than collide, because the postures are opposite:

- Claude Design's auto-correct is **in-loop AI**, before you see the result.
- design-parity is a **deterministic, committed, no-AI-in-CI gate** (Principle 1)
  that proves parity on every PR and **leads with a11y + i18n** (Principle 2).

The clean division of labour: **use `/design-sync` to seed the reference**, then
**design-parity to enforce it** on each PR. If a project has adopted Claude
Design, `baseline` bootstrap can point at the synced artifacts instead of
synthesising tokens from scratch.

## Follow-ups

1. **Adapter premise text** — ✅ done alongside this doc (#148): softened the
   "no read API / no machine link" language in the adapter README,
   [`adapter.ts`](../packages/adapters/claude-design/src/adapter.ts) header, and
   the `correspondence-and-token-matching.md` asymmetry note.
2. **Consume synced tokens directly** — ✅ done (issue #149): a `claude-design`
   `design-map.json` ref ending in `.json` is loaded as a `/design-sync`-emitted
   **DTCG token artifact** into a token-only `DesignReference` (no rasterise),
   reusing core's `loadDtcgTokens`. No `diff` / contract change.
3. **Reverse index** — ✅ already shipped (#94): `buildReverseIndex` in
   [`@design-parity/resolver`](../packages/resolver/src/reverse-index.ts) inverts
   the manifest + Code Connect to `ref → code[]`, source-agnostically — a
   `claude-design` ref (including the `.json` synced-token ref) is covered.
4. **Reconcile the reverse path** — ✅ resolved as positioning (issue #151):
   design-parity ships **no `claude-design` `CanvasWriter`** and runs no
   push-back for this source. `/design-sync`'s canvas push-back is an
   interactive, human-run terminal skill — off the unattended Action path by
   Principles 1, 4, and 5 — and it supersedes the older
   `compose-preview-design-board` skill. Code-to-Canvas push-back stays
   Figma-only (`FigmaCanvasWriter`), where the bridge is a non-interactive write.

## Sources

- [Claude Design and Claude Code now work together in both directions (@claudeai, Threads)](https://www.threads.com/@claudeai/post/DZstNk4G5-b/claude-design-and-claude-code-now-work-together-in-both-directions-rolling-out)
- [Anthropic ships major Claude Design overhaul — design-system imports, code round-trips (VentureBeat)](https://venturebeat.com/technology/anthropic-ships-major-claude-design-overhaul-with-design-system-imports-code-round-trips-and-a-fix-for-its-token-burning-problem)
- [Claude Design now stays on brand for daily work (claude.com blog)](https://claude.com/blog/claude-design-stays-on-brand-for-daily-work)
- [Get started with Claude Design (Claude Help Center)](https://support.claude.com/en/articles/14604416-get-started-with-claude-design)
- [Claude Design June 2026: Design Systems & /design-sync (explainx.ai)](https://explainx.ai/blog/claude-design-june-2026-update-design-sync-2026)
</content>
</invoke>
