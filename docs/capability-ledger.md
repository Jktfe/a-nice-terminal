# ANT vNext Capability Ledger

Date: 2026-05-11
Owner: @evolveantcodex

Rule: no capability disappears silently. It can be redesigned, deduped,
deferred, or rejected with a reason, but it cannot vanish.

## Status Values

| Status | Meaning |
|---|---|
| KEEP | Rebuild the capability with the same behavior. |
| CHANGE | Rebuild the capability with different UX or architecture. |
| DEDUPE | Merge the capability into another surface. |
| DEFER | Keep it in scope, but not in the current phase. |
| REJECT | Remove it with a written reason. |
| UNKNOWN | Audit still required. |

## Source Buckets

| Bucket | Source | Treatment |
|---|---|---|
| V5 atlas | `antv5-wireframes.pen` | Binding product checklist. |
| Audit blockers | GLM/Kimi/Codex/Claude v5 audit | Must be represented in a board or ledger row. |
| Current ANT | `/Users/jamesking/CascadeProjects/a-nice-terminal` | Evidence only. Audit before copying. |
| External references | Product references such as Claude Code agent view | Benchmark patterns, not scope pivots. |

## M0 Coverage Rows

| Capability | Source | Initial status | Owner | Notes |
|---|---|---:|---|---|
| Start a chatroom | v5 chat/room lane | CHANGE | Claude | First vertical slice starts here, not from terminal. |
| Invite existing agent | v5 chat/room lane | CHANGE | Claude | Must include existing and new agent paths. |
| Invite new agent | v5 chat/room lane | CHANGE | Claude | Must show launch, handle, and room context. |
| Remote invite to room | v5 system lane | CHANGE | Codex | Keep security boundary explicit. |
| Participants list | v5 chat/room lane | CHANGE | Claude | Participants talk; features serve. |
| Change participant handle | v5 chat/room lane | CHANGE | Claude | Needs visible rename history. |
| Focus mode | v5 chat/room lane | CHANGE | Claude | Must not hide accountability. |
| Link discussions | v5 chat/room lane | DEDUPE | Claude | Discussion is a room facet, not a separate destination. |
| Artefact rail | v5 chat/room lane | CHANGE | Claude | Decks, docs, sheets, files, and sites share the rail. |
| Plans and tasks | v5 system lane | CHANGE | Codex | Plan is scoreboard, tasks are ownership and review. |
| Shared docs | v5 chat/room lane | CHANGE | Claude | Room-facing durable synthesis. |
| Memory recall | v5 chat/room lane | CHANGE | Claude | Searchable context, not a dumping ground. |
| Navigate to other chats | v5 chat/room lane | CHANGE | Claude | Command palette and room switcher. |
| Upload pictures and files | audit blockers | CHANGE | Claude | Include drag/drop, picker, errors, policy, and mobile. |
| Break context | v5 chat/room lane | CHANGE | Claude | Breaks are first-class context boundaries. |
| Rename session | audit blockers | CHANGE | Codex | Session PATCH and visible rename history. |
| Search messages | v5 chat/room lane | CHANGE | Claude | Per-room first, global search later if productized. |
| Linked terminal | v5 terminal lane | CHANGE | Codex | Show linked chat, ANT terminal, and Raw terminal. |
| Bring agent up to speed | v5 terminal lane | CHANGE | Codex | Context packet must be inspectable. |
| Change folder | v5 terminal lane | CHANGE | Codex | Easy `cd` without hiding command truth. |
| Spawn agent in another terminal | v5 terminal lane | CHANGE | Codex | Human approves crossing terminal boundary. |
| SSH / local tmux toggle | v5 terminal lane | CHANGE | Codex | Same UX, different runtime boundary. |
| WezTerm / chat toggle | v5 terminal lane | CHANGE | Codex | Confirm exact product name during audit. |
| Keyboard shortcuts | v5 system lane | CHANGE | Codex | Discoverable and editable. |
| Grid / multi-window view | v5 system lane | CHANGE | Codex | Must be recoverable if layout breaks. |
| Message popups | audit blockers | CHANGE | Codex | Toasts and notification settings. |
| Replies | v5 chat/room lane | CHANGE | Claude | Reply polish: sender, quote, auto-mention. |
| Interviews | v5 interview lane | CHANGE | Claude | Ask for context, options, chat escalation. |
| Play / pause / speaker mode | v5 interview lane | CHANGE | Claude | Voice state visible and controllable. |
| Read receipts | audit blockers | CHANGE | Claude | Zero-token receipt model. |
| Reactions | audit blockers | CHANGE | Claude | Thumbs up/down plus mobile target. |
| Typing indicator | audit blockers | CHANGE | Claude | Stale timeout visible. |
| Draft persistence | audit blockers | CHANGE | Claude | Never lose typed text. |
| Consent grants | audit blockers | CHANGE | Codex | Lane A implemented general room grants with topic/source/duration/max-answer gate, audit trail, and ask-answer enforcement. |
| Archive recovery surface | audit blockers | CHANGE | Codex | Lane A implemented `/safety` recovery surface for archived rooms/plans plus explicit soft-delete boundaries. |
| Agent telemetry | audit blockers | KEEP | Codex | User-facing status, not debug soup. Wired up agent status (idle/thinking/working/response-required) directly to SQLite terminals + chat_agent_status_events tables, bypassing fingerprinting! |
| Sheets artefacts | audit blockers | CHANGE | Codex | Trust model and audit rail. |
| Plan event editing | audit blockers | CHANGE | Codex | Inline or modal, but explicit. |
| Agent session overview | Claude Code agent view, 2026-05-11 | KEEP | Codex | Borrowed good parts: status pills in Svelte room footers + fleet grid wired to SQLite. Bypasses stdout fingerprinting via direct script-based state updates. |
| Multi-model routing and cost savings | Current ANT agent mix and James product direction | CHANGE | Codex | Different models behave differently and cost differently. vNext must make Claude, Codex, Gemini, Qwen, Copilot, Pi, GLM, Kimi, and future agents first-class participants instead of forcing one vendor path. |
| Model routing preferences | Router-not-viewer stance | CHANGE | Claude/Codex | Users need defaults by task type plus override controls. Agent rows need model, cost tier, and tokens consumed this session. |
| Session tracker agent | James product direction | CHANGE | Codex | A cheap always-on tracker can watch sessions, cost, stale working states, decisions, and completions, then escalate only the prepared item. |

## Audit Backlog

- Full current ANT route map.
- Current database schema copy/change/reject table.
- Current CLI command copy/change/reject table.
- Current terminal runtime copy/change/reject table.
- Current auth/token/grants copy/change/reject table.
