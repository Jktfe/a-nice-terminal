# Current ANT Capability Audit

Date: 2026-05-11
Auditor: Codex swarm agent Ampere
Scope: `/Users/jamesking/CascadeProjects/a-nice-terminal`

This audit is evidence for vNext parity. It does not mean current ANT
architecture should be copied.

## Routes And Pages

| Capability | Source | vNext | Reason |
|---|---|---|---|
| Dashboard / cockpit | `src/routes/+page.svelte`, `SessionList.svelte` | KEEP | Primary operator entry with sessions, filters, grid, archive strip, create flows. |
| Workroom hub | `src/routes/session/[id]/+page.svelte` | CHANGE | Keep capability, collapse linked-chat model into one workroom with facets. |
| Read-only invite room | `src/routes/r/[id]/+page.svelte` | KEEP | External web access uses password exchange and read-only web token. |
| Remote room bridge UI | `src/routes/remote/[id]/+page.svelte` | KEEP | Multi-machine/team bridge with SSE and composer. |
| Plan view | `src/routes/plan/+page.svelte`, `PlanView.svelte` | KEEP | Event-log plans are core coordination surface. |
| Ask queue | `src/routes/asks/+page.svelte` | KEEP | Global decision/action cockpit is easy to lose. |
| Archive manager | `src/routes/archive/+page.svelte` | KEEP | Soft-delete recovery and hard-delete maintenance. |
| Diagnostics | `src/routes/diagnostics/+page.svelte` | KEEP | Operator trust surface for runtime pressure and endpoint probes. |
| Help / agent setup | `src/routes/help/+page.svelte`, `src/routes/agentsetup/+page.svelte` | KEEP | CLI and driver onboarding must remain in-product. |
| Deck viewer | `src/routes/decks/[slug]/+page.svelte` | KEEP | File editor, audit rail, conflict handling for Open-Slide decks. |
| Internal demo routes | `src/routes/design/+page.svelte`, `src/routes/__comments/*` | DEFER | Useful during build, not first-slice product scope. |

## API Capabilities

| Capability | Source | vNext | Reason |
|---|---|---|---|
| Session CRUD/order/archive | `src/routes/api/sessions/**` | KEEP | Core room/terminal lifecycle, restore, sorting, TTL, long memory. |
| Messages API | `src/routes/api/sessions/[id]/messages/**` | KEEP | History, search, pin, read receipts, replies, delete/edit metadata. |
| Terminal API | `src/routes/api/sessions/[id]/terminal/**` | KEEP | Input, stop, history, events are core runtime control. |
| Participants API | `src/routes/api/sessions/[id]/participants/+server.ts` | KEEP | Membership, handles, focus, removal, terminal add flows. |
| Tasks API | `src/routes/api/sessions/[id]/tasks/**` | KEEP | Room task board with status and assignment lifecycle. |
| Asks API | `src/routes/api/asks/**`, `src/routes/api/sessions/[id]/asks/**` | KEEP | Decision requests, candidate promotion, answers, deletes. |
| Plan events API | `src/routes/api/plan/**`, `src/routes/api/plans/+server.ts` | KEEP | Append/patch event-log model and archived plan listing. |
| Invites/tokens API | `src/routes/api/sessions/[id]/invites/**` | KEEP | Password exchange, token minting, revocation, web/cli/mcp kinds. |
| Consent grants API | `src/routes/api/grants/**`, `src/routes/api/sessions/[id]/grants/**` | KEEP | Time/source-scoped permission grants are a hard safety gate. |
| Artefact APIs | `src/routes/api/decks/**`, `src/routes/api/sheets/**`, `src/routes/api/docs/**`, `src/routes/api/tunnels/**` | KEEP | Deck/sheet/doc/site cowork surfaces with manifest, audit, and file guards. |
| Uploads and file refs | `src/routes/api/upload/+server.ts`, `file-refs`, `workspace-file` | KEEP | Room-scoped file handoff and source references. |
| Remote/MCP room transport | `src/routes/mcp/room/[id]/**`, `api/remote-rooms/**` | KEEP | Thin clients and remote collaboration depend on this. |
| Memory API | `src/routes/api/memories/**` | CHANGE | Keep, but define boundaries against docs/tasks/plans to avoid overlap. |
| Hooks/channel/register | `src/routes/api/hooks/+server.ts`, `channel/register` | KEEP | Shell capture and HTTP fanout are part of the agent substrate. |
| Diagnostics and admin reap | `api/health`, `diagnostics/system-pressure`, `admin/reap-tmux` | KEEP | Recovery from runtime pressure and orphan tmux state. |

## CLI Capabilities

| Capability | Source | vNext | Reason |
|---|---|---|---|
| Full `ant` CLI | `cli/index.ts`, `cli/commands/*.ts` | KEEP | Power-user and agent interface mirrors server capabilities. |
| Sessions/terminal/chat/msg | `sessions.ts`, `terminal.ts`, `chat.ts`, `msg.ts` | KEEP | Core operator loop. |
| Ask/task/plan/grant | `ask.ts`, `task.ts`, `plan.ts`, `grant.ts` | KEEP | Delivery coordination primitives. |
| Artefact commands | `deck.ts`, `sheet.ts`, `doc.ts`, `tunnel.ts`, `flag.ts`, `share.ts` | KEEP | Cowork/edit/evidence flows are bigger than chat. |
| Runtime/admin commands | `hooks.ts`, `register.ts`, `agents.ts`, `prompt.ts`, `evidence.ts` | KEEP | Identity, capture, prompt bridge, screenshots, baselines. |
| Memory/search/skill/qr | `memory.ts`, `search.ts`, `skill.ts`, `qr.ts` | CHANGE | Keep, but rationalise overlap with docs/help/onboarding. |
| Thin `antchat` client | `antchat/index.ts`, `antchat/commands/*` | KEEP | External colleague UX: join, rooms, msg, chat, tasks, plan, web, MCP. |
| `antchat export` placeholder | `antchat/index.ts` | REJECT | Explicitly not wired; do not rebuild until scoped. |

## Terminal And Runtime

| Capability | Source | vNext | Reason |
|---|---|---|---|
| PTY daemon/client | `src/lib/server/pty-daemon.ts`, `pty-client.ts` | KEEP | Live terminal orchestration base layer. |
| tmux control events | `terminal/events`, `terminal_events`, `terminal.ts` | KEEP | Structured runtime state, layout, pause/continue, exits. |
| Terminal transcripts/history | `terminal_transcripts`, `terminal/history` | KEEP | Durable terminal replay/search/evidence. |
| Plain-text PTY injection | `message-router.ts`, `adapters/pty-injection-adapter.ts` | KEEP | Load-bearing cross-driver input contract. |
| Agent status/activity | `agent-status`, `terminal-activity`, `api/sessions/[id]/status` | KEEP | Needs-input/working/thinking/stale drives attention routing. |
| Prompt bridge | `prompt-bridge.ts`, `api/prompt-bridge/**` | KEEP | Approval/response injection for pending agent prompts. |
| Capture/run events | `capture/*`, `run-events`, `command_events` | KEEP | Trust-tiered evidence and command blocks. |
| Global singleton pattern | `db.ts`, `ws-broadcast.ts`, `router-init.ts` | CHANGE | Keep the duplicate-runtime lesson; rebuild with explicit vNext boundaries. |

## Chat And Message Features

| Capability | Source | vNext | Reason |
|---|---|---|---|
| Three-tier message write path | `src/lib/persist/*`, `processor/*` | KEEP | Atomic DB write plus replayable side effects prevents lost posts. |
| Broadcast replay states | `messages.broadcast_state`, `broadcast-queue.ts` | KEEP | Pending/done/failed/expired lifecycle is resilience. |
| Mention routing semantics | `message-router.ts` | KEEP | Bare `@handle`, broadcast, and bracketed handles differ intentionally. |
| Focus mode and digest | `message-router.ts`, `chat_focus_queue` | KEEP | Reduces interruption while preserving summaries. |
| Linked chat internals | `linked-chat.ts`, `adapters/linked-chat-adapter.ts` | DEDUPE | Keep privately, remove as user-facing model. |
| Message search/read/pin/reply | `messages/search`, `MessageBubble.svelte`, `ChatMessages.svelte` | KEEP | Small features users immediately miss. |
| `/break` context divider | `CHAT-BREAK.md`, `BreakConfirmModal.svelte` | KEEP | Unique context-control primitive. |
| Interviews | `interviews.ts`, `InterviewModal.svelte`, `api/interviews/**` | KEEP | Human clarification flow with transcript and summary. |

## Plans, Tasks, Docs, And Artefacts

| Capability | Source | vNext | Reason |
|---|---|---|---|
| Event-log plans | `plan-events.ts`, `api/plan/**`, `PlanView.svelte` | KEEP | Plan state should remain append-only and auditable. |
| Room tasks | `tasks` table, `TaskCard.svelte`, `task.ts` | KEEP | Lightweight room delivery board. |
| Research docs | `api/docs/**`, `doc.ts` | KEEP | Shared planning docs with Obsidian mirror. |
| Decks | `decks.ts`, `api/decks/**`, `deck.ts` | KEEP | Manifest, audit log, guarded file editing. |
| Sheets | `sheets.ts`, `api/sheets/**`, `sheet.ts` | KEEP | Deck-pattern parity for spreadsheet cowork. |
| Tunnels/sites | `tunnels.ts`, `api/tunnels/**`, `tunnel.ts` | KEEP | Room-visible local prototype URLs. |
| Uploads/file refs | `uploads`, `file_refs`, `FileRefCard.svelte` | KEEP | Evidence and handoff path for agents. |

## Auth, Invites, And Grants

| Capability | Source | vNext | Reason |
|---|---|---|---|
| Master vs room-scoped auth | `src/hooks.server.ts`, `room-scope.ts` | KEEP | Prevents room tokens becoming admin tokens. |
| Token kinds `cli/mcp/web` | `room-invites.ts`, `room-scope.ts` | KEEP | Write-capable vs read-only access is load-bearing. |
| Invite password exchange | `room-invites.ts`, `invites/*/exchange` | KEEP | Password-gated token minting with failed-attempt revoke. |
| Token/invite revocation | `invites/[inviteId]/**` | KEEP | Device-level and invite-level blast-radius controls. |
| Tailscale-only mode | `hooks.server.ts`, `docs/security-model.md` | KEEP | Shared repo mode depends on network boundary. |
| Consent grants | `consent/*`, `consent_grants`, `grant.ts` | KEEP | Prevents sensitive answer/file-read overreach. |
| Identity registration | `terminal_identity_roots`, `register.ts` | KEEP | PID-tree identity removes repeated manual headers. |

## Settings, Shortcuts, Mobile

| Capability | Source | vNext | Reason |
|---|---|---|---|
| Personal settings | `api/personal-settings`, `PersonalSettingsModal.svelte` | KEEP | Local operator preferences should not be hardcoded. |
| Room shortcuts | `api/room-shortcuts`, `RoomShortcutsBar.svelte`, `QuickLaunchBar.svelte` | KEEP | Fast repeated commands matter for agents/operators. |
| CLI config/token store | `cli/lib/config.ts`, `antchat` shared config | KEEP | `ant` and `antchat` interoperability depends on shared shape. |
| Theme/nocturne tokens | `theme.ts`, `nocturne.ts`, `app.css` | CHANGE | Keep the lesson; simplify into vNext design system. |
| Native prompt/confirm debt | plan/archive browser prompts | REJECT | Replace with product modals/sheets for mobile/PWA reliability. |
| PWA manifest/service worker | `static/manifest.webmanifest`, `static/sw.js` | KEEP | Installable shell with network-only API traffic. |
| Install prompt | `PwaInstallPrompt.svelte`, `+layout.svelte` | KEEP | Browser install affordance. |
| Safe-area/visual viewport vars | `src/app.html`, `src/lib/utils/viewport.ts`, `app.css` | KEEP | iOS keyboard/safe-area stability. |
| Mobile workroom gestures/panels | `session/[id]/+page.svelte`, `ChatSidePanel.svelte` | CHANGE | Keep behavior, redesign as explicit sheets/rails. |
| PWA-safe break modal | `BreakConfirmModal.svelte` | KEEP | Native dialogs fail in standalone iOS PWA. |
| Mobile performance guards | `stores/messages.svelte.ts`, mobile recovery docs | KEEP | Bounded load and reduced polling are easy to regress. |

