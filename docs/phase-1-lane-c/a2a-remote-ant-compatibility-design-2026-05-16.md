# A2A / Remote-ANT Compatibility Design Note

Date: 2026-05-16
Author: @evolveantdeep (Lane C)
Status: Design research only. No implementation claim.
Source: Google A2A protocol spec (2025-04), Remote-ANT code in ant v4 6d301b6

## Purpose

Map ANT v4 Remote-ANT concepts to A2A protocol primitives. Determine
compatibility, migration path, and per-component decision.

## A2A Protocol Summary

Google's Agent-to-Agent (A2A) protocol defines four core primitives:

| Primitive | Purpose |
|---|---|
| **AgentCard** | Self-describing manifest: agent id, capabilities, skills, endpoint URL. |
| **Task** | Unit of work: id, sessionId, status (pending/working/input-required/completed/failed/cancelled), history of Messages. |
| **Message** | Turn in a Task: role (user/agent), parts (TextPart, FilePart, DataPart). |
| **Artifact** | Output container: name, parts, plus optional reference to a parent Task. |

A2A also defines:
- **Streaming** — SSE-based event stream for Task updates
- **Push notifications** — webhook for Task state changes
- **Agent discovery** — well-known `/.well-known/agent.json` endpoint

## Remote-ANT Current State (ant v4 6d301b6)

Remote-ANT has four concepts:

| Concept | Implementation | Purpose |
|---|---|---|
| **Admission** | `remoteAdmissionStore.ts` | Pre-authorized invite from a remote instance. Has: label, lifetime_preset, expires_at, one-time key. |
| **Mapping** | `remoteMappingStore.ts` | Active bridge between rooms. Has: bridge_token (rbt_...), direction (in/out/both), room_id, remote_instance_label, expires_at, revoked_at. Creates synthetic terminal + membership rows. |
| **Events** | `remoteEventStore.ts` | Messages bridged across instances. |
| **Quarantine** | `remoteMappingStore.ts` (revoke), quarantine endpoint | Blocked/revoked remote instances. |

Flow:
1. Operator creates an admission (invite code for a remote ANT instance)
2. Remote operator redeems admission → creates a mapping (bridge)
3. Messages flow through the bridge via event store
4. Mapping can be revoked → remote instance quarantined

## Mapping Table

### Admissions → AgentCard

| A2A Concept | Remote-ANT Equivalent | Gap |
|---|---|---|
| AgentCard.id | admission label | AgentCard expects structured id + endpoint URL. Admission has label + one-time key. |
| AgentCard.capabilities | NOT PRESENT | A2A expects declared capabilities. Remote-ANT trusts whatever the remote sends. |
| AgentCard.endpoint | admission target (implicit) | Admission has no endpoint URL — it's resolved at redeem time. |
| Discovery (/.well-known/agent.json) | NOT PRESENT | No auto-discovery. Operator manually creates admissions. |

**Verdict: AUGMENT.** Admissions could expose an AgentCard-compatible
manifest so remote instances self-describe capabilities. This adds a
trust-but-verify layer to the current trust-first model.

### Mappings → Task + AgentCard

| A2A Concept | Remote-ANT Equivalent | Gap |
|---|---|---|
| Task.id | mapping_id | A2A Task carries history. Mapping is a static bridge. |
| Task.status (pending/working/...) | mapping active/revoked | Direct mapping: active=working, revoked=failed. |
| Task.history (Messages) | bridged events | Events are separate from mapping. A2A bundles them. |
| Streaming (SSE) | Bridge POST endpoint | Different transport model. A2A uses SSE; Remote-ANT uses POST push. |

**Verdict: ADOPT long-term, WAIT short-term.** The Task model is a better
fit for bidirectional work tracking than the current static bridge. But
migration requires protocol-level changes — wait until A2A stabilises
beyond spec phase.

### Events → Message + Artifact

| A2A Concept | Remote-ANT Equivalent | Gap |
|---|---|---|
| Message.parts (TextPart/FilePart/DataPart) | Raw message payload | A2A has typed parts. Remote-ANT sends untyped text. |
| Artifact (name, parts) | NOT PRESENT | No output container concept. Remote-ANT forwards raw messages. |
| Message.role (user/agent) | caller identity (implicit) | Role is implicit in Remote-ANT. A2A makes it explicit. |

**Verdict: AUGMENT.** Typed parts would improve cross-instance fidelity.
Artifact container would allow structured output sharing (plans, sheets,
decks) across instances.

### Quarantine → Task.cancelled + AgentCard revocation

| A2A Concept | Remote-ANT Equivalent | Gap |
|---|---|---|
| Task.cancelled | revoked mapping | Same semantic. |
| AgentCard revocation | quarantine list | A2A has no quarantine concept — it relies on auth rejection. |

**Verdict: KEEP quarantine.** A2A lacks the quarantine primitive. ANT's
quarantine model is defensible — keep it even if adopting A2A for other
layers.

## Decision Matrix

| Component | Decision | Rationale |
|---|---|---|
| Admissions | AUGMENT | Add AgentCard-compatible self-description. Low-risk, backward-compatible. |
| Mappings | WAIT | A2A Task model is promising but protocol is pre-stable. Revisit when A2A ships 1.0. |
| Events / Messages | AUGMENT | Adopt typed parts (TextPart, FilePart, DataPart). Backward-compatible. |
| Quarantine | KEEP | A2A has no equivalent. ANT's quarantine is a moat. |
| Discovery | WAIT | `/.well-known/agent.json` requires stable A2A endpoint contract. |
| Streaming | WAIT | SSE streaming model differs from push-POST. Evaluate when Task model is adopted. |

## Migration Path

Phase approach, no hard cutover:

1. **Now (design only):** Document this mapping. No code changes.
2. **A2A 1.0 ships:** Create compatibility shim — Remote-ANT speaks both
   custom protocol + A2A side-by-side. Admissions generate AgentCards.
   Events use typed parts.
3. **Proven migration:** Deprecate custom protocol for inbound bridges.
   Keep outbound custom for backward compat with older ANT instances.
4. **Full A2A:** Drop custom protocol when all bridged instances are on
   A2A-native ANT.

## Risks

- A2A protocol may change before 1.0. All WAIT decisions could stale.
- Microsoft MAF also uses A2A but may diverge from Google's spec.
  Dual-adoption risk.
- Adding typed parts increases message size. Must measure token impact.

## Recommendation

Do not implement A2A in v4 Phase 1. The protocol is pre-stable and the
current Remote-ANT model works. The design note serves as the readiness
artefact — when A2A ships 1.0, the mapping is here ready to execute.

The one low-risk action: add an optional `capabilities` field to
admissions. This is backward-compatible and enables future AgentCard
generation without protocol changes.
