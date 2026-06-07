#!/usr/bin/env bash
#
# deploy-green-gate.sh — the green-gate between a commit and the live site.
#
# Born from the 2026-06-07 mobile firefight: a git merge-conflict marker
# (<<<<<<< HEAD) committed/left in SimplePageShell.svelte put a full-screen
# Vite 500 error overlay on JWPK's phone — because we were editing the SERVED
# checkout directly, so every broken-compile moment reached production. This
# gate makes "broken artifact reaches the live site" a checked invariant
# instead of a human-discipline hope.
#
# Run it BEFORE every `launchctl kickstart` of com.ant.dev:
#   scripts/deploy-green-gate.sh <commit-ish>
#
# It refuses (non-zero exit) if:
#   1. the target tree contains git conflict markers,
#   2. svelte-check reports any error,
#   3. (after kickstart, optional --live) the live routes 500 instead of 200.
#
# Exit 0 = safe to advance the served checkout to <commit-ish> + kickstart.

set -euo pipefail

TARGET="${1:-HEAD}"
LIVE_BASE="${ANT_LIVE_BASE:-http://127.0.0.1:6176}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Node 22 toolchain (matches the better-sqlite3 native build NODE_MODULE_VERSION).
export PATH="/Users/jamesking/.nvm/versions/node/v22.22.1/bin:$PATH"

fail() { echo "❌ GREEN-GATE FAIL: $*" >&2; exit 1; }
ok()   { echo "✅ $*"; }

# ── 1. Conflict markers ─────────────────────────────────────────────────
# The exact class that crashed the live site. Scan the committed tree at
# TARGET (not just the working dir) so a bad merge can't slip through.
echo "── 1/3  conflict-marker scan @ ${TARGET} ──"
markers="$(git grep -nE '^(<<<<<<< |>>>>>>> |={7}$)' "$TARGET" -- 'src/**/*.svelte' 'src/**/*.ts' 'src/**/*.css' 2>/dev/null || true)"
if [ -n "$markers" ]; then
  echo "$markers" >&2
  fail "git conflict markers present in ${TARGET} — this is exactly what 500'd the live site."
fi
ok "no conflict markers"

# ── 2. Compile (svelte-check, errors only) ──────────────────────────────
echo "── 2/3  svelte-check (errors) ──"
node node_modules/.bin/svelte-kit sync >/dev/null 2>&1 || true
if ! node node_modules/.bin/svelte-check --threshold error >/tmp/ant-green-gate-check.log 2>&1; then
  tail -25 /tmp/ant-green-gate-check.log >&2
  fail "svelte-check reported errors — would not compile clean on the live site."
fi
ok "svelte-check clean (0 errors)"

# ── 3. Live route health (optional, post-kickstart) ─────────────────────
# Pass --live to verify the running server actually serves 200s (not a Vite
# error overlay) on the routes JWPK hits. Run this AFTER the kickstart.
if [ "${2:-}" = "--live" ]; then
  echo "── 3/3  live route health @ ${LIVE_BASE} ──"
  for path in "/login" "/rooms"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${LIVE_BASE}${path}")"
    [ "$code" = "200" ] || fail "${path} returned ${code} (expected 200) — live site is not green."
    ok "${path} → 200"
  done
else
  echo "── 3/3  live route health — skipped (pass --live after kickstart) ──"
fi

echo ""
ok "GREEN-GATE PASS — safe to advance served checkout to ${TARGET} + kickstart."
