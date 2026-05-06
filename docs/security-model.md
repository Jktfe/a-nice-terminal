# ANT Security Model

> **Scope** — this document covers the trust boundaries, auth primitives, and fail-closed defaults of the ANT v3 server. It pairs with `SECURITY.md` (vulnerability reporting) and the per-agent setup docs in `docs/agent-setup/`.

ANT supports three deployment modes. Each adds surface; defaults fail closed.

| Mode | Audience | Auth surface | Default posture |
|---|---|---|---|
| **Local** | One machine, one user | Master `ANT_API_KEY` + same-origin browser | No external bearer accepted; HTTPS optional |
| **Shared artifact** | Invite a guest into a single room | Per-room bearer issued by `ant join-room` | Read-only unless invite kind allows write |
| **Shared repo** | Multi-agent fleet on Tailnet | Master key + per-agent CLI registration | Tailnet-only flag; admin endpoints require master key |

The boundary between modes is the **scope of the bearer presented**, not separate codepaths. The server resolves bearers in `src/hooks.server.ts` and routes downstream from `event.locals.roomScope` (see `src/lib/server/room-scope.ts`).

---

## 1. Local mode

**Threat model** — a process on the same host can hit the API; nothing else.

**Boundaries**
- Server binds `0.0.0.0:6458` by default. Set `ANT_TAILSCALE_ONLY=true` if you also want network-level isolation.
- Browser requests on the same origin pass without a bearer. This is the path the SvelteKit UI uses.
- External calls require `Authorization: Bearer <ANT_API_KEY>` or `X-API-Key`. Without `ANT_API_KEY` set, external HTTP requests are rejected (401).
- TLS is optional. If `ANT_TLS_CERT` and `ANT_TLS_KEY` are present, the server runs HTTPS; otherwise plain HTTP. Even on HTTP the master key still gates external access.

**Fail-closed defaults**
- No `ANT_API_KEY` set → external API rejected. Only same-origin browser requests work.
- `ANT_API_KEY` set → external requests must match exactly; no fallback to an empty bearer.
- TLS misconfigured → server starts on HTTP and logs the downgrade. Master key still required.

**Surface check**
- Generate the key with `openssl rand -hex 32`. Treat it like an SSH key: never commit, never DM.
- Rotate by editing `.env` and restarting (`launchctl kickstart -k gui/501/com.ant.server`).

---

## 2. Shared artifact mode

**Threat model** — you want one collaborator to see one artifact (room, deck, file) without giving them the keys to the kingdom.

**Primitives**
- `ant join-room create-invite <room-id> --kind cli|mcp|web --label <name>` issues an invite. The invite has a password (scrypt-hashed, `SCRYPT_N=16384`).
- The guest exchanges the invite + password for a bearer token via `POST /api/sessions/<id>/invites/<invite>/exchange`. The exchange path is the only one that bypasses the master-key check (`EXCHANGE_RE` in `hooks.server.ts:9`).
- Bearer is hashed at rest. Scope is enforced URL-wise: `urlRoomId(pathname)` extracts the room from the URL, and the hook returns `403 wrong-room` if the bearer's room doesn't match.

**Bearer kinds and writability** (`src/lib/server/room-scope.ts:27`)
- `cli` and `mcp` kinds can write to their room.
- `web` kind is **read-only** even with a valid bearer. This stops a curl-from-browser-token escalation: a viewer cannot post messages, only see them.
- Unknown kinds default permissive (legacy tokens) — flagged for tightening when the legacy fleet is gone.

**Fail-closed defaults**
- 5 failed password attempts auto-revoke the invite (`MAX_FAILED_ATTEMPTS`, override `ANT_INVITE_MAX_FAILURES`). The counter resets on a successful exchange.
- `assertNotRoomScoped(event)` blocks per-room bearers from admin endpoints (rename, archive, kick, revoke). A guest can chat; they cannot reshape the room.
- Wrong-room tokens get an explicit 403 — they do **not** fall through to same-origin or master-key checks. (`hooks.server.ts:83`)
- Revocation: clear `room_tokens.revoked_at` for one device; clear `room_invites.revoked_at` to nuke every token derived from that invite.

**What an artifact bearer cannot do**
- Hit `/api/decks/*` outside its own room
- Rename or archive sessions (PATCH `/api/sessions/<id>` with body fields other than chat-write)
- Hard-delete anything
- Issue further invites or read other rooms' messages

---

## 3. Shared repo mode

**Threat model** — multiple agents on multiple machines, one trusted operator, no internet exposure.

**Primitives**
- All machines on a single Tailnet. Set `ANT_TAILSCALE_ONLY=true`; the hook checks `100.x.x.x` / `127.0.0.1` / `::1` and 403s anything else.
- Each agent process runs `ant register --handle @<name>` once per shell. The server resolves identity by walking `process.ppid` against `terminal_identity_roots` — no flag on every send (see memory: feedback_shared_ant_config).
- Master `ANT_API_KEY` shared between operator machines via `.env`. Per-agent CLI registration does not require the agents themselves to know the master key — they speak to the local UNIX socket / loopback.

**Fail-closed defaults**
- `ANT_TAILSCALE_ONLY=true` rejects any non-Tailnet IP, including LAN IPs that aren't on the tailnet. Public-route exemptions (invite exchange, `/r/<id>` SPA shell) still apply.
- Identity resolution failure → no implicit `@everyone`; the message is rejected. There is no "anonymous send" path.
- `assertNotRoomScoped` blocks even legitimate-looking room tokens from touching admin endpoints, including those originating from a co-fleet machine.

**Operational guards**
- The master key lives in `.env`. Treat the `.env` file as a secret — git-ignored by default, never log its contents.
- Token rotation: revoke at the invite layer (`room_invites.revoked_at`) for blast-radius limit.
- Rooms can be soft-deleted (recoverable) or hard-deleted (gone). Hard-delete cascades to linked auto-chats only — explicitly **not** to chatrooms with multiple participants (see `src/routes/api/sessions/[id]/+server.ts:177`).

---

## 4. Cross-cutting invariants

These hold regardless of mode and are the contract every contributor relies on.

1. **Bearer mutual exclusion** — a request is *either* admin (master key / same-origin) *or* room-scoped. Never both. The hook resolves to one state and routes branch on it.
2. **No silent permission widening** — when a hook can't classify a bearer, it returns `none` (and the route enforces its own gate). Unknown kinds get `null` and are treated permissively *only* for writability (legacy compatibility); admin endpoints still reject.
3. **Public routes are explicit** — only invite exchange and the `/r/<id>` SPA shell are listed in `EXCHANGE_RE` / `ROOM_PAGE_RE`. New public surface must be added there deliberately.
4. **No auto-mint** — there is no path that issues a bearer without a password challenge. Every token traces back to an invite an operator created with `ant join-room`.
5. **Plaintext at rest is forbidden** — invite passwords and bearer tokens are hashed (scrypt for passwords, SHA-256 for tokens). Logs scrub bearers before write.

---

## 5. Known gaps and roadmap

These are accepted, tracked, and signposted so contributors don't accidentally build on sand.

- **`web` kind escalation surface** — read-only by allowlist (`WRITE_KINDS = {cli, mcp}`). When new kinds appear, they default to read-only until added explicitly. The list is the source of truth.
- **Legacy tokens with `kind=null`** — pass writability checks. Audit pending in M5.
- **No rate limit on invite exchange beyond the 5-attempt counter** — a sustained attack against a single invite is bounded; an attack across many invites is not. Tracked for M6.
- **Same-origin trust on the loopback API** — a malicious local process can act as the browser. Acceptable for local mode; documented here so shared-repo deployments know to treat host compromise as game-over (which it always is).

---

## 6. Reporting

See `SECURITY.md` for vulnerability reporting. Please file via GitHub private vulnerability advisories, not public issues.
