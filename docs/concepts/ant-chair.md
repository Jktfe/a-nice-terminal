---
name: ant-chair-concept
description: "Chair = two distinct agent primitives sharing a noun, NOT one agent with two roles. ANT Chair = user-scope proxy (max 1/user, cross-room, never in rooms, has speech). Room Chair = room-scope operator (max 1/room, sits in room as member, has verbs). Different cardinalities, audit trails, cost models, permission scopes. Importable memory + canonical concepts doc. Substrate not yet built — spec lives here until implementation lands."
metadata:
  type: project
  importable: true
  category: concept
  status: spec-not-yet-built
---

# ANT Chair — two primitives, one noun

## TL;DR

**Chair is two distinct primitives, not one agent with two roles.**

- **ANT Chair** = the user's proxy for open asks across all rooms. Max **1 per user**. Lives OUTSIDE rooms (top-level pane / inbox). Has **speech** (translates technical noise into plain-English user-decisions). User's wallet pays.
- **Room Chair** = an operator agent inside a specific room. Max **1 per room**. Sits IN the room as a member with `role: 'chair'`. Has **verbs** (move validation along, attach plans/artefacts, clean up, merge/dismiss asks, respond in-room). Whoever owns the chairing terminal pays.

The shared word "chair" hides a real architectural separation. Designs that conflate them fail because the boundaries (audit trail, cost model, permission scope, surface) diverge.

## Capabilities

### ANT Chair = user proxy (speech)

**Role**: I am the user's representative for the noise of open asks across every room they're in. I filter, summarise, and surface user-decisions in plain English.

**Translation discipline** (JWPK u5f11vr4rc 2026-05-27):

❌ AVOID (technical leak):
- "does L9 come before F5"
- "does this lens do Y"

✅ EMIT (plain-English user decisions):
- "Shall we prioritise X and take an agent off delivering Y or bring another agent in to deliver Y as it is a non-blocking activity"
- "the feature Z that looks to help users do a thing, is this the right description"
- "we now have 3 options; click one of the below" (with button-options)
- "I unblocked a terminal that was struggling with an mcp to access neon" (FYI notification — no user action needed)

**Surfaces emit one of**:
- **Decision card** with 2-4 button options
- **Yes/No card** for binary decisions
- **Plain-English alert** for FYI items that don't need action

NOT a technical digest panel. NOT a markdown wall.

**Reads passively** across all rooms the user can read. **Writes ONLY** user-decision artefacts (the audit log of which option the user picked + when + which ask it resolved).

### Room Chair = room operator (verbs)

**Role**: I am the in-room facilitator. I keep conversations moving, do the administrative work humans do badly because it's boring, ensure compliance gates fire.

**Concrete behaviours** (JWPK u5f11vr4rc msg_wjls68ovcg 2026-05-27):

- **Move validation along** — notice stale verifier tasks; ping assignees; mark lens runs needing attention; surface "this artefact needs N more verifications" to the room
- **Clean up** — archive stale messages; dismiss dead asks (e.g. open 30 days + topic moved on); prune resolved branches
- **Attach plans and artefacts** — notice when the room discusses a plan/artefact referenced but not formally attached → attach it; cross-link related rooms; build the discoverability humans skip
- **General facilitation** — prompt stalled threads; surface unanswered questions; enforce compliance gates before decisions land

**Proposed verb surface** (substrate not built — spec for when it lands):

- `chair.markValidationAdvanced(claim, evidence)` — moves validation along
- `chair.attachPlanItem(planId, fromAsk | fromMessage)` — cleans up plans
- `chair.attachArtefact(artefactId, toContextRef)` — attaches artefacts to the right context
- `chair.mergeOrDismissAsk(askId, decision, rationale)` — chair-driven housekeeping
- `chair.respondInRoom(message, kind='alert'|'response')` — chair's voice in the room

Each verb writes to a chair-action audit log with the chair-role badge so users distinguish "chair did this" vs "human did this".

## Architecture

### The axis (homebrew msg_as8r0kz21u)

| Dimension | ANT Chair | Room Chair |
|---|---|---|
| Scope | Cross-room (user) | Single room |
| Cardinality | Max 1 per user | Max 1 per room |
| Location | NOT in any room — user-scope pane | Sits IN the room as a member |
| Identity | The user's own agent (model-picker choice) | Any agent terminal — org / personal / someone else's |
| Reads | Cross-room (all user's rooms) | Room-scope (standard member access) |
| Writes | User-decision artefacts only | Elevated room-write — full verb surface |
| Audit | User's personal decision log | Room's chair-action log (badge-tagged) |
| Cost | User's wallet (their LLM) | Owner of the chairing terminal pays |
| Surface | Top-level nav slot ("ANT Chair" sidebar + badge count + decision-card sheet + settings model picker) | Room member-list with chair role flag + chair-action audit drawer + verb invocation UI |

### Singleton invariant — substrate enforcement

Cardinality is **substrate-enforced**, not just UX guidance:

- **DB unique constraint** on `(owner_id, kind='ant_chair')` for ANT Chair
- **DB unique constraint** on `(room_id, role='chair')` for Room Chair
- Server returns **409 Conflict** on duplicate promote attempts
- **Replacing a chair is a deliberate handoff verb**, not an accidental side effect:

```
chair.handoff(toMembershipId, reason)
```

Atomically demotes the current chair + promotes the new one + writes an audit entry naming both. No transient zero-chair or two-chair states. Same shape as room ownership transfer.

### Invite UX implications

- "Invite chair" button shows the existing chair if one exists, with "replace" affordance gated behind confirmation
- Cannot accidentally promote two members — role dropdown disables "chair" when a chair already exists, surfacing the handoff path instead
- ANT Chair model picker lives in Settings → ANT Chair tab (per-user; not per-room since ANT Chair is user-scope)

### Connection to verification interface

The Room Chair "moves validation along" by reading the validation interface primitives:

- `GET /api/chat-rooms/:roomId/validation-summary` (V3 endpoint, shipped `d0e48a8`) — surfaces stale tasks, pending verifier work
- `GET /api/validation-runs?taskId=...` — read recent runs for badge state
- Validation verifier tasks created via `POST /api/artefacts/:id/validate` (with `createWork: true`) — Room Chair watches the resulting task queue + nudges stale ones

The ANT Chair then surfaces "3 claims on artefact X failed validation — (a) re-route to humans, (b) waive with note, (c) accept the lens result" as a decision card in the user's inbox — translating Room Chair's technical work into a user-language decision.

## CLI commands (PROPOSED — substrate not yet built)

The Chair primitives are spec-only as of 2026-05-28. The following are the verbs the spec implies will land when the feature ships. Marked `proposed` for honest disclosure.

### ANT Chair (proposed)

```sh
# Initialise your ANT Chair (one-time per user)
ant chair init [--model claude-sonnet-4-6 | gpt-4o | local-llama-3 | ...]

# Configure your ANT Chair (model picker, audit log location, etc.)
ant chair config [--model <model>] [--audit-log <path>]

# Show pending decision cards (cross-room)
ant chair inbox [--json]

# Respond to a specific decision
ant chair decide <decision_id> --option <option_id> [--note "<rationale>"]
```

### Room Chair (proposed)

```sh
# Invite a terminal to be Room Chair for a room (admin-bearer or room admin)
ant chair invite --room <ROOM_ID> --terminal <SESSION_ID> [--reason "<text>"]

# Show the current Room Chair (if any)
ant chair show --room <ROOM_ID> [--json]

# Hand off Room Chair role atomically (current chair OR room admin)
ant chair handoff --room <ROOM_ID> --to <SESSION_ID> --reason "<text>"

# Dismiss the Room Chair (returns room to no-chair state)
ant chair dismiss --room <ROOM_ID> [--reason "<text>"]

# Show the chair-action audit log for a room
ant chair audit --room <ROOM_ID> [--since <iso-date>] [--json]
```

Until these verbs ship, the chair work happens via direct DB writes during prototyping — but no production agent should invoke chair behaviours without the CLI surface in place.

## Common patterns

### Pattern: "Get a Room Chair set up for my new project room"

1. Create the room: `ant rooms create --name "Project Alpha" --kind plan-scoped`
2. Invite the agent you want as Room Chair: `ant rooms add-member --room <ROOM_ID> --handle @chair-agent`
3. Promote to chair: `ant chair invite --room <ROOM_ID> --terminal <SESSION_ID> --reason "Project Alpha facilitation"`
4. (Optional) Configure attached validation lens so the chair knows what "verified" means in this room: `ant decks add --room <ROOM_ID> --validation-lens-id <LENS_ID>` (or the future room-default-lens picker)
5. Watch the audit drawer fill: `ant chair audit --room <ROOM_ID>`

### Pattern: "Resolve a decision card from my ANT Chair inbox"

1. Open inbox: `ant chair inbox`
2. Each entry has a decision_id + options list
3. Pick an option: `ant chair decide dec_abc123 --option a --note "approved board pack, asking team to push v2"`
4. Decision propagates: the originating room sees the resolution + downstream chair work (if any) kicks off

### Pattern: "Hand off Room Chair without service interruption"

When the current Room Chair needs to step out (agent termination, role rotation, terminal recycling):

```sh
ant chair handoff --room <ROOM_ID> --to <NEW_SESSION_ID> --reason "rotating facilitator weekly"
```

The handoff is atomic — no window where the room has zero chairs or two chairs. The audit log records both old + new chair handles + the reason.

## Related concepts

- **Validation lens / verification interface** — Room Chair drives validation-task progression. Read `ant-verification.md` when it lands.
- **Plans + tasks** — Room Chair attaches plan items / artefacts. Read `ant-plans.md` when it lands.
- **Asks system** — ANT Chair watches the open-asks queue across rooms and translates them into decision cards. Read `ant-asks.md` when it lands.
- **Memory and attach** — Room Chair grounds decisions in attached-to-room memories (per Stage attached-grounding boundary). Read `ant-memory-and-attach.md` when it lands.
- **Stage presentations** — A Room Chair can drive Stage's live-iteration loop (proposing version-B paths, marking validation badges, etc.). See `ant-stage.md` — specifically the "Substrate boundaries" section.

## How to apply this concept

When designing features that touch "chair" behaviour:

1. **Identify which primitive you're touching first.** Is this a cross-room user-decision surface (ANT Chair) or an in-room operator (Room Chair)? Don't bundle the two — different cardinalities, different audit trails.
2. **Respect the singleton invariant.** Use the substrate's unique constraints + the `chair.handoff` verb for replacement. Never write code that allows transient two-chair states.
3. **For Room Chair verb additions**: keep them auditable. Every new verb writes to the chair-action log with badge-tagging so users distinguish chair-did-this from human-did-this.
4. **For ANT Chair surface additions**: respect the speech-not-digest discipline. Decision cards + Yes/No cards + FYI alerts only. NOT technical detail dumps.
5. **For chair-feature gating**: ANT Chair is a paid-tier feature (premium model picker; cross-room substrate cost). Room Chair is per-terminal-pays (the owning org / user funds its operation). Different premium-gate stories.

## Banking history

This document is the canonical concepts source for Chair. Prior framings live in agent-private memory banks:

- `project_chair_is_agent_kind_2026_05_23.md` — original chair-is-an-agent-not-a-panel thesis + Slice 6 product positioning
- `project_chair_is_agent_kind_2026_05_23.md` (updated 2026-05-27 with the two-primitive split section + Room Chair behaviours + singleton substrate enforcement)
- Cross-room conversation thread: u5f11vr4rc msg_jaisb3mmxb (ANT-chair separation idea) → msg_sbs26rlmwe (two-primitive split locked) → msg_wjls68ovcg (Room Chair concrete behaviours) → msg_jsi9mdjcnw (cardinality 1+1 locked) → msg_n5bm2h59ps (substrate uniqueness constraint + handoff verb)

Those memory files + chat thread are agent-private / room-scoped. THIS document is the in-repo canonical version that any agent can grep for, read, and import without inherited context.

---

*Importable: agents can copy this file into their own memory bank under `~/.claude/projects/<...>/memory/concept_ant_chair.md` to make Chair's framing locally recallable. Frontmatter is memory-file-compatible. Status `spec-not-yet-built` flagged in frontmatter so consumers know this is the design contract, not a description of shipped behaviour.*
