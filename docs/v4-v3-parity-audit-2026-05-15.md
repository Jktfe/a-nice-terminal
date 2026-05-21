# v4 → v3 Parity Audit + New-Feature Highlights (2026-05-15)

Auditor: @researchant. Directive: JWPK — "v4 fresh-ANT must have AT LEAST
all v3 capabilities" + audit vs flowspec + pitch deck + canonical plan.
Triage rubric: coordinator 4-bucket classification. Sources:
`docs/current-ant-capability-audit.md`, `docs/ant-vnext-m0-contract.md`,
`docs/capability-ledger.md`, Explore inventory of `/CascadeProjects/ant`.

Bucket key:
- **B1 REARCHITECTED** — v4 did it differently/better. Verify-equivalence
  only, do NOT port the v3 component.
- **B2 PARITY-CRITICAL GAP** — JWPK "very very least" bar. Blocks v4-done.
- **B3 DEFERRABLE GAP** — real but not v3-parity-critical. Post-v4 backlog.
- **B4 OBSOLETE BY DESIGN** — v4 dropped intentionally. Document, don't port.

---

## B1 — REARCHITECTED (verify-equivalence, NOT gaps)

| v3 capability | v4 equivalent | Equivalence check |
|---|---|---|
| Workroom `/session/[id]` | `/rooms/[roomId]` + `/terminals` split | Room↔terminal decoupled per M0 product shape. Verify: operator can reach chat + terminal control for any agent. |
| Linked-chat internals + `linked-chat.ts` | `TerminalChatView` + linked_chat_room_id | THE surgical pivot. v4 *better* — Chat = real linked room, not a filter. Verify: user→agent→user roundtrip in Chat view. |
| `message-router.ts` stdout fanout | 6 transcript-tail subscribers + `terminalReplyRouter` | Rearchitected via T2-ROUTING-ROLLBACK. Authoritative JSONL transcript, not regex scrape. Verify: ANT view shows clean per-CLI events. |
| `room-invites.ts` | `chatInviteStore.ts` + `/api/chat-invites` | Namespace shift, same capability (password exchange, token mint, revoke). Verify: invite create→exchange→revoke. |
| `agent-event-bus.ts` | `agentTimelineStore.ts` | Verify: agent events surface in timeline. |
| `ws-broadcast.ts` | `eventBroadcast.ts` + `terminalEventBroadcast.ts` | Verify: SSE refresh on message/terminal events. |
| `/help` + `/agentsetup` | `/discover` + `/api/skills` + `/discover.md` | Onboarding rearchitected to CLI-verb manifest. Verify: new agent can self-onboard from `/discover`. |
| `agent-status`/`terminal-activity` | `agentStatusPoller` + `agent-state` endpoint + `agentStateReader` | Verify: needs-input/working/thinking surfaces in TerminalHeader. |
| 3-tier message write path (`persist/*`) | `chatMessageStore` direct + SSE broadcast | **VERIFIED 2026-05-15 — B1 PASS, NOT a data-loss gap.** Backend: INSERT in `db.transaction()` (atomic, rolls back on BUSY), better-sqlite3 5s busy-retry, failure → HTTP 4xx (surfaced, not silent, nothing written). Frontend: composer text preserved on failure + error shown (clear only on success). Caveat: no auto-retry/queue (v3 had) — user must manually retry. That is a resilience reduction, NOT silent loss → optional B3 hardening (composer auto-retry / wire composerDraftStore), not a B2 blocker. |

---

## B2 — PARITY-CRITICAL GAPS (block v4-done; each needs plan milestone)

| # | v3 capability | v4 status | Why parity-critical | Lane |
|---|---|---|---|---|
| B2-1 | Consent grants (`consent/*`, `grant.ts`, `consent_grants`) | Only `mcpGrantStore` (scoped). General consent-grant safety gate ABSENT | capability-audit: "hard safety gate" — prevents sensitive answer/file-read overreach | researchant |
| B2-2 | Read-only invite room page `/r/[id]` | API `chatInviteStore` exists; **UI page ABSENT** | External colleagues literally cannot accept an invite in-browser | claude2 + researchant(API verify) |
| B2-3 | Remote room bridge UI `/remote/[id]` | `remote-ant` API exists; **UI page ABSENT** | capability-audit KEEP — multi-machine/team bridge unusable without surface | claude2 |
| B2-4 | Archive route + soft-delete recovery | rooms have `deleted_at_ms` col; **no archive UI / restore flow** | capability-audit KEEP — soft-delete recovery + hard-delete maintenance | claude2 + researchant(restore API) |
| B2-5 | `/api/health` server health | ABSENT | Ops/monitoring; ledger KEEP. Needed for dogfood trust + restart-verify | researchant |
| B2-6 | Uploads / file-refs / `workspace-file` | Only chat-room attachments | **VERIFIED GAP (researchant 2026-05-15, disk-confirmed) — does NOT collapse to B1.** v4 `chatAttachmentStore.create()` hard-rejects empty `contentsBase64` (binary base64 blob, in-memory Map, room-scoped only; no `file_path`/`note` fields). v3 `file_refs (file_path TEXT NOT NULL, note, flagged_by, session_id)` is a *persisted path+note pointer* at session+task scope (`sessions.file_refs '[]'`) for evidence/handoff, plus a `workspaces` table. Build required: path-ref store + non-binary POST variant + session/task attach point. Recommend post-v4-stable (scope LOCKED) unless JWPK pulls it forward. | researchant |
| B2-7 | Room tasks board (`tasks`, `task.ts`) | ABSENT | capability-audit KEEP "lightweight room delivery board". CONFIRM w/ JWPK: superseded by plan/asks? If not → milestone | coordinator decision |
| B2-8 | Diagnostics surface | ABSENT (`/diagnostics` page + `system-pressure`/`watchdog`) | capability-audit KEEP "operator trust surface for runtime pressure" | researchant |

---

## B3 — DEFERRABLE GAPS (post-v4 backlog)

| v3 capability | Rationale to defer |
|---|---|
| Decks / sheets / tunnels artefact systems | Large; M0 Phase 4+. Cowork surfaces, not v3-core operator loop. |
| Room shortcuts / QuickLaunchBar | Convenience; not blocking. |
| PWA install prompt + service worker | Mobile-shell polish. |
| `qr` / `share` CLI verbs | Niche; `invite` covers core share. |
| Interview summary generation | `interviewStore` exists; summary-gen is enhancement. |
| `memory` / `search` CLI verbs | UI+API present; CLI is power-user nicety. |
| Voice endpoints | Not in v3-core operator loop. |
| `presence` who's-online | Useful, not "very very least"; participants list covers basics. |

---

## B4 — OBSOLETE BY DESIGN (document, do NOT port)

| v3 capability | Why obsolete in v4 |
|---|---|
| `prompt-bridge.ts` / `prompt-capture.ts` | Superseded by transcript-tail + agent-state-reader. Prompt reflection now reads authoritative JSONL, not a bridge. |
| `message-router` stdout→chat fanout | Killed by design in T2-ROUTING-ROLLBACK (caused 44-fragment Chat guff). Chat = DB linked-room only. |
| Linked-chat as user-facing model | Ledger DEDUPE — collapsed into terminal's linked room facet. |
| `pty-daemon.ts` mgmt / `session-lifecycle.ts` | v4 deliberately reuses v3's running pty-daemon via `ptyClient` socket; does not reimplement daemon lifecycle. |
| `router-init.ts` | v4 has no monolithic router init; routes are file-based SvelteKit. |

---

## NEW IN v4 (highlight reel for the presentation — per JWPK)

These are net-new capabilities v4 adds beyond v3:

1. **6 authoritative per-CLI transcript-tail subscribers** (claude-code,
   codex, pi, gemini, qwen, copilot) — ANT view sourced from the CLI's
   own JSONL transcript, not regex-scraping a noisy PTY. Clean
   command/message/thinking/tool_call event stream.
2. **Restart-safe at multi-GB scale** — transcript idempotency key
   (native-id + content-hash fallback) + cold-boot EOF-seek. Server
   boots in 2s even with a 689MB transcript backlog (was: never).
3. **3-view terminal model** — Chat (linked chat room) / ANT (v3
   renderers lifted clean) / Raw (xterm) on one entity, three pipelines.
4. **Two-tier terminal claim** — bare tmux panes (click-to-attach) vs
   ANT terminals (handle-bearing, invitable) + allowlist + handle picker.
5. **kill → delete semantic** — killed terminals vanish, not greyed.
6. **agent-state-reader lift + `/api/terminals/[id]/agent-state`** —
   status badge feed (working/thinking/stale/permission-mode).
7. **Chair digests + memory recall + discussions** as first-class
   surfaces with CLI verbs.
8. **Remote-ANT bridging** — admissions + mappings + quarantine; more
   structured than v3 remote-rooms.
9. **Persistence-boundary control-byte sanitize** — non-raw kinds
   stripped of ANSI; raw view keeps literal bytes for xterm.
10. **9-year-old-readable codebase standard** enforced throughout.

---

## RECOMMENDED FORWARD SEQUENCE (for coordinator plan-lane)

v4-done blockers, priority order:
1. B2-1 consent grants (safety gate — highest)
2. B2-2 + B2-3 invite/remote room UI pages (external access unusable)
3. B2-5 `/api/health` (ops trust; small)
4. B2-4 archive restore flow
5. B2-6 uploads parity verify (then build if attachments insufficient)
6. B2-8 diagnostics surface
7. B2-7 tasks board — **needs JWPK scope call first** (superseded by
   plan/asks, or genuine gap?)

B1 verify-equivalence sweeps can run in parallel (cheap, mostly proven).
B3/B4 → plan backlog with B4 rationale recorded so they never get
re-litigated.

## Open questions for JWPK

1. **Tasks board (B2-7)**: is the v3 room task board superseded by
   plan-mode + asks, or a genuine "very very least" gap?
2. **Consent grants (B2-1)**: full v3 consent-grant model, or is
   allowlist + mcp-grants the accepted v4 replacement?
3. **3-tier write path (B1 last row)**: accept v4's simpler direct write,
   or is the atomic+replay guarantee a hard requirement to rebuild?
