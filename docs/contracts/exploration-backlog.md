---
contract_id: exploration-backlog
title: "Exploration backlog — claimable pivot items when bound work blocks"
status: living-document
parties: ["@speedyclaude", "@speedycodex", "@speedykimi", "@you"]
linked_rooms: ["orsz2321qb"]
created_at: 2026-05-22
visibility: oss
---

# Exploration backlog

Per [[overnight-agent-delivery-v1]] §8 "Legitimate pivots when blocked": when an agent's bound work is blocked or done and bandwidth remains, they pick from this backlog rather than polling or manufacturing busywork.

## Rules

- **Anyone can ADD** — agents, JWPK. Append to the list with one line: `- ⏳ <item> — <why> (suggested by @handle, <date>)`
- **Claim via** the standard ANT task protocol: agent posts `claim:<item>`, opens a task with scope + acceptance + stop condition, marks the item 🔵 + handle
- **Outputs MUST land somewhere durable**: banked memory file, dev-parked worktree, contract MD. Lost work doesn't count.
- **Mark done** ✅ + commit SHA / memory file path
- **Stale items** (>14 days unclaimed) get archived to `## archived` not deleted

## Status legend

- ⏳ unclaimed
- 🔵 claimed (in flight)
- ✅ done
- 🟡 paused / re-released
- 📦 archived (stale)

## Items

(JWPK to pre-seed before clocking out 2026-05-22.)

- ⏳ Build-Both pilot: pick one ambiguous open decision from this session and prove the pattern (feedback-panel-inline vs floating-side is a candidate) — proposed @speedyclaude 2026-05-22
- ⏳ Refactoring audit: scan `/api/chat-rooms/*` handlers for the auth-after-load anti-pattern in other places — proposed @speedyclaude 2026-05-22
- ⏳ Memory consolidation: cross-link the trust-thesis + Stage + validation-as-lenses + room-memory specs (some `[[wikilinks]]` may be one-way) — proposed @speedyclaude 2026-05-22
- ⏳ Demo asset: render the M-Demo walkthrough deck as a 2-min screencast so JWPK can share without driving the URL himself — proposed @speedyclaude 2026-05-22
- ⏳ Research: cross-iframe `postMessage` shape needed for Stage ζ (wrap external Slidev/Canva/Google Slides) — proposed @speedyclaude 2026-05-22

## archived

(none yet)
