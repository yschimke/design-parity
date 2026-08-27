#!/usr/bin/env bash
# Guard the shell in the reusable workflows that `npm test` cannot reach.
#
# Two invariants live here: the capability probes (sections 1-3) and the run
# cache's tool ingredient (section 4).
#
# ── Capability probes ───────────────────────────────────────────────────────
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

# ── 4. The cache key resolves the tool to code, not to a label ──────────────
# The skip decision hashes the ingredients of a parity run, and every other one
# is resolved to content: `path:` parts are git tree hashes, `reference-cache`
# is a head commit, `design-map` and `policy` are file digests. The tool must be
# too. Keyed by the label it was ASKED for, both spellings float — `ref: main`
# names the same thing however far `main` has moved, `version: latest` names the
# same thing across every release — so a genuinely new tool reads as an
# unchanged input and the run re-applies a verdict that tool never produced
# (#380). npm test cannot reach this: it is a `run:` block.
parity="$root/.github/workflows/design-parity-reusable.yml"

if grep -qE 'parts\+=\(--part "tool=\$\{DP_REF' "$parity"; then
  bad "design-parity-reusable.yml: the tool part is the ref/version LABEL — a moved branch or a new \`latest\` hashes as an unchanged ingredient (#380)"
else
  ok "design-parity-reusable.yml: the tool part is not the raw ref/version label"
fi

# Run the workflow's own resolution block rather than a copy of it, so this
# cannot pass against a shape the workflow no longer has.
snippet=""
if start="$(grep -n 'tool="\$(git -C' "$parity" | cut -d: -f1)" && [ -n "$start" ] \
   && end="$(grep -n 'parts+=(--part "tool=\${tool}")' "$parity" | cut -d: -f1)" && [ -n "$end" ]; then
  start=$((start - 1))   # the `if [ -n "${DP_REF:-}" ]` guarding the ref half
  case "$(sed -n "${start}p" "$parity")" in
    *'if [ -n "${DP_REF:-}" ]; then'*) snippet="$(sed -n "${start},${end}p" "$parity")" ;;
    *) bad "design-parity-reusable.yml: the tool resolution is not shaped as \`if [ -n \"\${DP_REF:-}\" ]\` … \`parts+=(--part \"tool=\\\${tool}\")\` — this guard cannot read it" ;;
  esac
else
  bad "design-parity-reusable.yml: found no tool resolution block to check — did it get dropped?"
fi

# $1 ref, $2 version, $3 sha the checkout reports, $4 what `npm view <spec>
# version` answers, $5 what `npm view <pkg> dist-tags.latest` answers ("" = the
# registry does not answer at all). Echoes the resolved `tool=` part; the
# block's own stdout (a warning annotation) lands in $warnings.
warnings="$(mktemp)"
tool_part() {
  local bin part
  bin="$(mktemp -d)"
  cat > "$bin/git" <<EOF
#!/usr/bin/env bash
printf '%s\n' $(printf '%q' "$3")
EOF
  cat > "$bin/npm" <<EOF
#!/usr/bin/env bash
case " \$* " in
  *dist-tags.latest*) [ -n $(printf '%q' "${5:-}") ] || exit 1
                      printf '%s\n' $(printf '%q' "${5:-}") ;;
  *)                  [ -n $(printf '%q' "$4") ] || exit 1
                      printf '%s\n' $(printf '%q' "$4") ;;
esac
EOF
  chmod +x "$bin/git" "$bin/npm"
  part="$(
    set -euo pipefail
    PATH="$bin:$PATH"
    GITHUB_WORKSPACE=/workspace
    DP_REF="$1"
    DP_VERSION="$2"
    parts=()
    eval "$snippet" > "$warnings"
    printf '%s\n' "${parts[1]}"
  )" || part="<the block failed>"
  rm -rf "$bin"
  printf '%s\n' "$part"
}

if [ -n "$snippet" ]; then
  # The #380 sequence: two dispatches naming `main`, with `main` moved between
  # them. Same label, different code — the parts must differ.
  a="$(tool_part main '' 19e51d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa '' '')"
  b="$(tool_part main '' 2b63767bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb '' '')"
  if [ "$a" != "$b" ] && [ "$a" = "tool=19e51d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ]; then
    ok "a ref resolves to the checked-out commit, so a moved branch is a different key"
  else
    bad "a ref does not resolve to the checked-out commit: '${a}' vs '${b}'"
  fi

  # The default. `latest` is a different release either side of a publish.
  a="$(tool_part '' latest '' '"0.1.57"' '"0.1.57"')"
  b="$(tool_part '' latest '' '"0.1.58"' '"0.1.58"')"
  if [ "$a" = "tool=0.1.57" ] && [ "$b" = "tool=0.1.58" ]; then
    ok "a floating version resolves to the published version, so a release is a different key"
  else
    bad "a floating version does not resolve to the published version: '${a}' vs '${b}'"
  fi

  # A range answers with every match, and npm picks from that set the way npx
  # will: the `latest` dist-tag when it satisfies, otherwise the highest.
  a="$(tool_part '' '^0.1.0' '' '["0.1.56","0.1.57","0.1.58"]' '"0.1.58"')"
  if [ "$a" = "tool=0.1.58" ]; then
    ok "a range resolves to the version that would be installed"
  else
    bad "a range does not resolve to the version that would be installed: '${a}'"
  fi

  # A `latest` rolled back below the highest published version — which
  # release.yml deliberately allows, publishing a recovery under `backfill`
  # rather than dragging `latest` forward. npx installs 0.1.43 here, so keying
  # 0.1.45 would name code the run never executed.
  a="$(tool_part '' '^0.1.0' '' '["0.1.43","0.1.44","0.1.45"]' '"0.1.43"')"
  if [ "$a" = "tool=0.1.43" ]; then
    ok "a rolled-back \`latest\` wins over the highest match, as npm's resolver does"
  else
    bad "a rolled-back \`latest\` is ignored, so the key names a version npx would not install: '${a}'"
  fi

  # …but only when it satisfies the range. A `latest` outside it is not a
  # candidate at all, and the highest match is what npx installs.
  a="$(tool_part '' '^0.1.0' '' '["0.1.56","0.1.57"]' '"0.2.0"')"
  if [ "$a" = "tool=0.1.57" ]; then
    ok "a \`latest\` outside the range falls back to the highest match"
  else
    bad "a \`latest\` outside the range was taken anyway: '${a}'"
  fi

  # An unknown version answers on stdout with a JSON error OBJECT, and exits
  # non-zero. Serialising that into the key would be worse than not resolving
  # at all: a multi-line part built from prose.
  a="$(tool_part '' 99.99.99 '' '{"error":{"code":"E404","summary":"No match found for version 99.99.99"}}' '')"
  if [ "$a" = "tool=99.99.99" ]; then
    ok "a registry error object is rejected rather than hashed as the tool"
  else
    bad "a registry error object leaks into the key: '${a}'"
  fi

  # A registry that will not answer must not collapse every version onto one
  # empty part — that would make the key WEAKER than the label it replaced.
  a="$(tool_part '' 0.1.57 '' '' '')"
  if [ "$a" = "tool=0.1.57" ] && grep -q '::warning' "$warnings"; then
    ok "an unreachable registry falls back to the literal version and says so"
  else
    bad "an unreachable registry does not fall back to the literal version: '${a}'"
  fi
fi
rm -f "$warnings"

# ── 5. The tool the key names is the tool the later jobs run ────────────────
# The plan, shard and publish jobs resolve the tool again, in their own steps
# and minutes apart — a checkout of the ref, or an `npx` of the version spec.
# Left on the label, a branch or a dist-tag that moves mid-run renders with one
# tool and publishes with another while the key names a third: the same "the
# label is not the code" failure as #380, one layer down.
downstream="$(grep -c 'ref: ${{ needs.cache.outputs.tool-commit || inputs.design-parity-ref }}' "$parity" || true)"
loose="$(grep -c '^ *ref: ${{ inputs.design-parity-ref }}$' "$parity" || true)"
# One loose checkout is correct and expected: the cache job's own, which is what
# resolves the sha in the first place.
if [ "$downstream" -ge 2 ] && [ "$loose" -le 1 ]; then
  ok "every design-parity checkout after the cache job is pinned to the hashed commit"
else
  bad "a design-parity checkout after the cache job still names the moving ref (pinned=${downstream}, loose=${loose})"
fi

# The published-CLI half of the same thing. Every later job runs `npx
# design-parity@$DP_VERSION` of its own, so a dist-tag that moves mid-run — a
# release landing during a sharded run — installs a different CLI than the one
# the key names.
pinned="$(grep -c 'DP_VERSION: ${{ needs.cache.outputs.tool-version || inputs.design-parity-version }}' "$parity" || true)"
floating="$(grep -c '^ *DP_VERSION: ${{ inputs.design-parity-version }}$' "$parity" || true)"
# Again, one floating use is correct: the cache job's own, which resolves it.
if [ "$pinned" -ge 2 ] && [ "$floating" -le 1 ]; then
  ok "every job after the cache job runs the version it resolved"
else
  bad "a job after the cache job still runs the floating version spec (pinned=${pinned}, floating=${floating})"
fi

for out in tool-commit tool-version; do
  if grep -q "${out}: \${{ steps.decide.outputs.${out} }}" "$parity" \
     && grep -q "echo \"${out}=\${tool}\" >> \"\$GITHUB_OUTPUT\"" "$parity"; then
    ok "the cache job publishes ${out} for those jobs to consume"
  else
    bad "the cache job does not publish ${out}, so the pinned consumers resolve to nothing"
  fi
done

# ── Vendor-drift reporting ──────────────────────────────────────────────────
#
# Same failure shape as the probes above: shell that fails in the *reporting*
# direction, where the wrong answer looks like a working job.
#
# The sync script refuses (exit 3) when a vendored module is gone from upstream
# or the pin is unreachable. That is drift and belongs in the weekly issue. Any
# other non-zero status is a broken job — a missing dependency, a runner
# without git — and must fail loudly instead. Collapsing the two meant a setup
# error opened a drift issue every week claiming the engine had moved on a pin
# that had not, which is how a report stops being read.
drift="$root/.github/workflows/vendor-drift.yml"

# The dependency the sync needs, transitively via `vendor-archive.mjs`.
if grep -q '^      - run: npm ci$' "$drift"; then
  ok "the drift job installs dependencies before invoking the sync"
else
  bad "the drift job never runs npm ci, so the sync dies with ERR_MODULE_NOT_FOUND every run"
fi

if grep -q 'if \[ "\$status" -eq 3 \]' "$drift" && grep -q 'elif \[ "\$status" -ne 0 \]' "$drift"; then
  ok "the drift job separates a refusal from a crash by exit status"
else
  bad "the drift job treats every non-zero status as drift, so a broken job reports a stale pin"
fi

# And the dispatch itself, against stubs — the half a grep cannot check.
dispatch() {
  local status_code="$1" out
  out="$(mktemp)"
  (
    set +e
    sh -c "exit $status_code"
    status=$?
    set -e
    if [ "$status" -eq 3 ]; then
      echo drift
    elif [ "$status" -ne 0 ]; then
      echo failure
    else
      echo clean
    fi
  ) > "$out"
  cat "$out"
  rm -f "$out"
}

for pair in "0:clean" "3:drift" "1:failure" "127:failure"; do
  code="${pair%%:*}"
  want="${pair##*:}"
  got="$(dispatch "$code")"
  if [ "$got" = "$want" ]; then
    ok "sync exit ${code} is reported as ${want}"
  else
    bad "sync exit ${code} reported as ${got}, expected ${want}"
  fi
done

# The script's own refusal code has to match what the workflow tests for. Two
# numbers in two files is exactly the drift this whole subsystem is about.
sync="$root/packages/diff/test/sync-known-differences-vendor.mjs"
if grep -q '^const REFUSED = 3;$' "$sync"; then
  ok "the sync script refuses with the status the workflow expects"
else
  bad "the sync script's refusal code no longer matches the workflow's dispatch"
fi

if [ "$fail" -eq 0 ]; then
  printf '\nAll workflow probe checks passed.\n'
else
  printf '\nWorkflow probe checks FAILED.\n' >&2
fi
exit "$fail"
