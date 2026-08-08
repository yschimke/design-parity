#!/usr/bin/env bash
# Guard the capability probes in the reusable workflow.
#
# A probe asks "does the installed CLI support this flag?" by reading its usage
# output. The usage path deliberately exits non-zero (2), which makes the
# obvious spelling wrong in a way that always fails OPEN:
#
#     if npx design-parity@x shard 2>&1 | grep -q -- '--flag'; then
#
# Under `set -o pipefail` — which every step in that workflow sets — the
# pipeline takes the CLI's exit 2 regardless of what grep matched, so the probe
# reports "unsupported" for every version, including ones that do support the
# flag. That shipped, and it silently disabled render scoping on every run: the
# job logged a "CLI too old" warning and fell back to an unscoped render while
# the CLI in front of it was perfectly capable.
#
# The correct shape captures first and greps second:
#
#     usage="$(npx design-parity@x shard 2>&1 || true)"
#     if printf '%s' "$usage" | grep -q -- '--flag'; then
#
# This script checks both halves: that the broken shape is absent from the
# workflow, and that the shape we replaced it with actually works against a
# stub that exits 2.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Every workflow that probes a CLI capability. The import workflow probes for
# `import` itself, and the parity workflow for `--reference-cache`; both fail
# open the same way, and both would fail open SILENTLY — an import that becomes
# a nonsense parity run, or a run that quietly goes back to fetching every
# reference live, which is the coupling issue #289 exists to remove.
workflows=(
  "$root/.github/workflows/design-parity-reusable.yml"
  "$root/.github/workflows/design-parity-import-reusable.yml"
)
fail=0

note() { printf '  %s\n' "$1"; }
bad() { printf '✗ %s\n' "$1"; fail=1; }
ok() { printf '✓ %s\n' "$1"; }

# ── 1. The broken shape must not reappear ───────────────────────────────────
# `if <command> | grep …` where the left side can fail. `printf`/`echo` on an
# already-captured variable is the SAFE spelling and is excluded: those cannot
# fail, so grep's status is the pipeline's. Anything else on the left — npx, a
# function, a subshell — carries its own exit status into the pipeline.
danger='^[[:space:]]*if[[:space:]]+(?!printf|echo)[^|]*\|[[:space:]]*grep'
for workflow in "${workflows[@]}"; do
  name="$(basename "$workflow")"
  if hits="$(grep -nP "$danger" "$workflow" 2>/dev/null)" && [ -n "$hits" ]; then
    bad "${name}: probe pipes a fallible command straight into grep inside an \`if\` — under pipefail that command's exit status wins, not grep's:"
    printf '%s\n' "$hits" | while IFS= read -r line; do note "$line"; done
    note "capture first: usage=\"\$(cmd 2>&1 || true)\"; if printf '%s' \"\$usage\" | grep -q …"
  else
    ok "${name}: no probe pipes a fallible command directly into grep inside an \`if\`"
  fi
done

# ── 2. The replacement shape must actually work ─────────────────────────────
# A stub standing in for `design-parity shard` with no selector: prints usage
# on stdout, exits 2.
stub() {
  echo "design-parity shard --shard <index>/<total> [--repo .] [--preview-universe <previews.json>]"
  return 2
}

probe_broken() { if stub 2>&1 | grep -q -- '--preview-universe'; then echo supported; else echo unsupported; fi; }
probe_fixed() {
  local usage
  usage="$(stub 2>&1 || true)"
  if printf '%s' "$usage" | grep -q -- '--preview-universe'; then echo supported; else echo unsupported; fi
}

# Proves the bug is real rather than theoretical — if this ever reports
# "supported", pipefail semantics changed and the guard above can be relaxed.
if [ "$(probe_broken)" = "unsupported" ]; then
  ok "piped probe misreports a capable CLI as unsupported (the bug this guards)"
else
  bad "piped probe no longer misreports — re-check whether this guard is still needed"
fi

if [ "$(probe_fixed)" = "supported" ]; then
  ok "capture-then-grep probe detects the flag despite the exit-2 usage path"
else
  bad "capture-then-grep probe failed to detect a flag that is present"
fi

# ── 3. Each probe's captured command guards its own exit status ─────────────
# Every `usage="$(… )"` feeding a probe must carry `|| true`, or `set -e` kills
# the step on the usage path's exit 2 before the grep is ever reached.
for workflow in "${workflows[@]}"; do
  name="$(basename "$workflow")"
  while IFS= read -r line; do
    case "$line" in
      *'|| true)"'*) ;;
      *) bad "${name}: captured probe command does not guard its exit status with \`|| true\`: ${line# }" ;;
    esac
  done < <(grep -E '^\s*usage="\$\(' "$workflow" || true)
  if grep -qE '^\s*usage="\$\(' "$workflow"; then
    ok "${name}: every captured probe command guards its exit status"
  else
    bad "${name}: has no capability probe at all — did one get dropped?"
  fi
done

if [ "$fail" -eq 0 ]; then
  printf '\nAll workflow probe checks passed.\n'
else
  printf '\nWorkflow probe checks FAILED.\n' >&2
fi
exit "$fail"
