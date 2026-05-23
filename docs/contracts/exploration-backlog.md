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
- ✅ Refactoring audit: scan `/api/chat-rooms/*` handlers for the auth-after-load anti-pattern in other places — @speedyclaude 2026-05-23. Output: `docs/audits/auth-pattern-sweep-2026-05-23.md` with corrected verdicts (initial draft over-extrapolated; 5/6 endpoints public-by-design).
- ✅ Memory consolidation: cross-link the trust-thesis + Stage + validation-as-lenses + room-memory specs — @speedyclaude 2026-05-23. All 12 cross-links present (4 specs × 3 partners each); wider corpus rot banked at `project_wikilink_rot_finding_2026_05_23.md` for a future slice.
- ⏳ Demo asset: render the M-Demo walkthrough deck as a 2-min screencast so JWPK can share without driving the URL himself — proposed @speedyclaude 2026-05-22
- ✅ Research: cross-iframe `postMessage` shape needed for Stage ζ — @speedyclaude 2026-05-23. Output: `docs/research/stage-zeta-postmessage-2026-05-23.md` — per-source capability matrix (Slidev/Reveal.js full postMessage; Canva/Google Slides URL-fragment-only; PDF via pdf.js), recommended protocol shape, 5-slice ζ-1..ζ-5 plan, security + open questions.

## archived

(none yet)
