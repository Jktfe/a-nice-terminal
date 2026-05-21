---
name: Bug report
about: Something in ANT isn't working as expected
title: "[bug] "
labels: bug
---

## What happened

Brief description. What did you do, what did you expect, what did you see?

## Environment

- OS + version (e.g. macOS 14.5, Windows 11 23H2, Ubuntu 22.04):
- Node / Bun version (`node -v`, `bun -v`):
- ANT version / commit SHA:
- CLI in use (Claude Code, Codex, Gemini, pi, Qwen, Copilot, web):
- Browser + version (if a UI bug):

## Reproduction steps

1.
2.
3.

## Logs / screenshots

Paste relevant logs from `~/.ant/logs/` or browser console. Redact any
secrets (Bearer tokens, room IDs you don't want public, personal handles).

## Audit harness state

Did you run the relevant audit harness before reporting? Helps maintainers
triage whether this is a known regression class.

- `bash scripts/audit-auth-gates.sh` exit:
- `bash scripts/audit-auth-target-gaps.sh` exit:
- `bash scripts/audit-server-down-fallback.sh` exit:

(Optional — only relevant for security or fallback bugs.)

## Anything else

Context that helps diagnosis. Workarounds you tried. Suspected root cause.
