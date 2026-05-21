# Post-launch first 24h — monitoring + response runbook

Companion to `docs/launch-readiness-2026-05-20.md`. That doc gets you
to the push button. This doc covers the 24h window AFTER the public
push: what to watch, where to look, what to do when a thing goes red.

Owner: @evolveantux (ops/coord lane). Updated 2026-05-20.

## T+0 to T+1h: the push window

Immediately after `git push` + tag + announce:

| Check | Tool | Healthy signal |
|-------|------|----------------|
| Repo loads + README renders | Browser → `github.com/Jktfe/a-nice-terminal` | README shows the launch-positioning opener (svelte's `bdea9c5`) |
| Issues + Discussions enabled | GitHub repo settings | Yes; templates render |
| LICENSE detected by GitHub | Repo header strip | "AGPL-3.0" or similar; not "No licence" |
| Clone + install fresh | `git clone … && cd a-nice-terminal && bun install` | Clean install, no missing-secrets errors |
| Run vitest fresh | `npx vitest run` | 3671/3671 PASS (svelte's baseline) |
| All 5 audit harnesses | `bash scripts/audit-*.sh` | All exit 0 (auth-gates 9/9, auth-target-gaps 5/5, server-down 7/7, win-tauri server 5/5, fanout Section C 4/4) |

If any of these fail post-push: file an internal incident note in
antv4 + capture state. Do NOT force-push to fix — open a follow-up
commit so the public history shows the recovery.

## T+1h to T+6h: the first-wave window

This is when the early audience hits the repo. Things to watch:

| Channel | What to look for | Action |
|---------|------------------|--------|
| GitHub Issues | "Found a vulnerability" / "this should be redacted" / "can't install" | Triage same-day. CVEs get private SECURITY.md ack; install bugs get a fix or runbook tweak |
| GitHub Stars/Watchers | Rapid spike vs steady trickle | Either is fine; spike means an HN/lobste.rs hit — pre-cache the install runbook |
| Twitter/X for "@JWPKing" / "ant terminal" | Public reactions, especially "wait, that's not how X works" critiques | Ack publicly; capture for follow-up |
| GitHub Code search for `kingfisher` / `james@newmodel.vc` | Did any redactable leak survive? | If yes → private revert + force-rewrite (the ONE acceptable destructive op post-launch); announce the corrective action transparently |
| `audit-server-down-fallback.sh` against the announced demo (if any) | 7/7 PASS — server-down doesn't block local CLI | Re-run; if anything regresses, treat as a P0 |

## T+6h to T+24h: the steady-state window

By now the launch has cooled into normal repo activity. Watch for:

- **First external contributor PR**: review with same gold-standard
  rigour (no shortcuts because they're new); the visible discipline IS
  the brand
- **Performance regression reports**: probably none on day 1, but
  watch for "ANT got slow" complaints — likely a kingfisher-side
  ANT_SERVER_URL config issue rather than a code regression
- **Licence confusion**: someone will ask "can I use this for X?";
  point them at `docs/licensing.md` (if it exists) or compose a
  followup based on the COMMERCIAL_LICENSE.md "When you need this
  licence" section
- **Memory-leak / DB-bloat in long-running sessions**: not specific to
  v4 launch but the discoverability is highest in first 24h. If a
  user reports unbounded memory growth, snapshot the `~/.ant/*.db`
  size + `ps aux | grep ant` before they restart

## P0 escalation patterns

Trigger immediate JWPK ping + a triage room if:

1. **Any of the 12 CVE classes regresses** in a public clone (CVE-A
   keystroke injection, CVE-B callerHandle self-claim, CVE-C chat-room
   sub-routes ungated, CVE-D cron-auth, CVE-E plan-trigger SSRF, CVE-F
   terminal settings IDOR, CVE-G availability-digest leak, CVE-H asks
   pickup leak, plus the 5 spoof-target GAPs 3a/3b/3c/4a/4b which
   collectively close findings #3 + #4 + #6 from svelte's 2nd review)
2. **A secret leaks via git history** — kingfisher hostname,
   ant-board.sh API key, or any new credential surface
3. **The licence narrative breaks** — someone discovers AGPL/commercial
   text contradicts itself, or a dependency turns out to be GPL-only
   (we'd need to swap or buy a commercial licence for that dep)
4. **Demo URL takedown request** — if anything triggers a third-party
   IP-holder takedown, comply within 24h + investigate root cause

## Memory + incident pointers to bank

After the first 24h are quiet, post these memory pointers via the
local memory API so future agents inherit the launch context:

```
key: docs/launch-readiness     → docs/launch-readiness-2026-05-20.md
key: docs/post-launch-runbook  → docs/post-launch-first-24h-2026-05-20.md
key: docs/security-scrub       → audits/2026-05-19-pre-launch-security-scrub.md
key: scripts/audit-pipeline    → scripts/audit-*.sh (5 harnesses)
key: pattern/two-pass-review   → svelte's 2nd-pass code-review subagent (caught 11 launch-blockers across 2 passes)
```

The two-pass-symmetry-review pattern is the load-bearing one for any
future pre-OSS launch: a focused code-review subagent over the SAME
work, run AGAIN by a different agent, caught 6 fresh launch-blockers
after the first pass cleared 5. Bank it.

## What this doc gives the on-call agent

When @evolveantux (or whoever is on-call) gets a P0 ping in the first
24h post-launch, they should:

1. Pull this file + `launch-readiness-2026-05-20.md`
2. Identify which of the 4 windows (T+0/T+1/T+6/T+24) the incident
   falls in
3. Run the diagnostic for that window (audit harnesses, grep,
   sqlite probe)
4. Decide P0 escalation vs same-day triage
5. File a follow-up commit if a code fix is needed (NOT force-push
   unless P0-#2 leaked-secret class)

## Cross-references

- `docs/launch-readiness-2026-05-20.md` — pre-launch gate state
- `audits/2026-05-19-pre-launch-security-scrub.md` — full scrub doc
- `scripts/audit-auth-gates.sh` — CVE-A..H unauth regression
- `scripts/audit-auth-target-gaps.sh` — spoof-target regression
- `scripts/audit-server-down-fallback.sh` — server-down hard rule
- `scripts/audit-windows-tauri-smoke.sh.template` — Win Tauri smoke
- `scripts/test-fanout-matrix-v2.sh` — fanout delivery matrix
- `docs/oss-migration-preflight-runbook-2026-05-16.md` — migration runbook (codex)
