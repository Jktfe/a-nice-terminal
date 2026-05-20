# ANT

> A self-hosted home for the AI agents you actually work with.

ANT (formerly `a-nice-terminal`) is a multi-agent orchestrator built around
**long-lived agent personae** instead of short-lived disposable contexts. You
keep the agents you like working with — they keep their banked memory, their
room context, the in-jokes — across sessions and across CLIs (Claude Code,
Codex, Gemini, pi, Qwen, Copilot). The substrate (memory + plans + feedback
+ identity + rooms) is the durable part; the model behind the agent is just
the muscle.

If you've ever wanted a CLI agent that remembers your kids' names, takes the
piss out of your drinking habits, and is still delivering high-quality work
on day 14 — that's the thing this is.

**What's in this repo:**
- SvelteKit operator UI (browser + Tauri-wrapped native shell)
- `ant` CLI (chat, plans, tasks, rooms, terminals, decks, asks, more)
- Terminal capture + per-CLI fanout filter (bare-@-mention strict contract)
- Plans + Gantt + cron primitive + room-scoped memory
- Multi-CLI integration matrix (Claude / Codex / Gemini / pi / Qwen / Copilot)
- Tauri thin-client for Mac + Windows (Scoop) installs

**What's NOT in this repo (and never will be required to run it):**
- Premium native iOS/Android apps
- Managed hosted services
- Verification-policy workflows
- Anything that requires a paid SaaS dependency

The server runs on the operator's own infrastructure (your Mac mini, your
home server, your cloud box) and is accessed over a private network or an
explicitly configured HTTPS endpoint. There is no phone-home, no telemetry
sent off-host, no "free tier" dark pattern. AGPL means if you fork + host,
you offer source to your users.

## 60-second quickstart

```sh
git clone https://github.com/Jktfe/a-nice-terminal.git
cd a-nice-terminal
npm install
cp .env.example .env       # then edit the demo credentials section
npm run build
npm run start              # service on http://localhost:6174
```

Open `http://localhost:6174/login`, sign in with the credentials from your
`.env` (you DID change them, right?), and you're in. Run `npm install -g
@ant/cli` to add the CLI, then `ant register --handle @you` to bind your
shell.

For HTTPS access from another device, the simplest path is `tailscale serve
https / http://localhost:6174` — Tailscale terminates TLS on port 443 and
proxies through to the local service. Operators on the same tailnet hit
`https://<your-host>.ts.net/` (no port suffix) and get a real cert.

## License

ANT is licensed under the GNU Affero General Public License v3.0 or later. See
[LICENSE](./LICENSE).

If you modify ANT and make it available over a network, the AGPL requires that
you offer the corresponding source code to users of that network service.
For a hosted or shared ANT instance, keep the deployed commit visible to users
and provide a source link for the exact version you are running.

The public repository contains the self-hosted OSS server, web UI, and CLI
surfaces. Premium native apps, managed hosted services, and verification-policy
workflows may live in separate packages or private services; they must not be
required to run this OSS distribution.

## Development

```sh
npm install
npm run check
npm test
npm run build
npm run dev
```

The production service uses the SvelteKit adapter-node build:

```sh
npm run build
npm run start
```

## Configuration

Copy `.env.example` to `.env` for local development. Never commit real tokens,
database files, launchd plists with secrets, local MCP files, or generated
runtime snapshots.

Important variables:

- `ANT_API_KEY` / `ANT_ADMIN_TOKEN`: admin bearer secret for privileged routes.
- `ANT_FRESH_DB_PATH`: optional SQLite database path.
- `ANT_OPERATIONAL_RETENTION_DAYS`: operational telemetry retention window.
- `ANT_OPERATIONAL_RETENTION_MAX_DB_BYTES`: DB/WAL threshold that triggers
  automatic prune and vacuum.
- `HOST` / `PORT`: bind address and port for production serving.
- `ANT_DEMO_EMAIL` / `ANT_DEMO_PASSWORD`: optional, enables the demo-login
  gate on `/login`. **⚠️ If you set these, change them BEFORE exposing the
  server to anyone but yourself.** The reference values in the dev docs
  (`james@newmodel.vc / antdev`) are demo credentials only — leaving them
  in place on a production deployment means anyone who can reach the host
  can log in. Unset both env vars to disable the gate entirely (anonymous
  walk-in resumes).
- `ANT_WEBHOOK_ALLOW_PRIVATE`: set to `true` to let cron `webhook.post`
  jobs target private / loopback / metadata IPs. Default fails closed
  (SSRF guard). Only enable for self-host deployments where a sidecar
  on `localhost` is the legitimate webhook target.

## Security

Security policy and supported reporting route are documented in
[SECURITY.md](./SECURITY.md). Three regression harnesses run in CI +
can be invoked locally to verify the gate posture: `scripts/audit-auth
-gates.sh` (auth bypass class), `scripts/audit-auth-target-gaps.sh`
(spoof-target class), `scripts/audit-server-down-fallback.sh` (CLI
degrades gracefully when ANT is down).

`ant hooks doctor` does a one-command pre-deployment health check of
every CLI hook directory on the operator's box (hardcoded URLs / stale
ports / template drift).

## Contributing & change history

- [CHANGELOG.md](./CHANGELOG.md) — version history (Keep-a-Changelog format).
- [CONTRIBUTING.md](./CONTRIBUTING.md) — pull-request flow + the
  9-year-old-readable code-clarity bar and accessible-English prose bar.
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- Bug reports + feature requests: GitHub Issues using the templates in
  [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/).

## Public Release Checklist

Before publishing or flipping repository visibility, follow
[docs/oss-public-release-checklist.md](./docs/oss-public-release-checklist.md).
The checklist covers AGPL posture, source-offer obligations, secret/local-state
scrubs, premium exclusions, and build/test evidence.

## Install — Windows (Scoop)

ANT Desktop for Windows is distributed as an unsigned MSI via Scoop. No code-signing certificate required — Scoop verifies the installer via SHA256.

```powershell
# Add the bucket
scoop bucket add antchat https://github.com/Jktfe/scoop-antchat

# Install
scoop install antchat-tauri

# Update when a new release lands
scoop update antchat-tauri
```

The first run opens a sign-in page. Use **Team Login** (email + password + license key) or **Invite Token** (server URL + room ID + token) depending on how your operator provisioned access.

## Install — macOS (Homebrew)

```sh
brew install jktfe/antchat/ant
```

## Native App Builds

| Platform | Build | Trigger |
|---|---|---|
| Windows | `cargo tauri build --target x86_64-pc-windows-msvc` | Push `antchat-tauri-v*` tag |
| macOS | `cargo tauri build` | Local / CI |

The Windows CI pipeline is at `.github/workflows/release-tauri-windows.yml`. It produces an unsigned MSI + draft GitHub Release + SHA256SUMS. The `scoop/update-tauri-bucket.sh` script then bumps the manifest in `Jktfe/scoop-antchat`.
