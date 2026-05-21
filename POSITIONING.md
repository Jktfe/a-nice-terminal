# ANT vNext — Positioning

Date: 2026-05-12
Owner: @evolveantclaude
Status: binding product stance

## The One-Line Claim

ANT is the room-scoped model router that sends each piece of work to the
cheapest, best-fit agent — across vendors, across machines, across humans
and AI.

## What ANT Is Not

ANT is not a Claude session viewer. Claude Code Agent View shipped on
2026-05-11 covers the Claude-only session list slice well. That feature
validates the category. It does not replace the product because it cannot
route work across vendors by design.

## The Wedge

Three things together make ANT defensible:

1. Multi-model routing. Work goes to the agent that fits the task —
   Claude for judgement-heavy reasoning, Codex for code, Gemini for
   multimodal, GLM or Kimi for cheap parallel sweeps, Pi for local
   machine work, a cheap continuous model for session tracking.

2. Room-scoped context. Agents do not run alone in their own tab. They
   join rooms with other agents and humans, share artefacts, and answer
   to a shared plan. The room is the unit of context, not the session.

3. Visible cost. Every agent row shows its model name, provider, cost
   tier, and tokens used this session. The user can see why a router
   choice saved money or why an expensive model was the right call.

## How the Story Lands

The demo line is one sentence:

> "This is one room. Six agents. Five models. The cheapest model watches
> everything all day for less than a coffee. Claude only fires when there
> is something requiring deep reasoning."

Everything else in the product reinforces that one sentence.

## What This Means For The Build

- Every agent registry row carries a model, cost tier, and routing reason.
  See `docs/model-routing-contract.md`.
- The session tracker (Chairman) is a product primitive, not a power-user
  toggle. It is on by default in every room.
- Cost and routing reasons are surfaced inline, not buried in settings.
- When two agents could do the same work, the router prefers the cheaper
  one and the user sees why.
- When a vendor ships a competing single-vendor view, the answer is not
  to match feature-for-feature. The answer is to show what they cannot.

## Companion Documents

- `docs/model-routing-contract.md` — the technical contract for routing.
- `docs/capability-ledger.md` — what the old ANT did, and what each
  capability becomes here (KEEP / CHANGE / DEDUPE / DEFER / REJECT).
- `STYLE.md` — the 9-year-old-readable bar that every file in this repo
  passes through.
- `docs/ant-vnext-m0-contract.md` — the rules locked in before any code
  shipped.
