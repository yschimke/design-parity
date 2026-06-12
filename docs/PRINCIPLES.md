# Principles

These are binding constraints on every package and issue in this repo, not
aspirations. When a design decision is unclear, resolve it in favor of these.

## 1. Generate scripts, don't put AI in the loop

AI is used at **authoring / bootstrap time** to generate deterministic,
committed artifacts — check rules, token baselines, pseudolocale configs,
`design-map.json` entries, Code Connect suggestions. At **run time** (CI on a
PR) the bot executes only that committed, deterministic code and config. No
per-PR model calls in the steady state.

Why: reproducible verdicts (the same PR always scores the same), zero per-PR
token cost, auditable diffs (a rule change is a reviewable commit, not a prompt),
and CI that runs offline and fast.

Where genuine inference is unavoidable (e.g. fuzzy component-name matching, or
proposing a baseline for a greenfield repo), it runs in **interactive mode** and
its output is a **committed artifact** — never a decision re-made on every run.
If you find yourself wanting to call a model from the Action, stop: generate a
script or config instead.

## 2. Check what developers actually get wrong

Pixel-matching is table stakes and the least valuable signal. Lead with the
objective, spec-backed details that humans routinely miss and design tools don't
enforce:

- **Accessibility** — contrast (WCAG AA/AAA), touch-target size, semantic
  roles/labels, content descriptions, focus order, state announcements.
- **Internationalization** — text expansion & truncation, RTL mirroring,
  locale-aware number/date/currency formatting, pseudolocalization, and
  hardcoded user-facing strings.

These are deterministic to check, hard to eyeball, and high-value. The verdict
**leads with a11y and i18n findings**, then token compliance, then raw visual
diff.

## 3. Meet projects where they are; raise the floor

A repo sits on one of three rungs, and the bot detects which:

1. **Design system + machine link** (Figma Code Connect) → full parity against
   the real spec.
2. **Design system, no machine link** → link via `design-map.json`.
3. **No design system** → **bootstrap to an opinionated best-practice
   baseline** (e.g. Material 3 + WCAG AA + i18n-ready defaults). Generate a
   starter `design-map.json`, a token baseline, and a check config, then check
   the PR against that baseline.

The goal for a greenfield or immature repo is to get it to *good defaults fast*,
not to demand it already have a design system. Bootstrapping is a one-time
interactive step that emits committed artifacts (see Principle 1).

## 4. Interactive when needed, unattended by default

Two modes over one core:

- **Interactive** (local CLI / MCP / agent) — setup, triage, bootstrapping, and
  generating the committed artifacts. This is the only place AI proposes
  changes.
- **Unattended** (GitHub Action) — steady-state enforcement on every PR, with
  zero human input, running only committed deterministic artifacts.

Steady state must never depend on a live model or a human in the loop. If a
check can't run unattended, it isn't done.

## 5. Parity has a direction, and it's committed policy

When design and code disagree, *someone* is canonical. That choice
(`ParityConfig.direction`) is a committed setting, read deterministically — not
guessed per run.

- **`design-led`** — the design is the contract. A violation **blocks** the PR;
  the fix is in code. Never push code back to the design.
- **`code-led`** — the shipped code is reality. Violations are **advisory**, and
  drift can be pushed back to the design tool (Code-to-Canvas, the fast-follow).
- **`auto`** — a transitional default, not a steady-state mode. **Setup
  materializes it**: bootstrap detects the maturity rung (Principle 3) and
  writes a concrete `design-led`/`code-led` into the committed config, so a
  configured repo never re-resolves direction at run time (Principle 1). It
  resolves to `design-led` when there's a design system with a machine link
  (Figma + Code Connect), `code-led` otherwise — a freshly bootstrapped repo is
  code-led by construction. If the Action is wired up without setup, the
  resolver still maps `auto` deterministically as a fallback.

GitHub stays the verdict surface in every mode (it's the only one that works for
all three sources and runs unattended); surfacing back into the design tool is a
`code-led`, Figma-only stretch.
