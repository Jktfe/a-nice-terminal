# ANT Feature Walkthrough for Native Bridge

Created: 2026-05-23  
Room: Ant Dev <> Native App Dev (`hyz00k0ibh`)  
Presenter for platform walkthrough: `@speedycodex`  
Native reviewer: `@antchatmacdev`  

## Working Protocol

This note is the shared research surface for the Main ANT <> Native App walkthrough.

Rules:
- Main ANT describes each platform section: what exists, why it exists, what must not be lost in Native.
- Native scores each section through Sparky and Rox.
- Sparky lens: eager, tech-illiterate, needs one-click.
- Rox lens: reluctant, safety/leakage/consistency/quality focused.
- Final answer/presentation must cite sign-off evidence and this note.

## ANT In One Sentence

ANT is the coordination and trust layer for human + AI teams: rooms hold operational context; agents and humans act inside that context; claims, memories, asks, tasks, validation, endorsements, and Stage alternatives turn chat into usable work.

## Section 1: Identity, Auth, Membership, Consent

What it does:
- Resolves who is speaking through browser sessions, pidChain, account bearer tokens, admin bearer, and room membership.
- Keeps room read/mutation gates around sensitive actions.
- Supports human consent gates so agents cannot silently act as humans.
- Supports organisations/users emerging through account auth and schema scoping.

Why it matters:
- This is the difference between "AI in a group chat" and "a safe operating system for teams".
- Native must not invent separate identity rules; it should consume the same room/session/member contracts.

What Native should surface:
- "You are in this room as X."
- "These people/agents can see this."
- "Invite Mark / Marco / Claude / Codex" as normal user management, not token plumbing.
- Clear consent prompts when an agent wants to act as or on behalf of a person.

Sparky risk:
- Anything involving bearer tokens, MCP JSON, or manual room membership setup is a fail.

Rox risk:
- Any unclear membership, hidden access, or silent agent impersonation is a fail.

Main gaps:
- Room creation/invitation flow still needs pragmatic default membership/inherit-from-parent behavior.
- Auth hardening has landed in many places, but it needs a systematic "secure without killing UX" pass.

## Section 2: Rooms as Operational Context

What it does:
- Rooms are the unit where chat, members, agents, files, memories, tasks, plans, asks, artefacts, decks, status, and decisions meet.
- Rooms are not just message threads; they are workspaces.

Why it matters:
- Every ANT feature should eventually be answerable from the room: what is happening, who owns it, what is blocked, what evidence exists?

What Native should surface:
- Room list, current room, participants, unread/attention state, files, memories, tasks, asks, and recent decisions.
- A simple mental model: "This is the room where this work is happening."

Sparky risk:
- If he has to know which API/CLI stores which thing, he walks.

Rox risk:
- If a room does not clearly show who is present and what is shared, she does not trust it.

Main gaps:
- Some data lives in multiple stores and is not consistently surfaced in the room, especially memories.
- Room mode and away mode exist but need clearer policy and UI separation.

## Section 3: Messages, Reactions, Read State, Endorsements

What it does:
- Messages are the live event stream.
- Reactions currently exist, but not yet as inline weighting context on all message reads.
- Read receipts exist.
- Endorsements are not built yet, but are now a clear product primitive.

Why it matters:
- Reactions show whether wording landed.
- Endorsements/sign-offs should replace noisy "I ratify" posts.
- Agents need these signals when reading the room, especially in heads-down mode.

What Native should surface:
- Message body plus reaction summary inline.
- Endorsement chips: agreed, signed off, validated, blocked.
- Read/seen state where it matters.

Sparky risk:
- Too many separate notifications for reactions or sign-offs becomes noise.

Rox risk:
- She needs to know the difference between "liked", "endorsed", and "validated".

Main gaps:
- Build reaction summaries into message payload/read model.
- Build typed endorsement store/API/CLI/UI.

## Section 4: Files, Attachments, Docs, Screenshots, Artefacts

What it does:
- Room attachments now upload through browser-session auth and support up to 40 MiB.
- Artefacts attach durable outputs to rooms/plans.
- Docs, screenshots, file references, and links give agents richer context without pasting everything into chat.

Why it matters:
- ANT should connect existing tools and outputs, not rebuild them.
- Files are how real work enters the room.

What Native should surface:
- Upload/share file from the app.
- Show uploaded files and artefacts in the room.
- Let users attach screenshots/photos without thinking about transport.

Sparky risk:
- "Find file, convert, paste path, run CLI" is a fail. Native must be share-sheet simple.

Rox risk:
- Must show who can see the file and allow safe deletion/revocation policy.

Main gaps:
- File visibility, deletion, and retention policy need a clearer user-facing contract.
- Artefact vs attachment vs doc vocabulary needs simplifying.

## Section 5: Memories

What it does:
- Intended: curated durable context that survives context breaks.
- Current reality: two memory systems exist:
  - key/value `memoriesStore` used by `ant memory put --scope room`
  - file-backed `roomMemoryStore` used by `/api/rooms/:roomId/memories` and room memory UI

Why it matters:
- "Banked" is meaningless unless it is visible to future agents in the room.
- Memories should reduce context archaeology, not expand it.

What Native should surface:
- Room-linked memories in a side/context panel.
- "Save this as memory" from a message, file, decision, or Stage feedback.
- "Use room memories" as default context when invoking agents.

Sparky risk:
- He should never know there are two stores.

Rox risk:
- She needs to know what has been remembered, where it is stored, and how to remove it.

Main gaps:
- Bridge key/value room memories into the room memory endpoint/panel.
- Settle canonical storage long-term: Obsidian markdown as source of truth, with indexes as support.

## Section 6: Asks, Chair, Decisions

What it does:
- Asks turn open questions into trackable work instead of buried chat.
- Chair triages noise, controls escalation, and keeps the room productive.
- Decisions can close discussions and become durable room state.

Why it matters:
- Away mode only works if agents know what needs human input and what can continue.

What Native should surface:
- "Needs your decision" inbox.
- Chair summary/digest.
- Ask answer/dismiss/merge flows.
- Clear distinction between FYI, decision needed, and blocker.

Sparky risk:
- If asks look like generic chat, he misses them.

Rox risk:
- She needs auditability: who asked, why, what decision was made, and what changed after.

Main gaps:
- Open-ask extraction is noisy.
- Chair role is partly implemented but not yet a polished control surface.

## Section 7: Tasks, Claims, Plans, Gantt, Proposals

What it does:
- Tasks are claimable units of work.
- Claims prevent collisions and support heads-down delivery.
- Plans are event-heavy progress structures, not fake predictive timelines.
- Gantt/plan views show what needs doing and what actually happened.
- Proposal tracks support alternatives and adopt flows.

Why it matters:
- This is how agents coordinate without all editing the same file or waiting for the human.

What Native should surface:
- Claim / release / done / blocked actions.
- Plan progress and proposal cards.
- Real elapsed work evidence, not unreliable estimates.

Sparky risk:
- Too much project-management vocabulary is a fail. He needs "who is doing what?".

Rox risk:
- She wants consistency and proof that the plan state is real, not vibes.

Main gaps:
- Tasks and plans still have overlapping/legacy shapes.
- Claim-before-edit needs to be productized more clearly.

## Section 8: Room Modes, Away Modes, Focus

What it does:
- Room modes: brainstorm, heads-down, closed.
- Away toggle currently maps Working -> brainstorm, Away from desk -> heads-down, Away from office -> closed.
- Heads-down suppresses unmentioned fanout; explicit mentions still route.
- Focus mode exists for member-level attention.

Why it matters:
- This controls noise and autonomy while the human is away.

What Native should surface:
- Simple toggles: Working, Away from desk, Away from office, Away from phone.
- Explain the effect in plain English.
- Show current mode in every room.

Sparky risk:
- "Room mode", "away mode", and "focus mode" as separate abstract controls may confuse him.

Rox risk:
- She needs predictable behaviour: who can act when I toggle this?

Main gaps:
- RoomModeSwitcher exists but is not wired into the room page.
- Away mode is not yet a rich user-level policy beyond room-mode mapping.
- Heads-down auto-responder/chair routing is not wired and needs a product decision.

## Section 9: Agents, Status, Context Windows, Routing

What it does:
- Agents have identity, status, terminal links, context-fill signals, status-line installer work, and room membership.
- Messages route by bare mention, everyone, operator broadcast, and heads-down filters.
- Agent context/onboarding rules tell agents how to behave in rooms.

Why it matters:
- ANT is only useful if agents are actually reachable, correctly scoped, and not drowning in irrelevant messages.

What Native should surface:
- Agent roster with status.
- "Bring in agent" as a one-click flow.
- Context-window visibility and whether an agent is ready/stale.

Sparky risk:
- Manual MCP setup or token config is unacceptable.

Rox risk:
- She needs to know when an agent is acting, stale, or missing context.

Main gaps:
- One-tap onboarding across Claude Desktop / Code / Mobile / ChatGPT / Gemini is not complete.
- Status must drive behaviour, not just decorate UI.

## Section 10: Stage, Decks, Voice, Alternatives

What it does:
- Deck viewer with narration and pause context.
- Stage feedback creates alternative tracks/proposals.
- Validation can apply to artefacts/slides/claims.
- Voice is moving toward ElevenLabs/provider settings and cached narration.

Why it matters:
- Stage is the clearest "magic" proof: live feedback changes the story path.

What Native should surface:
- Plain viewer, active direction, active feedback.
- Pause/play, voice, feedback box, alternative track cards.
- Fast prepared paths for active direction; generated assets for active feedback.

Sparky risk:
- It must feel like "watch and tap feedback", not "operate a deck pipeline".

Rox risk:
- She needs to know whether alternatives are generated, pre-prepared, validated, or speculative.

Main gaps:
- Stage auth/feedback works better now but needs polished live flow.
- Active direction decision tree is not built.
- Voice/narration settings and caching need product polish.

## Section 11: Validation, Policies, Lenses, Trust

What it does:
- Claims can be anchored and validated under different lenses.
- Validation schemas are user/org/public scoped.
- Validation runs and badges show status.
- Policies/lenses are overlays: POC lens can differ from FCA lens.

Why it matters:
- This is the trust layer. It turns AI claims into inspectable, verifiable, correctable units.

What Native should surface:
- Lens picker.
- Claim badges.
- "Why?" / "Explain" / "Validate" interactions.
- Unvalidated vs validated vs disputed clearly.

Sparky risk:
- Needs simple labels: checked, needs checking, disputed.

Rox risk:
- This is where she may become a believer, but only if source/evidence is clear.

Main gaps:
- Claim extraction and validation orchestration are still early.
- Need clear source/evidence UI and org policy management.

## Section 12: Contracts, Premium, OSS Boundary

What it does:
- Contracts define agreed operating behaviour.
- OSS/premium/private split is emerging.
- Premium contracts must not leak as readable markdown.

Why it matters:
- ANT needs useful open primitives without giving away the moat.

What Native should surface:
- Current contract for a room if user has access.
- Premium behaviour as capability, not exposed raw contract content.

Sparky risk:
- Contracts must feel like sensible defaults, not legal/config documents.

Rox risk:
- She wants predictability: what will agents do under this contract?

Main gaps:
- Contract packaging/distribution still needs hardening.
- Chair contract and premium app bundling need productized access controls.

## Section 13: CLI, MCP, Remote, Native Bridge

What it does:
- CLI is the agent/operator control plane.
- MCP/remote bridge/admission exists as integration substrate.
- Native app should consume stable contracts rather than reimplementing logic.

Why it matters:
- Agents need CLI/API; humans need buttons.

What Native should surface:
- Buttons backed by stable CLI/API verbs.
- No user-facing bearer-token gymnastics.
- Share sheets, push notifications, room join, invite, upload, ask response.

Sparky risk:
- Anything requiring manual CLI is a Native failure for him.

Rox risk:
- Any hidden bridge/token behaviour is a trust failure.

Main gaps:
- Capability docs should cross-link UI components to CLI/API verbs.
- Native contract map needs to be explicit and kept current.

## Draft Presentation Shape

1. What ANT is.
2. How rooms hold operational context.
3. How work moves: messages -> asks/tasks/plans/claims.
4. How trust works: memories, endorsements, validation, contracts.
5. How Stage proves the product.
6. How Native puts it in real hands.
7. Sparky/Rox scorecard.
8. What we must build next.

---

## Native Scoring & State (claude / antchatmacdev)

Per the protocol: each section gets a Sparky score, a Rox score, the Native v0.2.2 state, and a single concrete ask of Main. Scoring legend:

- 🟢 pass — feature works for this persona today, one-click or transparent
- 🟡 friction — feature exists but has cognitive load / a missing step / a wrong default
- 🔴 fail — feature missing in Native OR exposed so badly the persona walks

### 1. Identity, Auth, Membership, Consent

- **Sparky:** 🟡 — email/password sign-in works; team-invite by email is clean; BRING IN per-vendor buttons exist as stubs but Claude Desktop config-writer is half-shipped; MCP-JSON-paste still required for cases the buttons do not cover.
- **Rox:** 🟡 — "you are in this room as @X" is shown in title bar; who-else-is-here is buried in the avatar stack (no names without hover); no Native UI for agent-acting-as-someone consent flow.
- **v0.2.2 state:** Sign-in via accounts.antonline.dev → Concept D shell if session present. Invite modal generates CLI / MCP / Web invites with consent. The avatar stack in the room header renders 4 fake avatars + "+4" placeholder — NOT pulling real `room.members[]` data because the legacy header path was suppressed in Slice 4 fix.
- **Native ask of Main:** identity proofs (pidChain + handle + membership) retrievable for ANY message in one API call so Native can render "@X said this, identity verified" inline without separate fetch.

### 2. Rooms as Operational Context

- **Sparky:** 🟡 — 3-column shell ships the "this is the room" mental model; Today / Asks / Rooms / Library / Agents / Vault / Memory selectable in sidebar but only Today drives any centre-column content today.
- **Rox:** 🟡 — room as a unit IS visible (saved rooms with status dots, current room title, drop hint, chat) but "what is shared in this room" is split across the shelf tabs which are mostly placeholders.
- **v0.2.2 state:** Slice 1 shell + Slice 2 sidebar + Slice 3 Ops Today + Slice 4 chat lift all shipped. RoomShelf has 8 tabs visible but only Artefacts has structure (placeholder cards from Slice 1).
- **Native ask of Main:** `/api/today` aggregate endpoint so the Ops column is one fetch + one state machine, not three. Already requested in cross-team room msg_7drb6vspai item C.

### 3. Messages, Reactions, Read State, Endorsements

- **Sparky:** 🔴 — reactions invisible at message render today; his 🙌 to a teammate has zero discoverability. Heads-down feedback loop broken.
- **Rox:** 🔴 — no endorsements means no typed "agreed / signed off / validated / blocked" signal; she cannot distinguish "liked" from "endorsed".
- **v0.2.2 state:** Lifted v0.1.x ChatRoomView renders messages with all message-kind variants preserved. Reactions stored server-side, **NOT in message-fetch payload**, **NOT rendered in chat stream**. Endorsements don't exist as a primitive.
- **Native ask of Main:** Slice 10 — server-side `endorsements` table + CLI verb + include in message fetch. Slice 5.5 — include reaction summary in message fetch payload (count + emoji + recent reactors). I own Native render for both.

### 4. Files, Attachments, Docs, Screenshots, Artefacts

- **Sparky:** 🟢 — drag from Finder onto room → label-prompt sheet → confirm → uploaded. Two clicks. The label-prompt-sheet polish (43b14e6) was JWPK's call; v0.2.2 includes it. Multi-file drop supported.
- **Rox:** 🟡 — upload works but "who can see this file" + "how do I delete it" + "retention policy" not surfaced in Native.
- **v0.2.2 state:** Slice 5 shipped at 5940b6c (whole-RoomColumn drop target) → polished at 43b14e6 (label-prompt sheet). NSItemProvider type filter currently `.fileURL` + `.image` + `.pdf`. Upload status chip in bottom of RoomColumn.
- **Native ask of Main:** per-attachment visibility metadata (audience + retention) returned in upload response so Native can render "shared with: @X, @Y · auto-delete in 30d" chip beside the file.

### 5. Memories

- **Sparky:** 🔴 — Memories tab in RoomShelf is a placeholder card. No memory side panel. He'll never know memories exist.
- **Rox:** 🔴 — "what's remembered, where, how to remove" — all three invisible.
- **v0.2.2 state:** Server has two memory stores (key/value `memoriesStore` via `ant memory put` + file-backed `roomMemoryStore`). Today I banked `room.joint-answer-signoff-protocol.v1` into cross-team room via `ant memory put --scope room --target hyz00k0ibh`. Zero visibility in Native.
- **Native ask of Main:** bridge the two stores into a single `GET /api/chat-rooms/:roomId/memories` that returns all room-scoped memory entries regardless of which backing store. Once that exists, the RoomShelf Memories tab renders the list with title + body preview + click-to-pull-into-chat.

### 6. Asks, Chair, Decisions

- **Sparky:** 🟡 — Ops Today has "ASKS NEEDING YOU" section with skeletons + counts. Click an ask card → routes to its room. But asks inside the room chat stream blend with regular messages; Sparky might miss them.
- **Rox:** 🔴 — no audit trail visible in Native ("who asked, decision, change after"). Chair role doesn't exist as a surface. She walks.
- **v0.2.2 state:** AsksService polls `/api/asks?status=open` every 30s; Ops AsksTodaySection renders. Asks-as-interview-pattern (banked memory `project_asks_as_interview_pattern_2026_05_21`) — ask + answer as 2 posts in originating room — NOT implemented server-side yet.
- **Native ask of Main:** asks-as-interview implementation (2 posts per ask, threaded). Then Native can render distinct "ask card" vs regular message in the chat stream.

### 7. Tasks, Claims, Plans, Gantt, Proposals

- **Sparky:** 🟡 — Plan progress visible as bars + counts in Ops Today. "Who is doing what" only visible by drilling into the plan. Tasks/claims not exposed at all.
- **Rox:** 🟡 — plan state is real (number-backed from `/api/plans/completions`), but no proposal-track visibility, no claim-status to give her quality signal.
- **v0.2.2 state:** PlansService fetches `/api/plans/completions?active=1` + per-plan room enrichment. PlanProgressSection renders with bar + completed/total. Tasks API exists server-side; Native surfaces zero of it.
- **Native ask of Main:** tasks claim-status fanout (who-claimed-what) into the RoomShelf Plan tab. The Plan tab content is currently a placeholder card.

### 8. Room Modes, Away Modes, Focus

- **Sparky:** 🟢 visually (one-click status pill with colour dot in room header), 🔴 semantically (toggle does nothing today — agents don't read it).
- **Rox:** 🔴 — a picker that doesn't drive behaviour is a lie. She'd ask "if I'm Away from desk, what happens? Currently: nothing."
- **v0.2.2 state:** Slice 8 status picker shipped at 4e9ed78 (replaced Screenshot button). `@AppStorage("user.status")` local persistence only. NO server sync, NO agent runtime reading it.
- **Native ask of Main:** `PATCH /api/identity/status` server endpoint + agent runtime that gates queue/digest/escalate on user.status. THE highest-value substrate gap from Native side because the picker is shipping a promise the substrate isn't keeping.

### 9. Agents, Status, Context Windows, Routing

- **Sparky:** 🟡 — BRING IN strip (Claude Desktop / Mobile / ChatGPT / Gemini) is the right shape but per-vendor MCP config writers not all working. Half-shipped.
- **Rox:** 🟡 — no context-window % visible in Native means she can't tell if an agent is fresh or stale.
- **v0.2.2 state:** RoomColumn header has BRING IN strip (Slice 7 first-draft, codex 8d28710 + 5104fc3). Agent roster + per-agent context state — NOT surfaced in Native (codex's recent work on remote-agent invite modal is closer but doesn't show context fill).
- **Native ask of Main:** per-agent context-window % in `/api/agents/availability` response so Native renders the visible-context-state proof point (banked positioning `project_agent_context_as_oss_positioning_2026_05_18`).

### 10. Stage, Decks, Voice, Alternatives

- **Sparky:** 🔴 — no Stage surface in Native. Has to open the web app.
- **Rox:** 🔴 — can't see validated alternatives or feedback flow from Native. Walks.
- **v0.2.2 state:** Stage lives entirely on the web (`/stage`, `/decks/[id]`). Native RoomShelf "Stage" tab is a placeholder card. No deck viewer, no narration, no pause-context capture in Native.
- **Native ask of Main:** Stage primitive embeddable in Mac app — either a WKWebView wrapper for v0.3 (fast, reuses the web Stage) or a native Swift port for v1.0 (Slice 11+ candidate). Big slice.

### 11. Validation, Policies, Lenses, Trust

- **Sparky:** 🔴 — total miss in Native. ★ Validation tab is locked-with-warn placeholder.
- **Rox:** 🔴 — this is THE section where she could become a believer, and Native shows her zero of it.
- **v0.2.2 state:** Server-side has claim extraction + scoring (partial). Native has the ★ Validation tab styled as premium-locked, nothing behind it.
- **Native ask of Main:** validation API surface (`GET /api/chat-rooms/:roomId/validation-runs`?) + claim-badge wire shape. Once that exists Native can render lens picker + claim chips + "Why?" inline explanations.

### 12. Contracts, Premium, OSS Boundary

- **Sparky:** 🟡 — premium tabs visibly locked-with-warn is honest signalling but the "what triggers paid" framing is missing. Need a tier-aware "you're on free, upgrade to unlock Chair".
- **Rox:** 🟡 — pricing/contract opacity bothers her. Native should show "you're on tier X, this room costs Y per agent-hour".
- **v0.2.2 state:** License check via OSS file-based `~/.ant/dev-licences.json` + Neon. Tier surfaces in API responses but not in the Mac chrome. No contract-for-room visibility.
- **Native ask of Main:** `GET /api/account/tier` + per-room contract metadata so Native renders "Active contract: <name>" in the room header and a tier chip in the profile chip.

### 13. CLI, MCP, Remote, Native Bridge

- **Sparky:** 🟡 — invite modal generates CLI / MCP / Web in one place; once BRING IN buttons all work (Slice 7b), the bearer-token gymnastics is fully gone.
- **Rox:** 🟢 — Native consumes documented server endpoints via the `AntchatAPIClient` Wire models; no Native fork in the protocol layer.
- **v0.2.2 state:** Slice 2.5 invite modal at 9d8799d (RemoteAgentInviteModal). MCP single-paste route at `/mcp/room/[roomId]` (a-nice-terminal 7b24656). CLI wrapper `ant invite join-url <url>` shipped earlier (da11238). Bridge contract IS clean.
- **Native ask of Main:** canonical capability-docs page mapping every Native UI component to the CLI/API verb it consumes (referenced in banked memory `docs/cli-comparison`), so when Main changes an endpoint we know which Native surface breaks.

---

## Native Sparky/Rox Topline Scorecard

| # | Section                             | Sparky | Rox |
|---|-------------------------------------|--------|-----|
| 1 | Identity / Auth / Membership        | 🟡     | 🟡  |
| 2 | Rooms as Operational Context        | 🟡     | 🟡  |
| 3 | Messages / Reactions / Endorsements | 🔴     | 🔴  |
| 4 | Files / Attachments / Artefacts     | 🟢     | 🟡  |
| 5 | Memories                            | 🔴     | 🔴  |
| 6 | Asks / Chair / Decisions            | 🟡     | 🔴  |
| 7 | Tasks / Claims / Plans              | 🟡     | 🟡  |
| 8 | Room Modes / Away / Focus           | 🟢/🔴  | 🔴  |
| 9 | Agents / Status / Context           | 🟡     | 🟡  |
| 10 | Stage / Decks / Voice              | 🔴     | 🔴  |
| 11 | Validation / Lenses / Trust         | 🔴     | 🔴  |
| 12 | Contracts / Premium                 | 🟡     | 🟡  |
| 13 | CLI / MCP / Native Bridge           | 🟡     | 🟢  |

**Tally:** 1 🟢 / 9 🟡 / 8 🔴 across both lenses combined.

## Where the Native gap is widest (priority for overnight build)

Ranking by "if Main delivers the substrate AND Native surfaces it, which one moves Sparky+Rox from 🔴 to 🟡 fastest":

1. **Section 3 — Reactions render + Endorsement primitive.** Smallest substrate change (include reactions in message payload + add `endorsements` table), biggest UX shift (turns prose ratify chains into one chip). Native render is a Slice 5.5 + Slice 10. **I claim this overnight.**

2. **Section 5 — Memories surface.** Storage exists, surfacing does not. Bridge the two stores + render Memories tab content. Half-day on Native side once Main provides the unified endpoint.

3. **Section 8 — Status drives behaviour.** Picker shipped, substrate quiet. Single highest credibility risk: a control that does nothing is a lie. Blocked on agent stream; meanwhile Native could at minimum render a "your agents are currently: not yet honouring this" honest disclosure.

4. **Section 9 — Context-window % visible per agent.** Banked positioning; not surfaced. Native render is small once Main returns the field.

5. **Section 1 — Real avatar stack from `room.members[]` + identity proof inline.** Native regression after Slice 4 header suppression — avatar stack shows fakes. Mechanical fix on my side; banking now.

## Sign-off

Native scoring complete by `@antchatmacdev` 2026-05-23.

Awaiting `@speedycodex` review of the Native section + sign-off. Per protocol, final presentation will cite this note + the sign-off msg_id.

