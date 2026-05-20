# Research Mode with Verification Levels

Date: 2026-05-16
Author: @evolveantcodex
Status: Decision doc. No implementation claim.
Task: #86

## Purpose

Research mode is a premium workflow for answers that need citations and
explicit confidence. It lets a room or message require a configurable number
of agent confirmations and human confirmations before a finding is treated as
verified.

JWPK tier defaults captured in `ask_ssgyou3q15`:

| Tier | Default threshold |
|---|---|
| Solo | `2 agents OR 1 user` |
| Team | `3 agents AND 1 user` |
| Enterprise | `3+ agents AND 2+ people`, configurable per source |

The important product point is not just "add citations". The user should be
able to set a verification standard, watch sources move through that standard,
and see exactly who or what confirmed each source.

## Recommendation

Model research mode as a server-side verification contract with a compact
client badge. Clients should render verification state; they must not
recalculate confidence locally.

Start with a per-room mode plus per-message override:

- Room-level research mode sets the default threshold for new research asks.
- A specific message/ask can override the room default for one investigation.
- Chair owns refinement and dedupe of research asks, then fans work out to
  agents.
- The server stores sources, claims, confirmations, thresholds, and audit.

This mirrors the #92 permission pattern: server is authority, clients render
portable decisions.

## Entry Points

### Room-Level Research Mode

Room More -> Research mode:

- Off
- Solo
- Team
- Enterprise
- Custom

Room mode is useful for a period of work where every answer needs stronger
source discipline, for example due diligence, technical/vendor comparison, or
incident research.

### Message-Level Research Ask

Any message can request research mode:

> Research this with Team verification.

The message-level request should create a research session linked to the
message and room. It should not require the whole room to enter research mode.

### Chair-Mediated Ask

Chair should dedupe repeated research questions:

- detect similar asks.
- create one canonical research question.
- list waiting agents/people.
- fan out the confirmed answer to all waiting threads.

This is the #77 Chair ask refinement model applied to research work.

## Verification Thresholds

Represent threshold policy as data:

```ts
type VerificationPolicy = {
  tier: 'solo' | 'team' | 'enterprise' | 'custom';
  agentRule: 'or' | 'and';
  requiredAgents: number;
  requiredPeople: number;
  perSourceOverrides?: Record<string, Partial<VerificationPolicy>>;
};
```

Tier defaults:

```json
{
  "solo": {
    "agentRule": "or",
    "requiredAgents": 2,
    "requiredPeople": 1
  },
  "team": {
    "agentRule": "and",
    "requiredAgents": 3,
    "requiredPeople": 1
  },
  "enterprise": {
    "agentRule": "and",
    "requiredAgents": 3,
    "requiredPeople": 2,
    "perSourceOverrides": true
  }
}
```

Interpretation:

- Solo passes if either two agents confirm or one human confirms.
- Team passes only after three agents and one human confirm.
- Enterprise passes only after configured agent and people thresholds pass.
  Defaults are three agents and two people, but can be stricter per source,
  domain, room, or customer policy.

## Source and Claim Model

Research mode needs to separate source, claim, and confirmation.

```ts
type ResearchSource = {
  id: string;
  roomId: string;
  sessionId: string;
  url?: string;
  title?: string;
  kind: 'web' | 'doc' | 'artefact' | 'memory' | 'human' | 'terminal' | 'other';
  capturedBy: string;
  capturedAtMs: number;
  permissionDecisionId?: string;
  sourceRating: 'unrated' | 'weak' | 'acceptable' | 'strong' | 'authoritative';
};

type ResearchClaim = {
  id: string;
  sourceId: string;
  text: string;
  quoteHash?: string;
  status: 'unverified' | 'partially_verified' | 'verified' | 'disputed' | 'rejected';
  createdBy: string;
  createdAtMs: number;
};

type ResearchConfirmation = {
  id: string;
  claimId: string;
  actorHandle: string;
  actorKind: 'agent' | 'human';
  verdict: 'confirm' | 'dispute' | 'reject';
  note?: string;
  atMs: number;
};
```

Do not treat "source exists" as "claim verified". A source can be strong and
a claim can still be disputed.

## Verification Badge Contract

Every research answer, source, and claim should expose a compact badge object:

```json
{
  "status": "partially_verified",
  "requiredAgents": 3,
  "confirmedAgents": 2,
  "requiredPeople": 1,
  "confirmedPeople": 0,
  "sourceRating": "strong",
  "lastVerifiedAt": 1778971200000,
  "auditLink": "/research/rs_123/audit"
}
```

Fields:

| Field | Meaning |
|---|---|
| `status` | `unverified`, `partially_verified`, `verified`, `disputed`, or `rejected`. |
| `requiredAgents` | Agent confirmations required for this source/claim. |
| `confirmedAgents` | Current unique confirming agents. |
| `requiredPeople` | Human confirmations required. |
| `confirmedPeople` | Current unique confirming people. |
| `sourceRating` | Current source quality rating. |
| `lastVerifiedAt` | Last confirmation timestamp, null if none. |
| `auditLink` | Stable link to confirmation/audit detail. |

This is the native/client contract. iOS, Mac, Tauri, and web all render the
same badge and never infer research confidence locally.

## Source Rating

Source rating is separate from verification status.

Suggested first-pass scale:

| Rating | Meaning |
|---|---|
| `unrated` | Captured but not assessed. |
| `weak` | Blog/forum/uncorroborated source, or unclear provenance. |
| `acceptable` | Usable but not primary. |
| `strong` | Primary source, official docs, original data, or first-party evidence. |
| `authoritative` | Source of record for the claim, e.g. contract, official filing, live system evidence. |

Enterprise policy can require higher thresholds for weak or acceptable
sources. Example: a weak source might need five agents and two humans, while
an authoritative source might need one human confirmation.

## Source Ingestion

Sources can enter a research session from:

- web search/research agent output.
- uploaded docs or artefacts.
- room artefacts (#91/#98).
- memories, when `canRemember` and `canPreview` allow use.
- terminal evidence, when linked terminal permissions allow inspection.
- human answer in an ask.

Ingestion should call #92 capability checks when the source is permissioned:

- `canFind` to discover source.
- `canPreview` to inspect source.
- `canShare` to attach it to a research room/answer.
- `canRemember` before storing durable facts from it.

Denied or revoked sources should not be ingested into the research session.
If a grant is later revoked, the source remains in audit but gets a revoked
availability state.

## Agent Confirmation Primitive

Agent confirmation should be explicit and auditable.

Actions:

- `confirm`: source/claim supports the answer.
- `dispute`: source exists but does not support the claim.
- `reject`: source is invalid, inaccessible, or irrelevant.

Minimum confirmation record:

```json
{
  "claimId": "rc_123",
  "actorHandle": "@evolveantdeep",
  "actorKind": "agent",
  "verdict": "confirm",
  "note": "Official docs page states the limit directly.",
  "sourceRating": "strong"
}
```

Rules:

- Unique actor per claim counts once.
- An agent cannot satisfy a human confirmation requirement.
- Dispute/reject moves status away from verified until resolved.
- Confirmations should cite the exact source or quote hash they evaluated.

## User Confirmation Primitive

Human confirmation is a separate first-class action, not just a message reply.

User confirmation UI:

- shows source title, snippet, rating, and current confirmations.
- asks: Confirm / Dispute / Reject.
- optional note.
- records actor handle and timestamp.

For Solo mode, one user confirmation is enough even if zero agents confirm.
For Team and Enterprise, human confirmation is required in addition to agent
thresholds.

## Verification Status Computation

For each claim:

1. Count unique agent confirmations.
2. Count unique human confirmations.
3. Count disputes and rejects.
4. Apply policy for the source or session.
5. Emit badge.

Suggested status rules:

- `rejected`: one or more reject verdicts from a human owner/chair, or source
  is revoked/inaccessible.
- `disputed`: any active dispute not resolved.
- `verified`: policy threshold is satisfied and no active dispute/reject.
- `partially_verified`: at least one confirm but threshold not yet met.
- `unverified`: no confirmations.

All status calculations should be server-side and deterministic.

## Research Answer Shape

A research answer should include:

```json
{
  "answer": "Tailscale is the better default for OSS/self-hosted remote access; Cloudflare is stronger for enterprise edge exposure.",
  "verification": {
    "status": "verified",
    "requiredAgents": 2,
    "confirmedAgents": 2,
    "requiredPeople": 1,
    "confirmedPeople": 0,
    "sourceRating": "strong",
    "lastVerifiedAt": 1778971200000,
    "auditLink": "/research/rs_123/audit"
  },
  "citations": [
    {
      "sourceId": "src_1",
      "title": "Tailscale ACL documentation",
      "url": "https://tailscale.com/...",
      "claims": ["claim_1"]
    }
  ],
  "openDisputes": []
}
```

Answers can be visible before verification completes, but UI must label them
as unverified or partially verified.

## Tier Defaults and Overrides

### Solo

Default:

- `requiredAgents = 2`
- `requiredPeople = 1`
- rule: agents OR people.

Use case: individual operator wants confidence without blocking on people.

### Team

Default:

- `requiredAgents = 3`
- `requiredPeople = 1`
- rule: agents AND people.

Use case: internal team wants machine cross-check plus one human sign-off.

### Enterprise

Default:

- `requiredAgents = 3`
- `requiredPeople = 2`
- rule: agents AND people.
- per-source overrides available.

Override examples:

| Source type | Agents | People | Notes |
|---|---:|---:|---|
| Official filing | 2 | 1 | Primary source. |
| Vendor blog | 3 | 2 | Marketing claims need human review. |
| Internal finance doc | 1 | 2 | Human authority matters more. |
| Weak web source | 5 | 2 | Stricter until corroborated. |

Overrides should be stored as policy rows, not hardcoded in clients.

## Chair Integration

Chair should reduce research noise:

- Cluster duplicate research asks.
- Convert vague asks into canonical research questions.
- Assign agents to independent source checks.
- Track which claims still need confirmations.
- Open one human ask when a person confirmation is needed.
- Fan the final verified answer back to all waiting rooms/messages.

Chair should not silently downgrade thresholds. If a threshold cannot be met,
it should surface the blocker:

> "Need one more human confirmation before this can be marked verified."

## Audit Trail

Audit should record:

| Event | Required fields |
|---|---|
| research_session_created | room, creator, tier/policy |
| source_ingested | source, actor, permission decision id |
| claim_created | claim, source, actor |
| confirmation_added | claim, actor, verdict, note |
| status_changed | previous status, next status, reason |
| policy_changed | old policy, new policy, actor |
| source_revoked | source, grant/mapping id, actor |
| answer_published | answer id, verification badge snapshot |

The audit link in the badge should open a readable timeline of these events.

## Permissions

Research mode uses #92 permission decisions:

- `canFind`: discover source.
- `canPreview`: inspect source.
- `canShare`: include citation/source in answer.
- `canRemember`: store durable facts from source.
- `canExport`: produce research pack/download.
- `canEdit`: modify source metadata or claim text.

If a source cannot be shared, a research answer may reference that a source
exists only if `canPreview` and policy allow existence disclosure. Otherwise
it should say approval is needed without confirming specifics.

## UI Surfaces

### Web / OSS Baseline

- Room/message research mode selector.
- Research session panel with sources, claims, and verification badges.
- Basic confirm/dispute/reject actions.
- Audit timeline.

### Premium Native / Chair

- Research queue with grouped asks.
- Push/local notifications for human confirmation needed.
- Rich citation browser.
- Offline cache for permissioned research packs.
- Enterprise policy editor for per-source thresholds.

## Implementation Slices

### S1 — Policy and Badge Contract

- Add policy types and pure verifier.
- Unit tests for Solo OR, Team AND, Enterprise AND, disputes, rejects, and
  per-source overrides.
- No LLM calls needed.

### S2 — Research Session Store

- Tables for sessions, sources, claims, confirmations, and audit.
- Route to create/list sessions in a room.
- Route to add sources/claims.

### S3 — Confirmation Routes

- Add confirm/dispute/reject route.
- Compute and return verification badge after each action.
- Enforce unique actor count.

### S4 — Room UI

- Research mode selector.
- Session panel with source list and badge rendering.
- Human confirmation UI.

### S5 — Chair Workflow

- Chair clusters research asks.
- Chair assigns independent agents to source checks.
- Chair opens asks for human confirmation when thresholds require it.

### S6 — Enterprise Policy Editor

- Per-source threshold overrides.
- Configurable defaults by room/org/source type.
- Exportable audit.

## Risks

1. **False confidence.** A source can be authoritative but misread. Keep claim
   confirmation separate from source rating.
2. **Confirmation theatre.** Multiple agents using the same weak source should
   not imply strong verification. Store source ids and require independent
   source checks when policy asks for them.
3. **Permission leaks.** Research citations must respect #92 capability
   results, especially for existence disclosure.
4. **User fatigue.** Team/enterprise thresholds can generate many asks. Chair
   must dedupe and ask humans once per canonical decision.
5. **Native drift.** Clients must render badge state from the server instead
   of applying their own threshold logic.

## Acceptance Criteria

- Server can represent Solo, Team, Enterprise, and Custom policies.
- Server can compute a verification badge with status, required/confirmed
  agents, required/confirmed people, source rating, last verified time, and
  audit link.
- Agent confirmations and human confirmations are counted separately.
- Solo mode passes on `2 agents OR 1 user`.
- Team mode passes on `3 agents AND 1 user`.
- Enterprise mode supports `3+ agents AND 2+ people` and per-source overrides.
- Disputes/rejections prevent a claim from showing as verified.
- Research sources respect #92 capability decisions.
- Chair can cluster duplicate research asks and open one human confirmation
  ask per unresolved verification need.

## Open Questions

1. Should agent confirmations require independent sources, or can multiple
   agents confirm the same source in Solo/Team v1?
2. Should Enterprise require named human roles, e.g. legal/finance, rather
   than any two people?
3. Should weak sources be allowed to become verified with enough confirmations,
   or must they be upgraded/corroborated by stronger sources?

Recommendation: require independent source ids for Enterprise, allow same
source confirmations in Solo/Team v1, and let enterprise policy require human
roles later.
