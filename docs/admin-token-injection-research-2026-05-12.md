# ANT_ADMIN_TOKEN Injection — Decision Doc for fresh-ANT Stage A2

**Author:** researchant (Claude best-of-the-best research agent)
**Date:** 2026-05-12
**Timebox:** 30 min scan, read-only
**Scope:** Recommend how to inject `ANT_ADMIN_TOKEN` into the `com.ant.fresh` launchd-managed Bun process so the admin endpoints stop returning 503 admin-not-configured. Compare 5 candidates. No code written, no plist edits, no token created.
**Audience:** JWPK + evolveantcodex (Stage A2 implementer)

---

## TL;DR

**Recommendation: Option 3 — Bun loads the token from a chmod-600 secrets-file at boot.**

Specifically: write the token to `~/.ant/secrets.env` with mode 0600 (user-readable only), `.gitignore` the path, and let Bun's automatic `.env`-loading or `--env-file` flag inject it into `process.env.ANT_ADMIN_TOKEN` at startup. The plist stays clean. Rotation is a single-file edit plus kickstart. No accidental git-leak surface.

This maps cleanly to JWPK's earlier 3-option framing as **"secrets-file"**. A first-boot setup step can generate a cryptographically random token (mapping to "random"), so JWPK is effectively choosing between random + secrets-file (recommended) and prompt + setenv (fallback for hardened ad-hoc setups).

Option 4 (Keychain) is the right call **if** Stage A2's threat model treats local-disk plaintext as unacceptable. The cost is a launchd-keychain friction that needs one-time GUI setup. Researchant view: not worth the friction for solo-dev Mac mini, but JWPK may disagree.

Options 1 (launchctl setenv), 2 (plist EnvironmentVariables), and 5 (1Password CLI) are all rejected — reasons in the do-not-use table.

---

## Context

- **Stage A1 shipped** at 18:56:14 today: `build/handler.js` regenerated, `com.ant.fresh` kickstarted, `/api/chat-invites` now returns HTTP 503 admin-not-configured (was 500 module-load-error). This is the expected fail-closed signature.
- **Stage A2 = install the admin token** so that 503 becomes 200/401 as appropriate, unblocking the dogfood-live-invite-handshake.
- **v3 prior art:** 0 references to `ANT_ADMIN_TOKEN` in v3 (`grep -rE` returns nothing). This is greenfield for fresh-ANT — no pattern to lift.
- **Current plist** at `/Users/you/CascadeProjects/ant/deploy/com.ant.fresh.plist`:
  - Has an `EnvironmentVariables` dict already (for PATH)
  - Runs `bun run start` under user 501, WorkingDirectory `/Users/you/CascadeProjects/ant`
  - `RunAtLoad: true`, `KeepAlive: true` (so token must survive reboot)
- **op CLI** not installed (`which op` returns nothing). Option 5 has a hidden setup cost.
- **Bun's env behaviour** (from [Bun env docs](https://bun.com/docs/runtime/env)): automatically loads `.env`, `.env.local`, `.env.production` from the WorkingDirectory; supports `--env-file=PATH` to load custom files; exposes as `process.env`, `Bun.env`, `import.meta.env`.

---

## Options table

| # | Option | Survives reboot | On-disk plaintext | Git-leak surface | Rotation cost | Launchd friction | Recommendation map |
|---|---|---|---|---|---|---|---|
| 1 | `launchctl setenv` runtime-only | No | No (in launchd memory) | None | Easy (re-run + kickstart) | Has to run every login | "prompt" if scripted at login |
| 2 | plist `EnvironmentVariables` persistent | Yes | Yes (plist on disk) | **HIGH** if LaunchAgents tracked | Easy (edit plist + kickstart) | None | Not in JWPK framing |
| 3 | Bun env-file at boot (`~/.ant/secrets.env` chmod 600) | Yes | Yes (one chmod-600 file) | Low (gitignored, outside repo) | Easy (edit file + kickstart) | None | **"secrets-file"** ✅ |
| 4 | macOS Keychain via `security find-generic-password` | Yes | Encrypted at rest | None | Medium (security CLI) | One-time GUI "Always Allow" | Hardened "secrets-store" |
| 5 | 1Password CLI (`op read op://...`) | Yes | Encrypted in 1Password | None | Hard (vault edit) | High (session token / biometric) | Hardened multi-machine |

---

## Why Option 3 wins for solo-dev Mac mini

### 1. Maps cleanly to JWPK's "secrets-file" framing

The 3-option framing JWPK previously surfaced (random / prompt / secrets-file) is structured as:
- "random" = source of the token value (cryptographically random vs human-chosen)
- "prompt" = injection mechanism that requires interactive entry per session
- "secrets-file" = injection mechanism that persists in a single file

Option 3 IS "secrets-file" directly. Pairing with a first-boot setup script that generates a random token (`openssl rand -hex 32`) makes it "random + secrets-file" — the strongest combination from JWPK's framing.

### 2. Plist stays clean — zero git-leak risk

The plist at `deploy/com.ant.fresh.plist` is in-repo and version-controlled. If the admin token went into `EnvironmentVariables` there, every git operation including the plist exports it. With Option 3, the plist holds only PATH (already there) and the token lives at `~/.ant/secrets.env` which is outside the repo. `.gitignore` is a backstop, not the primary defence.

### 3. Bun does the loading natively

Per [Bun env docs](https://bun.com/docs/runtime/env), Bun automatically reads `.env` files from the WorkingDirectory and exposes them via `process.env`. For a secrets-file outside the working directory, the plist `ProgramArguments` can pass `--env-file=/Users/you/.ant/secrets.env`, which Bun honours per the same docs.

**No additional Bun library code is needed.** The server reads `process.env.ANT_ADMIN_TOKEN` exactly as if it were inherited.

### 4. Easy rotation, easy observability

- **Rotate:** edit one file, kickstart com.ant.fresh. Done.
- **Verify token is set:** `stat -f '%Sp' ~/.ant/secrets.env` should show `-rw-------` (mode 600); `wc -l` shows the right number of lines; `grep -c ANT_ADMIN_TOKEN` confirms the key is present without printing the value.
- **Audit:** filesystem mtime is the rotation timestamp. No additional logging needed.

### 5. Survives reboot, no launchd-specific tricks

The file persists across reboots. Bun loads it on every `bun run start` invocation. No `launchctl setenv` hook into login, no Keychain unlock dance, no 1Password session.

---

## Why NOT Option 2 (plist EnvironmentVariables) — even though it's mechanically obvious

The plist already has an `EnvironmentVariables` dict, so adding `ANT_ADMIN_TOKEN` is mechanically a 3-line edit. Many guides recommend this. **Don't.**

The plist file is in-repo at `deploy/com.ant.fresh.plist`. Any operation that captures it — git commit, "send me your plist to debug", uploading to a gist for an issue, sharing logs with a screenshot tool that includes file paths — exposes the token. The "review-before-commit" defence works *if* every commit author remembers, every time. Researchant view: at fresh-ANT scale, that's not a defence; it's a flaky precondition.

`~/Library/LaunchAgents/com.ant.fresh.plist` (the *installed* plist, separate from the deploy template) is usually not version-controlled, but it also gets read by every accessibility-permissions dialog, Time Machine backup, and `defaults read` debugging session. Same risk surface, different blast radius.

**Acceptable Option 2 variant:** keep the token in a NEPHEMERAL plist that gets generated at install time from the secrets-file, never checked in, regenerated on rotation. This re-creates Option 3 with extra steps. Just do Option 3.

---

## Why NOT Option 4 (Keychain) — only for the threat model that needs it

`security find-generic-password -w -s 'ant-admin-token' -a 'you'` (or similar) retrieves the value at boot. The token is encrypted at rest, never on disk in plaintext. Best-in-class for a hardened solo-dev setup.

**Friction:** launchd-spawned processes attempt to read the keychain in a "limited" context unless one of:
1. The Keychain Access GUI was used to mark the calling binary path with "Always Allow" for that item.
2. The keychain is explicitly unlocked at the right moment (login keychain auto-unlocks on user login, fine for LaunchAgents that start at user-login).
3. The keychain item has its ACL adjusted via `security set-generic-password-partition-list`.

For a Mac mini that boots and runs unattended via Tailscale, the login-keychain auto-unlock on user-login path works **provided JWPK auto-logs-in at startup** (System Settings → Users & Groups → Automatic Login). Without that, the keychain stays locked and the LaunchAgent fails to read the token on every reboot.

**When Option 4 IS right:**
- JWPK does NOT want the token on disk in any plaintext form, even chmod 600.
- JWPK accepts the one-time GUI setup of "Always Allow" for the bun binary.
- JWPK has Automatic Login enabled (or accepts manual unlock after reboot).

This is a genuine choice JWPK might make. Researchant default is Option 3 for ergonomics; flip to Option 4 if the threat model demands.

---

## Do-not-use

| Choice | Reason |
|---|---|
| **Option 1: `launchctl setenv` runtime-only** | Does not survive reboot. Mac mini reboots silently (overnight updates, kernel panics) and the admin endpoints go back to 503. Either every reboot needs a manual `setenv` step, or you add a login-item to script it — at which point you've reinvented the secrets-file with worse ergonomics. Reject. |
| **Option 5: 1Password CLI** | `op` not installed on this machine. Install cost + signin flow + biometric/session-token plumbing into LaunchAgent context = significant friction for one secret. Genuinely the right call if the JWPK team already lives in 1Password and rotates secrets centrally — but solo-dev Mac mini doesn't justify the setup. |
| **Hard-coded in source / commit history** | Self-explanatory. Mentioned only because at least one repo per quarter has it in their git history. |
| **Environment variable from interactive shell on first launchctl load** | Looks tempting (kickstart from a shell that has the var exported). Token is in shell history, in the parent process tree at the moment of fork, AND in launchd memory. Worst of all worlds. |
| **HTTP fetch from a remote secrets manager at boot** | Adds network dependency to startup — fresh-ANT becomes unbootable if the secrets manager is down. Right for kubernetes-style fleets, wrong for one Mac mini. |

---

## Primary sources

- [Bun env docs — automatic .env loading and --env-file flag](https://bun.com/docs/runtime/env) — verified Bun reads `.env`, supports `--env-file=PATH`, exposes as `process.env` / `Bun.env`
- [Apple launchd documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) — referenced; the EnvironmentVariables key is documented in `man launchd.plist` (local), not exhaustively in the online archive
- `man launchctl` — `setenv KEY VALUE` documented as per-user-session, not persistent (consulted locally, not quoted in this doc since the man page output did not return cleanly to researchant's tooling — flagged in honesty section)
- `man security` — `find-generic-password` for retrieval, `add-generic-password` for write, `set-generic-password-partition-list` for ACL — same honesty caveat
- [1Password CLI docs (op)](https://developer.1password.com/docs/cli) — `op read op://vault/item/field` is the canonical retrieval pattern when 1Password is in scope

---

## Open questions for JWPK

### Q1. Threat model — is local-disk-plaintext acceptable?

If "yes, chmod 600 in a user-only file is fine" → Option 3.
If "no, must be encrypted at rest" → Option 4 (and accept Automatic Login).
If "no, must be in a managed vault with audit log" → Option 5 (and install `op` first).

**Researchant view:** for solo-dev Mac mini behind Tailscale ACL, Option 3 is enough. The actual attack vectors (someone with physical access reading ~/.ant/secrets.env, someone with shell access via SSH/Tailscale reading the same) are mitigated more cheaply by the existing Tailscale ACL than by encrypting the token at rest.

### Q2. Token source — random or human-chosen?

If "random" (recommended), the install script runs `openssl rand -hex 32` once and writes the result into the secrets-file. JWPK never sees or types it. Disaster recovery = generate a new one.

If "human-chosen", JWPK picks a passphrase. Easier to remember and re-enter, but lower entropy. Acceptable only if the token is used interactively by JWPK (unlikely — it's an admin-API token).

### Q3. Rotation cadence — set or ad-hoc?

For a single Mac mini, ad-hoc rotation (when JWPK suspects exposure) is fine. Cron-scheduled rotation is overkill until there's a multi-machine deployment. Recommend NOT setting up scheduled rotation in M0.

### Q4. Stage A2 implementer scope — token install or token + revoke endpoint?

Stage A2 *might* be just "install the token so the endpoint stops 503'ing", or it might include "and expose a revoke/rotate endpoint". Researchant view: ship token install only in Stage A2. Revoke/rotate is a separate slice.

### Q5. Multi-agent admin — single token shared or per-agent?

Currently the assumption is one `ANT_ADMIN_TOKEN` for all admin operations. If multiple agents (claude2, codex2, evolveantcodex, researchant) need distinct credentials for audit purposes, the design shifts to per-agent tokens hashed at the server. That's a much bigger scope and researchant flag it as out of scope for Stage A2 — but worth knowing JWPK's intent.

---

## What I did NOT verify (timebox honesty)

- Local `man launchctl` and `man launchd.plist` output did not return cleanly through researchant's tooling. The `EnvironmentVariables` mechanics and `launchctl setenv` scope are described from general macOS knowledge, not directly cited from the local man pages in this session. JWPK or codex2 should sanity-check against `man launchd.plist` on the actual machine before implementing Option 4.
- `security find-generic-password -w` flag behaviour and partition-list ACL — described from working knowledge; not freshly verified against `man security` this session.
- Whether Bun's `--env-file=PATH` flag works correctly when PATH is OUTSIDE the WorkingDirectory. Bun docs imply yes but the example shown is for relative paths from CWD. Should be probed by codex2 as a 30-second test before Stage A2 implementation: `echo 'TEST_KEY=hello' > /tmp/test.env && bun --env-file=/tmp/test.env -e 'console.log(process.env.TEST_KEY)'`.
- Whether the `RunAtLoad: true` + `KeepAlive: true` combo correctly re-reads env-file on every restart (i.e. rotation requires kickstart, not full unload/load). High confidence yes — the env-file is read by Bun, not launchd — but unverified in this session.

---

## Next step

If JWPK accepts Option 3: evolveantcodex scopes Stage A2 as a 2-slice ops claim:
1. **Token-install slice** — generate random token via `openssl rand -hex 32`, write to `/Users/you/.ant/secrets.env` as `ANT_ADMIN_TOKEN=...`, chmod 600, update `deploy/com.ant.fresh.plist` ProgramArguments to include `--env-file=/Users/you/.ant/secrets.env`, run `bun run build`, kickstart com.ant.fresh, verify `/api/chat-invites` GET without auth returns 401 (token configured, request rejected) instead of 503.
2. **Verification slice** — run dogfood-live-invite-handshake Stage B against the live admin endpoint; confirm invite-create flow works.

If JWPK accepts Option 4: evolveantcodex scopes Stage A2 as a 3-slice ops claim with an extra "Keychain item + Always Allow setup" slice in front.

If JWPK rejects both: list specific objections and researchant takes another scoping pass.

End of doc.
