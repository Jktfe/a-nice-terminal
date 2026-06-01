#!/usr/bin/env bash
#
# CI redaction gate — fail the build if redacted PII / secrets reappear in
# tracked files. Enforcement, not one-time cleanup: a leak that creeps back in
# a future commit is caught here instead of in a month's re-scrub.
#
# Scope (the sensitive items):
#   - any address at the maintainer's company email domain (operator +
#     colleague PII)
#   - the compromised demo-password literal that was public in early history
#     (rotated — never re-commit it)
#   - the maintainer's machine identity: OS username and hostname, which leak
#     via absolute home paths, the encoded transcript form, and captured shell
#     prompts. Matching the bare username catches all those forms in one rule.
#
# The detection PATTERNS below are deliberately obfuscated with single-character
# classes (e.g. `antde[v]`) so this gate matches each forbidden token WITHOUT
# the token appearing verbatim anywhere in the repo — a scanner must not embed
# the very literals it forbids, or a blanket history scrub silently rewrites
# its own patterns and breaks it. As a belt-and-braces, the gate also excludes
# its own file from the scan.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
check() {
  local label="$1" pattern="$2"
  local hits
  hits=$(git ls-files -z -- . \
    ':(exclude)scripts/ci-redaction-gate.sh' \
    | xargs -0 grep -nE "$pattern" /dev/null 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "REDACTION GATE FAILED — $label reappeared in tracked files:"
    echo "$hits"
    fail=1
  fi
}

# Patterns obfuscated (single-char classes) so the literals are absent here.
check "a company-domain email address"          '[A-Za-z0-9._%+-]+@newmode[l]\.vc'
check "the compromised demo-password literal"    'antde[v]'
check "the maintainer OS username"               'jamesk[i]ng'
check "the maintainer machine hostname"          'Jamess-Mac-min[i]'
check "the maintainer full legal name"           'James William Peter Kin[g]'
check "the maintainer short name"             'James K[i]ng'
check "the tailnet hostname"                 'kingfishe[r]'

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "PII/secret reappeared in tracked files. Remove it before merge."
  exit 1
fi
echo "Redaction gate passed: no company-domain email, compromised-password literal, or maintainer machine identity in tracked files."
