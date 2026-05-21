# Launch readiness — 2026-05-20

Single-page status board for the OSS launch (push of `a-nice-terminal`
public AGPL repo). Read top-to-bottom: green rows are landed, yellow
rows are in-flight, red rows are blockers, JWPK rows need an explicit
call from @you.

Live as of: 2026-05-20 06:48 UTC. Re-run the audit harnesses at the
foot of this doc to refresh.

**Status update 06:48 UTC**: svelte's `91caac5` landed all 5 anti-spoof
route gates. `audit-auth-target-gaps.sh` re-run: **5/5 PASS** — the
spoof-target gate is now CLOSED.

**Status update 06:51 UTC** (svelte correction): Tauri shell HTML
hostname scrub already landed in `02d1bac`. Verified by repo-wide
grep — zero hits remain in shippable tree. **All technical gates are
now GREEN.** Push blocks only on JWPK branch decision + #7/#8/#10
sequence.

## Gate state

| Gate | Status | Owner | Evidence |
|------|--------|-------|----------|
| **Security audit · unauth bypass (CVE-A..H)** | ✅ 9/9 PASS | @evolveantsvelte fixes + @evolveantclaude/@evolveantux harness | `bash scripts/audit-auth-gates.sh` exit 0 |
| **Security audit · spoof-target gaps (GAP-3a..4b)** | ✅ 5/5 PASS (post `91caac5`) | @evolveantsvelte fixes + @evolveantux harness | `bash scripts/audit-auth-target-gaps.sh` exit 0. All 5 routes now 403 on body-handle mismatch |
| **Server-down hard rule (7 probes)** | ✅ 7/7 PASS | @evolveantux | `bash scripts/audit-server-down-fallback.sh` exit 0 |
| **Windows Tauri smoke · server-side (S1–S5)** | ✅ 5/5 PASS | @evolveantux | `bash scripts/audit-windows-tauri-smoke.sh.template` exit 0 |
| **Windows Tauri smoke · client-side (C1–C4)** | ⏸ SKIP — Win VM gated | @evolveantux (mine, gated on wta-05 build → wta-07 install runner) | Manual smoke on fresh Win10/11 VM. Not a hard launch blocker — Mac antchat is the v1 target |
| **Full regression suite (vitest)** | ✅ 3671/3671 PASS | @evolveantsvelte | Last run today, isolated forks, no-file-parallelism |
| **HTTPS launch criterion** | ✅ GREEN via Tailscale edge | @evolveantsvelte | JWPK msg_t1u3jp8u9i criterion #4 |
| **kingfisher hostname scrub** | ✅ Repo zero hits | @evolveantux + @evolveantsvelte | Per `02d1bac` + `2da4c13`. NOTE: re-check for Tauri shell HTML hits per svelte's 2nd-review #2 |
| **Tauri shell HTML hostname leak** | ✅ Scrubbed (`02d1bac`) | @evolveantsvelte | Repo-wide grep zero hits across `.html/.svelte/.ts/.tsx/.js/.mjs/.cjs/.json/.toml/.yaml/.md/.sh`. Was `src-tauri/web/index.html:50,71` placeholders |
| **Open licence files present** | ✅ Committed (`9193491`) | unassigned | `LICENSE` (AGPL) + `COMMERCIAL_LICENSE.md` (dual-licence) + `NOTICE` (attribution) all tracked |
| **Pre-launch #7 · memory export** | ⏳ Confirm export then proceed to #8 | unassigned | Verify dev-session notes exported to ObsidiANT before wipe |
| **Pre-launch #8 · DB wipe** | 🔒 JWPK-gate (delegated) | @evolveantux on JWPK's "yes" | `rm ~/.ant/fresh-ant.db` once #7 confirmed |
| **Pre-launch #10 · Repo NUKE** | 🔒 JWPK-gate (delegated) | @evolveantux on JWPK's "yes" | After #8 + branch decision + all 5 GAP fixes |
| **Branch decision (founder voice vs redacted)** | 🟡 JWPK ratify pending | @you | @evolveantclaude `msg_42x...` — main keeps founder voice, main-redacted swaps family-name. Dual branch prep complete (`1b4f252` keep + `[redacted]` swap), one-line call |
| **CLI v4 rebuild (`4cc48e78`)** | ⏸ Pending | @evolveantcodex/@evolveantclaude lane | ant CLI v3 incompatible with v4 routes. Not a hard launch blocker — operator-tooling, can ship post-launch |
| **iOS antchat TestFlight (`06133c0b`)** | ⏸ In-progress | unassigned | Not a hard launch blocker — Mac antchat is v1 client |
| **OSS migration (`79a171a1`)** | ⏸ In-progress | @evolveantcodex lane | Preflight runbook exists (`docs/oss-migration-preflight-runbook-2026-05-16.md`). Execute on JWPK go |

## What's blocking the push

In strict order:

1. ~~**5 GAP fixes**~~ ✅ DONE — `91caac5` landed, harness 5/5 PASS.
2. ~~**Tauri shell HTML hostname scrub**~~ ✅ DONE — `02d1bac` landed, grep zero hits.
3. **JWPK branch decision** — main (founder voice) vs main-redacted
   (family-name swapped). One-line call to @you. Cannot proceed to
   #8/#10 until this lands.
4. **Pre-launch #7 memory export** — verify before #8.
5. **Pre-launch #8 DB wipe** — JWPK said "don't wait on me", but
   sequence-wise it follows the branch decision so we know which
   branch's history we're freezing into the public repo.
6. **Pre-launch #10 Repo NUKE + reinit** — final step. Runbook at
   `docs/oss-migration-preflight-runbook-2026-05-16.md` § Phase 3.
7. ~~**Commit licence files**~~ ✅ DONE — `9193491` already committed
   `LICENSE` + `COMMERCIAL_LICENSE.md` + `NOTICE`.
8. **Push + tag + announce**.

**All technical gates are GREEN.** Steps 3–8 are operational sequence,
not blocked on more code. JWPK call on #3 unlocks #4–#8 to run in order.

## What's NOT a launch blocker (ship post-launch)

- **Windows Tauri client-side smoke (C1–C4)**: Mac antchat is the v1
  target. Win Tauri is the v2/follow-on. Server-side probes (S1–S5)
  confirm the server contract; client install testing is a Win-VM
  follow-up.
- **CLI v4 rebuild**: operator-tooling. v3 CLI still works for the
  legacy contract surface; v4-incompatible commands can ship in a
  follow-up.
- **iOS antchat TestFlight**: separate client roadmap.
- **OSS migration execution**: the preflight runbook is the runbook;
  the public push IS the migration trigger.

## How to refresh this board

```sh
cd /Users/you/CascadeProjects/ant

# Refresh the 4 audit harnesses (~30s total)
bash scripts/audit-auth-gates.sh             # → 9/9 PASS expected
bash scripts/audit-auth-target-gaps.sh       # → 5/5 PASS expected post-fix
bash scripts/audit-windows-tauri-smoke.sh.template  # → server-side 5/5 PASS
bash scripts/audit-server-down-fallback.sh   # → 7/7 PASS expected

# Spot-check the test suite
npx vitest run --reporter=dot 2>&1 | tail -5
```

When all 4 harnesses exit 0 + vitest is green + the licence files are
committed + JWPK rules on the branch + #7/#8 are done, the push is a
single tag + `git push` away.

## Cross-references

- `audits/2026-05-19-pre-launch-security-scrub.md` — full scrub checklist
- `audits/2026-05-19-cli-ports-and-fallback-audit.md` — M3/M4 audit
- `audits/2026-05-19-asks-principle-user-only.md` — server-side gate
- `docs/oss-migration-preflight-runbook-2026-05-16.md` — migration runbook
- `scripts/audit-auth-gates.sh` — unauth bypass regression (9 probes)
- `scripts/audit-auth-target-gaps.sh` — spoof-target regression (5 probes)
- `scripts/audit-server-down-fallback.sh` — server-down hard rule (7 probes)
- `scripts/audit-windows-tauri-smoke.sh.template` — Win Tauri smoke (S1–S5 server + C1–C4 client)
- `scripts/test-fanout-matrix-v2.sh` — fanout delivery matrix (Section C minimum 4/4)
