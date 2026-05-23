---
contract_id: room-state-away-mode-v1
title: Room State and Away Mode Contract
status: active
visibility: oss
created: 2026-05-23
room_id: orsz2321qb
parties:
  - "@you"
  - "@speedyclaude"
  - "@speedycodex"
  - "@speedykimi"
linked_contracts:
  - speed-matters-governance-v1
  - exploration-backlog
  - build-both-pending
---

# Room State and Away Mode Contract

This contract fixes the failure mode exposed on 2026-05-23: agents treated
"do not spam while JWPK is away" as permission to go quiet. That is wrong.
Away mode means lower-noise delivery, not lower agency.

## Hard Rule

Every active delivery room must have one visible room state. Agents check the
state before claiming work, posting updates, paging the user, or switching from
delivery to exploration.

When state is missing or stale, the Chair must set it before assigning more
feature work.

## Room States

| State | Meaning | Agent behaviour | User contact |
|---|---|---|---|
| `brainstorm` | Shape ideas, challenge assumptions, compare options. | No code unless explicitly asked. Bank decisions and alternatives. | Chat is fine. |
| `heads-down` | Claimed implementation lane. | Claim before edit, scope before code, TDD where applicable, peer review before merge. | Ask only for blockers. |
| `delivery` | Multiple bounded lanes active. | Keep shipping small verifiable slices. Chair maintains claim map and prevents overlap. | Compact digests or blockers. |
| `away-from-desk` | User is mobile or temporarily unavailable. | Continue bounded delivery. Use open asks for real decisions. No idle silence. | Ask primitive for decisions; compact digest. |
| `away-from-office` | User unavailable for several hours. | Continue only work covered by contract. Use exploration backlog or build-many when blocked. | Page only for security, destructive risk, cost blowout, or merge-blocking decision. |
| `away-from-phone` | User effectively unreachable. | Stop high-risk decisions. Work on reversible slices, parked variants, audits, tests, docs, and assets. | Emergency page only. |
| `hold` | Delivery paused by user, Chair, or failed gate. | No feature merges. Produce diagnosis, contract fix, or decision artifact. | One clear ask or digest. |

## Away Mode Tiers

| Tier | Typical duration | Allowed autonomy | Cadence |
|---|---:|---|---|
| `desk` | 30m-2h | Bounded implementation and review. | Digest on ship/blocker. |
| `office` | 2h-8h | Contract-covered delivery, build-many for cheap reversible choices, exploration backlog when blocked. | Digest every 2h or material event. |
| `phone` | 1-3 days | Reversible work only unless prior contract permits deeper decisions. | 6h digest; emergency page only. |

## Chair Duties

The Chair owns coordination, not every implementation.

- Maintain the live claim map.
- Set or confirm the room state after a context break or user availability change.
- Convert real blockers into open asks.
- Close or park noisy auto-extracted asks.
- Push idle agents into a bounded lane, the exploration backlog, or hold.
- Stop agents who drift into unowned work.
- Produce compact digests; do not fill the room with no-op cycle reports.

## Agent Duties

Agents do not wait silently.

When assigned work is blocked or done, an agent must choose one:

- claim the next unblocked task;
- review another agent's shipped slice;
- pick an item from `exploration-backlog`;
- build cheap A/B/C variants under the build-many rule;
- produce a bounded audit or decision artifact;
- post a blocker as an open ask.

Standing by without one of those outcomes is a contract breach.

## Build-Many Rule

When the blocker is a user choice between cheap reversible options, agents may
prepare more than one option instead of waiting. The output must be inspectable:
URLs, screenshots, tests, branch names, or parked worktrees.

Build-many is allowed only when:

- options are cheap and bounded;
- each option can be validated independently;
- the comparison is posted in one mobile-readable message;
- the losing option can be deleted or archived cleanly.

## Merge Rules While User Is Away

| Change type | Away-from-desk | Away-from-office | Away-from-phone |
|---|---|---|---|
| Docs/contracts/capability ledger | Chair or peer review | Chair or peer review | Peer review |
| Tests only | Peer review | Peer review | Peer review |
| Reversible UI polish | Peer review | Peer review | Hold unless pre-approved |
| Auth/security containment | Peer review + focused probes | Peer review + focused probes | Page if risk is material |
| Schema/data migration | Ask unless already contracted | Ask | Hold |
| Premium/moat implementation | Ask unless explicitly contracted | Hold | Hold |
| Destructive cleanup | Hold | Hold | Hold |

## Context Breaks

Context breaks are boundaries for default work.

- Start from post-break room context, room-pinned artefacts, and active
  contracts.
- Do not search older chat or private memories by default.
- Crossing a break requires a reason and should be visible in the work note.
- Server-side enforcement should be configurable per room; this contract is the
  behavioural rule until the setting exists.

## Current Default For `orsz2321qb`

When JWPK says "I am away from my desk" with no further override:

- state: `away-from-desk`;
- Chair: current appointed Chair, presently `@speedyclaude`;
- delivery: continue bounded contracted slices;
- contact: open asks only for real decisions or blockers;
- cadence: ship/blocker updates plus compact digest, not no-op cycle reports.

## Acceptance

This contract is working when:

- a returning mobile user can see the current state and next ask in one glance;
- no agent idles silently for hours while claiming to be in delivery mode;
- blocked agents produce useful artifacts or open asks;
- the Chair can stop overlap and restart momentum without user archaeology;
- future server/UI work can map these states into real room controls.
