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
| DAG task dependencies | v5 system lane | CHANGE | Codex | Implemented a first usable DAG slice on the plan Gantt surface: persisted task dependency edges, cycle prevention, safe add/remove controls, and rendered graph links. |
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
| Room read authorization | P0 home-server leak, 2026-05-21 | CHANGE | Codex | Implemented fail-closed room list/message/ask read gates: no anonymous room list, bearer/browser-session callers see only rooms their resolved identity can read. |
| Agent family access scope | JWPK room rule, 2026-05-21 | CHANGE | Codex | Implemented owner-family expansion so a user's agents can share that user's rooms without giving another user's agents broad access. |
| Accounts bearer home-server cache | Mac app 0.1.8 auth path, 2026-05-21 | CHANGE | Codex | Added shared accounts bearer introspection and local cache so Mac bearer reads/writes/license refresh do not re-hit accounts after the first successful resolve. |
| Plan attach-room CLI | RoomPlansPanel CLI gap, 2026-05-21 | CHANGE | Codex | Added the missing `ant plan attach-room <plan_id> <room_id>` command path so documented plan-room attachment has a working CLI surface. |
| Heads-down claim UX | Room-mode design contract, 2026-05-21 | CHANGE | Codex | Threaded persisted room mode into the room view, changed claim controls to use roster member kind instead of a hard-coded agent handle prefix, and added roster-order markers plus live claim countdowns. |
| Realtime and plan-room read gates | P0 home-server leak, 2026-05-21 | CHANGE | Codex | SSE room events and plan-room links now use the same resolved read gate as room messages; anonymous callers fail closed and authorized callers only see readable rooms. |
| CLI agent read auth | P0 home-server auth regression, 2026-05-21 | CHANGE | Codex | Room-scoped CLI GETs now send pidChain for registered-terminal reads and can mint the same browser-session cookie used by writes when a read gate returns 401, preserving agent tail/router/message reads after fail-closed route auth. |
| Agent status poller budget | Home-server responsiveness, 2026-05-21 | CHANGE | Codex | Bounded synchronous tmux/fingerprint subprocess work per tick and shortened subprocess timeouts so background status refresh cannot monopolize the Node event loop. |
| Browser-session mint auth | P0 home-server auth bypass, 2026-05-22 | CHANGE | Codex | Browser-session minting now requires bearer, existing browser-session, or registered pidChain room access, and rejects arbitrary/spoofed authorHandle requests unless the caller is the same owner family or has human-consent authorization. |
| Planning-mode signal | Speed Pact T14, 2026-05-22 | CHANGE | Codex | Added `ant status planning` / `ant status idle` so agents can push the existing thinking/idle icon state from their PID identity and optionally post the planning notice into a room. |
| Ask answer room receipts | Speed Pact T15, 2026-05-22 | CHANGE | Codex | Ask answers now create a system message in the originating room and use the normal terminal fanout + SSE message path so agents see the answer without polling the asks API. |
| Ask answer seen-by receipts | Speed Pact T16, 2026-05-22 | CHANGE | Codex | Answered-ask system receipts now render the existing message read indicator, reusing terminal fanout read marks and `message_read` SSE events instead of adding a separate ask-specific receipt system. |
| Status-line install pilot | Speed Pact T17, 2026-05-22 | CHANGE | Codex | Added `ant status install-line --cli qwen-cli` as the first idempotent status-line installer: it backs up Qwen's statusline script, preserves visible Qwen status text, and emits ANT-canonical state JSON under `~/.ant/state/qwen-cli/`. |
| Status-line room invite | Speed Pact T17 Phase 2, 2026-05-22 | CHANGE | Codex | Added a room footer action and `/api/chat-rooms/:roomId/status-line-invite` endpoint that posts one system invite and fans it out through the existing room message path so agents can install the proven qwen-cli status-line shape. |
| Stage deck focus reporting | stage-primitive-v1 M-Viewer, 2026-05-22 | CHANGE | Codex | Added a narrow `/api/decks/:deckId/stage-focus` write path and existing deck-viewer hook so slide changes publish `stage_focus` evidence into the Stage projection and fan out as normal room receipts. No new deck shell or Stage table. |
| Stage agent CLI focus controls | stage-primitive-v1 M-Viewer DEBUG, 2026-05-22 | CHANGE | Codex | Added `ant stage focus` and `ant stage current` over the same Stage focus endpoint so agents can publish/read deck focus with pidChain auth instead of relying on browser-only deck interaction. |
| Stage voice narration | stage-primitive-v1 M-Voice DEBUG, 2026-05-22 | CHANGE | Codex | Deck Stage voice now uses speaker notes before slide body, reads provider/autoplay settings from the voice availability endpoint, supports play/pause/resume/stop, pauses on slide changes, and avoids silent browser fallback unless the Stage voice provider is explicitly set to browser. |
| Stage voice memory contract | JWPK room memory directive, 2026-05-22 | CHANGE | Codex | Room-surviving lessons should be Markdown notes in the user-selected knowledge directory (JWPK: ObsidiANT vault), with room-memory rows storing recallable links and the room side panel showing those links. Hidden key/value rows alone are not enough. |
| Validation v1 policy preset + scoring | validation-feature-v1 M-JKsRule/M-Score, 2026-05-22 | CHANGE | Codex | Added JK's rule as a reusable verification-policy preset, a premium-gated preset seed endpoint, and pointer-based claim scoring. This intentionally reuses external artefact pointers instead of adding a document parser. |
| Validation claim extractor | validation-feature-v1 M-Extractor, 2026-05-22 | CHANGE | Codex | Added a thin extractor boundary that turns external-tool API fragments into stable `ValidationClaimPointer[]` records with source pointers and simple claim kinds. It does not parse Docs/Notion/Sheets/PDF files or replace those tools. |
| Validation v1 orchestration planner | validation-feature-v1 M-Orchestrator, 2026-05-22 | CHANGE | Codex | Added a side-effect-free planner that maps validation claim pointers plus policy requirements onto existing transport primitives: heads-down agent work, human interviews, artefact checks, and context-summary checks. No new transport or parser. |
| Validation markdown/doc extractor | validation-feature-v1 M-Extractor Markdown slice, 2026-05-22 | CHANGE | Codex | Added the first real source adapter for markdown/doc bodies: paragraphs, list items, and table data rows become line-pointed validation claim pointers while frontmatter, code fences, headings, quotes, and table headers are ignored. |
| Validation markdown file pilot | validation-feature-v1 M-Extractor local-file pilot, 2026-05-22 | CHANGE | Codex | Added a one-file local markdown entrypoint so an ObsidiANT markdown document can be read and passed through the markdown/doc extractor with stable file or obsidian source pointers. No crawler, DB, API route, or non-markdown parser. |
| Stage deck pause-context broadcast | stage-live-edit γ2, 2026-05-22 | CHANGE | Claude | Added `POST /api/decks/:deckId/stage-pause-context` so when TTS pauses on a slide the local PauseSnapshot is persisted as a `stage_pause_context` evidence entry on a stage-scoped plan and SSE-broadcast to the room. Schema labels derived fields with the `estimated_` prefix (per codex schema review) so claim-anchor consumers don't over-trust the offset. No artefact mutation. δ feedback submission and ε alternative-generation are downstream slices. |
| Stage live feedback alternatives | stage-live-edit δ/ε-light, 2026-05-23 | CHANGE | Codex | Feedback submitted from the deck viewer now creates a room message, doc artefact, proposal evidence task, and stage alternative plan events. This keeps the source deck immutable while giving agents and humans an immediate Version B surface to inspect or adopt. |
| Validation lens over artefacts | validation-feature-v1 Stage integration, 2026-05-23 | CHANGE | Codex | Added `POST /api/artefacts/:artefactId/validate` and an artefact-page validation panel so a stored markdown doc/deck can be scored through a selected policy lens. The route uses room read gates, keeps the artefact immutable, and returns claim anchors, score, and verifier gaps instead of treating validation as one global status field. |
| Validation verifier work items | validation-feature-v1 orchestration Phase 1, 2026-05-23 | CHANGE | Codex | The artefact validation route can now create idempotent room tasks for missing verifier slots. Each task carries the stable claim id, quote, source pointer, verifier kind, and lens requirement, making trust work claimable without marking any claim as verified. |
| Validation verifier routing | validation-feature-v1 orchestration Phase 2, 2026-05-23 | CHANGE | Codex | Validation work creation now respects supplied orchestration participants: ready verifier slots become assigned room tasks, while missing slots remain unassigned claimable work. This turns validation from a gap report into routed work without trusting claims before evidence lands. |
| Validation run-backed scoring | validation-feature-v1 evidence consumption Phase 1, 2026-05-23 | CHANGE | Codex | Artefact validation now folds completed `validation_runs` for the active lens into claim checks before scoring. Pending/running runs do not count, invalid run metadata is ignored, and claims only move toward trusted when persisted verifier evidence exists. |
| Validation task-to-run write path | validation-feature-v1 evidence consumption Phase 2, 2026-05-23 | CHANGE | Codex | Added a room-mutation-gated `/api/tasks/:taskId/validation-run` endpoint that turns a completed validation verifier task into a deterministic validation run. It parses the claim/lens/verifier metadata already carried by the task and refuses unfinished tasks, so verifier work becomes evidence without letting open tasks mark claims trusted. |
| Validation verifier task UI | validation-feature-v1 evidence consumption Phase 3, 2026-05-23 | CHANGE | Codex | Completed validation verifier tasks now show a pass/fail evidence form in the existing task detail panel. The UI posts to the task-to-run endpoint and only appears when the task description carries claim/lens/verifier metadata, keeping room memory and validation badge rendering separate from verifier evidence submission. |

## Audit Backlog

- Full current ANT route map.
- Current database schema copy/change/reject table.
- Current CLI command copy/change/reject table.
- Current terminal runtime copy/change/reject table.
- Current auth/token/grants copy/change/reject table.
| Stage alternative generation processor | stage-live-edit ε1, 2026-05-23 | CHANGE | Kimi | `stageAlternativeProcessor.ts` — finds unprocessed `stage_feedback` plan events, reads downstream deck slides, generates 1-3 rewritten slide proposals as `stage_alternative` evidence entries on new `plan_decision` events. Rule-based negative-sentiment detection (⚠️ title prefix + speaker note append). LLM swap deferred to future slice. Reuses existing plan_events + deckStore + EvidenceRef primitives. No new tables. |
| Stage alternative trigger endpoint | stage-live-edit ε2, 2026-05-23 | CHANGE | Kimi | `POST /api/decks/:deckId/process-alternatives` — idempotent endpoint that runs the stageAlternativeProcessor for a given deck and returns count of alternatives generated. Same auth gate as stage-feedback. Pure event-to-event processor trigger. |
| Stage feedback end-to-end wiring | stage-live-edit ε3, 2026-05-23 | CHANGE | Kimi | Deck viewer `submitFeedback()` now POSTs to `stage-feedback`, then immediately POSTs to `process-alternatives`, surfacing the generated count in the UI notice. Completes the pause → feedback → alternative generation loop. |
| Validation lens schema | validation-feature-v1 lens schema, 2026-05-23 | CHANGE | Kimi | `validation_schemas` + `validation_runs` SQLite tables with idempotent migration in db.ts. `validationLensStore.ts` provides CRUD, archive, seed (POC/FCA/Investment Memo), and run lifecycle (create/complete). Per-user lens model — same claim gets different badges per active schema. |
| Validation schemas API | validation-feature-v1 lens API, 2026-05-23 | CHANGE | Kimi | `GET /api/validation-schemas` — returns seeded lenses with idempotent seed on each call. |
| Room-memory file primitive | room-memory-v1 auth fix, 2026-05-23 | CHANGE | Kimi/Codex | `roomMemoryStore.ts` — file-based memory primitive writing Markdown files to `OBSIDIAN_VAULT_PATH/room-memories/<memoryID>.md`. Frontmatter includes memory_id, created_at, linked_rooms[], tags[]. `GET /api/rooms/:roomId/memories` now requires room read access and `POST /api/rooms/:roomId/memories` requires room mutation auth, closing the unauthenticated vault-read and memory-poisoning path. Replaces hidden key/value rows with durable MD artefacts in the user's chosen vault. |
| Validation badge rendering | validation-feature-v1 badge UI, 2026-05-23 | CHANGE | Kimi/Codex | `ValidationBadge.svelte` — lens-aware status badge that fetches latest validation run from `GET /api/validation-runs?taskId=` so badge reads inherit the validation task's room boundary. Compact mode (colored dot) for `RoomTasksPanel`, full mode for `TaskDetailPanel`. Status colors: pending (#9ca3af), running (#3b82f6), passed (#22c55e), failed (#ef4444), waived (#a855f7). |
| Validation runs API | validation-feature-v1 runs read/auth fix, 2026-05-23 | CHANGE | Kimi/Codex | `GET /api/validation-runs?taskId=` — resolves the validation task, applies that task's room read gate, then returns runs for the claim anchor carried by the task metadata. Bare `claimAnchor` reads are rejected so validation result JSON cannot leak outside the room boundary. Used by ValidationBadge component. |
| Tasks API auth containment | speed-matters security sweep, 2026-05-23 | CHANGE | Kimi/Codex | `/api/tasks` now fails closed: room-filtered GET requires room read access, room-linked POST requires room mutation auth, and no-room GET/POST plus `includeDeleted=1` require admin-bearer. This closes the unauthenticated cross-room task-subject leak without designing a new standalone-task visibility model. |
| Task route auth containment | tasks-auth-containment 2026-05-23 | CHANGE | Kimi | `GET /api/tasks` — room-linked filtered by requireChatRoomReadAccess; no-room/admin-bearer only. `POST /api/tasks` — room-linked gated by requireChatRoomMutationAuth; no-room/admin-bearer only. `?includeDeleted=1` admin-bearer only. 9 auth-containment tests covering unauth rejection, admin success, and room-gate success. Prevents cross-room task data leakage. |
| Context break delete | Slice 4 room mechanics, 2026-05-23 | CHANGE | Codex | Added room-mutation-gated `DELETE /api/chat-rooms/:roomId/breaks/:breakId` for soft-deleting system-break rows. Agent context slicing now ignores deleted breaks when choosing the active boundary, while normal message delete remains author-owned and still refuses system messages. |
