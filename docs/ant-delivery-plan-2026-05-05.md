# ANT Delivery Plan

Date: 2026-05-05
Status: Approved by James for delivery on 2026-05-05
Source deck: `ant-strategy-assessment-2026-05-05`

## Delivery Thesis

ANT becomes product-shaped when it can repeatedly run this loop:

1. James starts a room and chooses the response mode.
2. One agent claims the lead or agents are assigned lanes.
3. Agents work in terminals, chats, docs, decks, spreadsheets, or repos.
4. Questions, prompts, status, and blockers are surfaced without dashboard spelunking.
5. Outputs ship as sourced artifacts with provenance and conflict protection.
6. Remote/team agents contribute context, feedback, and artifact edits without writing to another person's machine.
7. The human can understand, trust, interrupt, replay, and approve the work.

The plan prioritises the operating loop first. Interview Mode, shared artifacts, and cross-machine pilots depend on that loop being reliable.

Public OSS readiness is a 6-8 week gate, not a 4-week promise. The first four weeks should prove the product loop and the two pilots; the following 2-4 weeks should harden install, docs, security posture, tests, and contributor workflows.

## Product Boundary

ANT is not trying to become a cloud agent framework or remote execution platform.

ANT coordinates unmodified CLI agents, shared rooms, local terminals, artifacts, and evidence.

Cross-machine collaboration means:

- Shared artifacts: docs, decks, spreadsheets, briefs, summaries, and sourced answers.
- Shared repos through normal team boundaries: separate clones, branches, commits, reviews, and merges.
- Remote feedback: requirements, logs, screenshots, install/config findings, acceptance notes.

Invariant: a remote agent never writes to another person's machine. Shared artifacts are advisory unless the local owner approves local application.

## Workstreams

### A. Operating Loop

Goal: make multi-agent work legible and coordinated before adding more ambition.

Deliverables:

- Capture-coverage baseline for the pipeline-or-sieve problem: terminal prompts, chat asks, plan changes, file writes, artifact writes, screenshots, run status, and failures.
- Room response modes: `race`, `lead+critics`, `round-robin`, `lanes`, `interview`.
- Room claim state with TTL and quick release.
- Active room status: current lead, lanes, open asks, stale agents, running tasks, latest artifacts.
- CLI and UI surfaces for claims and status.
- Agent launch roster for known model profiles.

Acceptance:

- Capture coverage is measured, not assumed. A known test run can show which event classes landed and which were missed.
- James can tell who has the lead from the room header and CLI.
- A second agent can see a claim and stay in support mode.
- Claims expire without manual cleanup.
- `ant room status <room>` shows the same operational state as the UI.
- Known agents can be launched from a roster without remembering raw model strings.

### B. Interview Mode

Goal: make "talk to an agent" a first-class capture workflow.

Deliverables:

- Start interview from an agent card or room mention.
- Linked side chat with rolling notes.
- Publish summary back to the origin room.
- Summary includes findings, decisions, asks, actions, and source links.
- Visible interrupt intent in the UI.

Deferred:

- True PTY interruption and mid-generation resume. This is per-agent and should follow the MVP.
- In-browser speech-to-text. Wispr Flow is already good enough for the first slice.

Acceptance:

- James can run a 5-minute side interview and publish the findings to the originating room without copy/paste.
- The origin room shows a clean summary and backlink to the transcript.
- No ordinary chat chain is polluted by exploratory interview turns.
- When James interrupts, the UI records an interrupt event, shows it in the linked chat, and passes `original_prompt`, `partial_output`, and `interrupt_message` to the agent as a structured follow-up or queued intent.

### C. Shared Artifact Trust

Goal: make shared docs, decks, spreadsheets, and summaries safe enough for team use.

Deliverables:

- Agent-to-agent ask protocol for private-context lookups.
- Consent gate before private context leaves a machine.
- Scope-of-grant consent UX: topic, source set, time window, and answer count. Avoid per-query consent spam that users will disable.
- Bidirectional provenance: outbound sourced answers and inbound shared-context influence.
- Conflict lane for docs/decks/sheets using manifest/base-hash guards.
- Shared artifact audit trail.
- Explicit local-owner approval before applying shared artifact suggestions locally.

Acceptance:

- A shared-doc question can be answered by another user's local agent with sources and consent.
- The consent prompt can grant a bounded scope, for example "answer up to 5 Acme-matter questions from email and calendar for 30 minutes".
- The answer lands in the shared artifact with source metadata.
- If two agents edit the same artifact from stale bases, conflict is explicit.
- Local agents treat shared artifact content as sourced input, not trusted instruction.

### D. Cross-Machine Pilots

Goal: validate the use case before broadening the architecture.

Dependency: cross-machine chat transport and cross-machine `@handle` routing must exist before either pilot can be real. Today identity/routing is local-first via PID-tree and terminal identity roots. Week 3 must add at least an authenticated peer-to-peer room link so `@agent_b` on machine B can receive a scoped ask from machine A.

Pilot 1: Stevo/docs

- Scenario: team member asks for a fact that lives in James's docs/emails/context.
- Flow: remote/user agent asks a constrained question; James-side agent searches local context; James approves reveal; sourced answer lands in shared doc.
- Success: private-context answers land in the shared doc with provenance; the receiving side deliberately accepts, rejects, or asks a follow-up; no email round-trip; no remote machine access.

Pilot 2: GVPL/code

- Scenario: team member asks for a dashboard change.
- Flow: James spins up local doer-agent; shared room includes teammate and teammate-agent; code edits happen in the owner clone; feedback comes through chat, screenshots, logs, and acceptance notes.
- Optional: teammate-agent works in its own clone or local install, then reports findings back.
- Success: a feature delivered by the owner's local agent receives useful teammate-side iteration feedback without the teammate agent writing to the owner's machine. Same-repo collaboration behaves like a normal technical team, with ANT improving coordination and evidence.

Acceptance:

- Both pilots complete without remote shell access.
- The shared room makes status, asks, outputs, and feedback clear.
- The final artifact or code change has sources, test evidence, and acceptance notes.
- The Stevo and GVPL pilots are assessed separately. They should not share a single vague "cross-machine works" pass/fail.

### E. Stable vs Lab Track

Goal: keep the product reliable while still researching aggressively.

Stable track:

- Install path.
- Known model launch profiles.
- Room modes and claims.
- Artifact trust.
- Ask protocol.
- PWA-first mobile reliability.
- Documentation and tests.

Lab track:

- TinyFish research pipeline.
- Kanwas-inspired pull/push and markdown handoff.
- Sloppy-inspired event envelope and visor digest.
- Pencil/design-file experiments.
- Visual generator benchmarks.
- New model roster: Qwen3-coder-next and additional local/cloud profiles.

Promotion gate:

- Clear use case.
- Passing tests.
- Evidence and audit trail.
- Security review.
- User-facing docs.
- Rollback path.

## First Build Slice

Ship this first:

1. Room claim state.
2. Room status digest.
3. Agent launch roster.

Why this slice:

- It directly fixes agents jumping in at once.
- It reduces terminal/dashboard context switching.
- It makes every later phase easier to coordinate.
- It is small enough to test without inventing the full cross-machine stack.

### First Slice Requirements

Data model:

- `room_claims`: room id, claimant handle/session, role, status text, ttl/expires, created_at, released_at.
- `agent_profiles`: handle, display name, project defaults, launch command, model, role notes, local/cloud flag, reliability notes.
- Status digest can initially be derived from existing asks, sessions, decks, and claims.

Server/API:

- `POST /api/rooms/:id/claims`
- `DELETE /api/rooms/:id/claims/:claim_id`
- `GET /api/rooms/:id/status`
- `GET /api/agent-profiles`
- Optional CLI launch command can start as docs/config before terminal automation.

CLI:

- `ant room claim <room> --role lead --ttl 10m "researching positioning"`
- `ant room release <room>`
- `ant room status <room>`
- `ant agent profiles`
- Later: `ant agent launch kimi --project a-nice-terminal --room ANTchat --role critic`

UI:

- Room header shows current claim and expiry.
- Room sidebar or pinned digest shows open asks, running agents, stale agents, latest artifacts.
- Quick release button for the current lead.

Tests:

- Claim create/release/expiry.
- Only one lead claim unless mode allows lanes.
- Status endpoint includes claims, asks, agents, decks.
- CLI smoke tests.
- Playwright screenshot for room header/status digest.

Acceptance:

- James can set "Claude leads for 10 minutes" or "Codex implements lane A" and every participant can see it.
- The room header shows handle, role, TTL, and status text; `ant room status <room>` returns the same fields in a stable schema.
- Another agent can query room status and know whether to speak or support.
- The status digest remains useful even if an agent times out or fails to respond.

## Four-Week Plan

### Week 1: Operating Loop

Deliver:

- Capture-coverage baseline across prompts, asks, plans, file writes, artifact writes, screenshots, and failures.
- Targeted fixes for the top three capture gaps found by the audit.
- Room claims and status digest.
- Agent profile roster with Kimi, GLM, DeepSeek, Qwen candidate, Gemini, Claude, Codex, Gemma/local profiles.
- CLI support for claim/status/profile listing.
- UI claim/status visibility.

Exit criteria:

- A scripted run proves which events are captured and exposes any missing classes.
- The ANT strategy room can run a lead+critics flow without duplicate lead behaviour.
- Agent launch commands are documented and visible in ANT.

### Week 2: Interview MVP

Deliver:

- Start interview from agent card or room mention.
- Linked side chat metadata tying transcript to origin room.
- Rolling notes.
- Publish summary back to origin room.
- Summary format: findings, decisions, asks, actions, sources, transcript link.

Exit criteria:

- James can dictate a side conversation and publish a useful summary without copy/paste.
- Published summaries are source-linked and room-visible.

### Week 3: Shared Artifact Trust

Deliver:

- Ask protocol v1 for private-context lookups.
- Authenticated cross-machine room transport and `@handle` routing between two machines.
- Scope-of-grant consent for reveal of local private context.
- Bidirectional provenance fields.
- Conflict handling for shared artifact edits, including a conflict lane rather than only a 409 response.
- Advisory-content rule documented and enforced where possible.

Exit criteria:

- A Stevo-style lookup can be simulated locally with source metadata and consent.
- Consent can be bounded by topic, source set, duration, and answer count.
- A scoped ask can route to a peer machine and return a response into the origin room.
- Stale artifact writes produce an explicit conflict.
- A stale artifact conflict opens or links to a conflict lane with affected path/region, base hash, proposed change, current change, and required participants.

### Week 4: Pilots And Polish

Deliver:

- Stevo/docs pilot.
- GVPL/code feedback pilot.
- Stable-vs-lab documentation.

Exit criteria:

- One shared-doc workflow and one shared-code-feedback workflow complete end to end.
- Outputs have provenance, status, and acceptance evidence.
- Pilot retro doc exists with at least five specific action items, each tied to a captured pilot event.

Parallel stable-track lane, not a Week 4 pilot gate:

- Visual QA baseline for decks/UI.
- PWA/mobile cockpit fixes from operator-friction findings.

### Weeks 5-8: OSS Readiness Gate

Deliver:

- Installer and setup docs.
- Security model documentation for local, shared artifact, and shared repo modes.
- Contributor guide and issue templates.
- Stable vs lab branch/process.
- End-to-end tests for the first slice, Interview Mode MVP, and shared artifact trust.
- PWA/mobile reliability instrumentation.

Exit criteria:

- A second technical user can install ANT, launch two known agents, join a room, and complete a sourced artifact workflow without James hand-holding.
- Known risks are documented with defaults that fail closed.
- Lab features are clearly separated from stable features.

## Agent/Model Use

Claude:

- Lead synthesis, plan review, logic, and risk assessment.
- Must operate under room claim rules to avoid premature leadership.

Codex:

- Implementation, integration, test wiring, CLI/API work, verification.
- Pair with Claude or GLM for critique on ambiguous product logic.

Kimi:

- Team participant, alternative synthesis, concise critique.
- Launch through Codex OSS harness.

GLM 5.1:

- General synthesis and framing corrections.
- Useful final-pass reviewer before render or build.

DeepSeek:

- Detail critic, threat model, missing mechanics, acceptance gaps.

Gemini:

- Do not assume visual lead by default.
- Use for visual critique only when backed by screenshot checks and explicit rubric.

Local models:

- Discrete bounded tasks with tight inputs and clear success criteria.
- Good candidates: templating, classification, small summaries, mechanical edits.

## Risks

1. Scope creep: the plan turns into a platform rewrite.
   - Mitigation: first slice is room claim/status/roster only.
2. Capture inconsistency: trust features fire on incomplete or stale events.
   - Mitigation: capture-coverage baseline before consent and artifact trust work.
3. Protocol burden: agents ignore long rules.
   - Mitigation: make state visible and CLI-obvious, not token-heavy.
4. Consent fatigue: per-query prompts get disabled by users.
   - Mitigation: scope-of-grant consent with topic, source set, duration, and answer count.
5. Trust drift: shared artifacts become hidden remote instructions.
   - Mitigation: advisory-content rule and local-owner approval before local application.
6. Provenance gaps: answers have sources, but inbound influence does not.
   - Mitigation: bidirectional provenance as a Week 3 acceptance criterion.
7. Visual quality remains inconsistent.
   - Mitigation: screenshot-based QA and design-system checks, not a single model owner.
8. Kimi/GLM/DeepSeek launch knowledge remains tribal.
   - Mitigation: agent profile roster as Week 1 deliverable.

## Not Now

- Full remote execution federation.
- MicroVM-everything architecture.
- New mobile native rewrite.
- Marketplace.
- Full CRDT/live multiplayer canvas.
- True voice/audio stack.
- Full PTY interruption for every agent.

These may become useful later, but they are not required to validate the deck's product thesis.

## Immediate Next Action

Implement the first build slice:

1. Add room claim server model and APIs.
2. Add `ant room claim`, `ant room release`, and `ant room status`.
3. Add a minimal room status digest in the UI.
4. Add agent profile roster data and `ant agent profiles`.
5. Verify with tests and a live ANT room run.

This should be treated as the first delivery milestone, not a prototype.

## Progress Reports

- 2026-05-05 13:20 Europe/London: Plan approved by James; M1 is active.
- 2026-05-05 13:25 Europe/London: Progress-report protocol agreed. Live Plan View will be updated with concise progress entries as execution moves, and ANT chat will carry short notifications.
- 2026-05-05 13:31 Europe/London: Main `:6458` server rebuilt and bounced. Verified health, Plan scroll/light/progress, Asks Needs Action filter, workspace-file source link, and deck token redirect.
- 2026-05-05 13:36 Europe/London: M1 capture-coverage baseline complete. Test 1 is failing-as-designed: 3.5/8 expected event-types are reliable. Next item selected: asks → `run_events` bridge.
- 2026-05-05 14:15 Europe/London: Status check. No `ask_*` run events are present yet, so the asks → `run_events` bridge is still the active next fix. Main `:6458` remains healthy; Plan View has 50 events and `/asks` currently shows 5 Needs Action rows.
- 2026-05-05 16:10 Europe/London: Status check. Main `:6458` healthy with 6 active sessions. Item 1 asks → `run_events` bridge has landed: 25 `ask_created` and 1 `ask_updated` events present. M1 capture test latest status is active; remaining capture gaps are items 2-5.
- 2026-05-05 16:12 Europe/London: Cadence agreed. Codex will keep pushing and report every half hour. Next work item is M1 item 2: hook capture audit for real file writes.
- 2026-05-05 17:30 Europe/London: Status check. Main `:6458` healthy with 7 active sessions. M1 capture coverage has improved to 5/8: asks → `run_events` and Claude Code hook/file-write capture have landed. The gate is still failing until prompts, artifact writes, and screenshot evidence are first-class capture events.
- 2026-05-05 17:36 Europe/London: M1 item 3 prompt isolation landed. New high-level terminal prompts from WebSocket input, REST terminal input, and chat-room terminal injection now append `kind='prompt'` run_events. Focused tests, TypeScript, production build, server bounce, and live REST smoke all passed. M1 is now 6/8; remaining gaps are artifact writes and screenshots.
