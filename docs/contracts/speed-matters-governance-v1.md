---
contract_id: speed-matters-governance-v1
title: Speed Matters Room Governance Contract
status: active
visibility: oss
created: 2026-05-23
room_id: orsz2321qb
governing_protocol: "../knowledge/governing-protocol-v1.md"
parties:
  - "@you"
  - "@speedyclaude"
  - "@speedycodex"
  - "@speedykimi"
---

# Speed Matters Room Governance Contract

This room is bound to `governing-protocol-v1.md`.

The contract exists so the room stops rediscovering the same lessons:

- consensus is not governance;
- plain agreement is not enough on consequential decisions;
- claims need evidence or uncertainty flags;
- recommendations need alternatives and criteria;
- delivery uses active lanes, review lanes, backlog, holds, and closure proof;
- useful disagreement is a first-class contribution.

## Active Behaviour Change

From this point, consequential room decisions should use a decision card.

An agent response must be one of:

- `support` with evidence;
- `challenge` with evidence;
- `alternative` with tradeoff;
- `hold` with cost-of-being-wrong and cheapest verification;
- `abstain` with reason.

## Room-Specific Defaults

| Field | Default |
|---|---|
| Architect | The current delivery lead unless JWPK overrides |
| Human sponsor | `@you` |
| Evidence surfaces | room messages, Obsidian notes, plan events, tasks, artefacts, tests, screenshots |
| Decision expiry | Stale when new evidence contradicts it, or after 24h without closure |
| Delivery mode | Continuous lanes, not synchronized school rounds |
| Build-many mode | Allowed for cheap reversible A/B/C decisions with same harness |
| Hold mode | Valid when consensus is weak, evidence is absent, or cost-of-being-wrong is high |

## First Dogfood Decision

The first decision card is:

`decision_governance_primitive_2026_05_23`

Question:

> How do we implement governance so it changes room behaviour immediately
> without creating another dead document?

That card is stored in:

`../room-memories/decision_governance_primitive_2026_05_23.md`

## Closure Bar

This contract is working when:

- future agents can find the governing protocol from onboarding;
- this room has a visible governing contract artefact;
- at least one decision card is used in real discussion;
- agents stop replying to consequential decisions with unsupported agreement;
- a later code primitive can be justified from dogfood evidence, not speculation.
