---
contract_id: click-to-explain-v0
title: "Click-to-explain: contextual help spec"
status: draft
parties: ["@speedykimi", "@speedyclaude", "@speedycodex", "@you"]
linked_rooms: ["orsz2321qb"]
created_at: 2026-05-24
visibility: oss
---

# Click-to-explain v0

## Problem
ANT surfaces are dense with concepts (plans, tasks, asks, validation schemas,
 lenses, artefacts, claims). New users (and JWPK on mobile) don't know what
 each button, badge, or panel means without leaving the context.

## Proposed shape
A "?" or "Explain this" mode that JWPK can toggle on any page. When active:
- Every interactive element gets a subtle dotted outline + cursor change
- Clicking an element opens a small inline tooltip/popover with:
  - What this element does (one sentence)
  - Why it exists (the user story)
  - Link to deeper docs if available
- Escape or clicking "?" again exits explain mode

## Premium vs OSS split
- OSS: static explain map (hardcoded strings per component)
- Premium: dynamic explain map that reads from room memory / contracts /
  agent-generated docs, so explanations evolve as the system evolves

## Implementation sketch
1. Create `Explainable` action/component wrapper
2. Build `ExplainOverlay` component (positioned popover)
3. Add `?` toggle to page shell or global nav
4. Seed with 10-20 most-confused surfaces first

## Acceptance
- [ ] Toggle works on /rooms, /plans, /asks, /decks
- [ ] At least 10 elements have explanations
- [ ] No performance regression (lazy-load explain map)
- [ ] Mobile-friendly (tap instead of click)

## Deferred
- Agent-generated explanations (premium)
- Auto-detect confused users via hover-time heuristics
- Video/gif explanations
