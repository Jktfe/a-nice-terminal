# Audit — antonline.dev (2026-05-08)

Lane A · M1 of `ant-positioning-launch-2026-05-08`. Observation-only;
no edits in this audit pass. Source: `Jktfe/antonline-dev`,
`src/routes/+page.svelte` last modified 2026-04-30.

## Page structure (top → bottom)

| # | Section | Headline | Purpose |
|---|---------|----------|---------|
| 1 | Header | (logo · Docs · GitHub) | Nav |
| 2 | Ticker band | (live activity strip) | Atmospherics |
| 3 | **Hero** | "Your AI team needs somewhere to work." | First impression |
| 4 | Agent paste | "Skip the docs. Tell your agent." | Fast install path |
| 5 | Snapshot band | "Not a terminal skin. A coordination layer." | Positioning |
| 6 | Video | "See the control room actually move." | Demo |
| 7 | Capabilities | "Built for actual agent work" (6 flip cards) | Features |
| 8 | Room | "Discuss, split, decide, and keep receipts." | Feature deep |
| 9 | Mobile (ANTios) | "The same coordination surface, built for thumb zones." | Mobile pitch |
| 10 | Install | "Run the control room on your own machine." | Self-host CTA |
| 11 | Footer | (logo · Docs · API · CLI · GitHub · MIT) | Nav |

## Existing claims (what the page says today)

- Self-hosted operating surface for agent sessions
- Terminal + chat pairs with PTY/linked-chat/status/history together
- Room Links for split discussions
- Prompt Bridge for needs-input visibility
- Evidence: searchable trail (messages, history, run events, tasks, refs)
- Agent Awareness from terminal activity (Codex-style CLIs)
- ANTios mobile chat-first triage
- 14 Agent CLIs · 6 Surfaces · 100% Open source · 4 layers of evidence
- MIT licence · self-hostable end-to-end

## Strengths

1. **"Coordination layer" framing is already on the page** (snapshot band). Doesn't need to be invented — needs to be promoted to the hero.
2. **Agent-install fast path** ("Skip the docs. Tell your agent.") is a genuinely clever device for the actual primary audience (people running AI CLIs). Worth keeping.
3. **Self-host install block** with concrete commands lowers the "is this real?" bar quickly.
4. **ANTios + mobile section** differentiates from generic agent UIs.
5. **MIT + self-hostable** addressed near the top.

## Gaps vs today's lived evidence

These are the things the page does NOT say but should. Each maps to
a captured proof point in `project_ant_positioning_proof_2026_05_08.md`.

### G1 · No human-in-the-loop story (the missing lead)

- Page frames ANT as serving a single owner of an AI team:
  "Your AI team needs somewhere to work."
- Today's strongest proof point is **two humans + two agents**:
  Mark+James shipping in half the time with no email-polling overhead.
- The page never mentions colleague-to-colleague collaboration.
  This is the relatable hook for non-developer readers and is
  absent from the hero, the snapshot band, and the capabilities grid.

### G2 · Page is feature-led, not outcome-led

- Capabilities grid lists what ANT *does* (6 cards × functionality).
- It does not list what *happens to the user*: limits-untouched,
  quality-up, halved cycle time, no email polling.
- Hero h1 is feature-flavoured ("...needs somewhere to work").
  Outcome-flavoured alternative: "Two people, two AI assistants,
  half the time, no email back-and-forth."

### G3 · The natural sceptic objection is unanswered

- A reader thinking "wouldn't this multi-agent + multi-room +
  broadcast-routing thing blow up token spend?" finds nothing
  on the page that answers them.
- Today's lived counter-evidence: heavy week, limits untouched,
  token spend down because each agent stays specialised.
- The four mechanisms (zero-token CLI, bounded context, plan-as-truth,
  cap-2 lane discipline) have no surface here.

### G4 · The ticker is fake-data

- Ticker shows specific numbers: "Rooms 6 · Linked chats 11 · Open
  tasks 24 · Evidence today 142 / +12 · Models wired 12".
- These are hardcoded in `+page.svelte`. Reader-side, this reads as
  filler the moment they parse it (or worse, dishonest if they assume
  it's real). Either tie to live data via a public stats endpoint or
  remove and replace with concrete proof points.

### G5 · Agent-paste comes before the positioning

- Section order: Hero → **Agent paste** → Snapshot ("coordination layer")
  → Video → Capabilities.
- A first-time visitor who doesn't already know what ANT is hits the
  "paste this into Claude" block before "what is ANT for?" is
  established. The fast-path block is great content; it just needs
  to come AFTER the "what is this?" answer.

### G6 · Stats row is weak proof

- "14 Agent CLIs / 6 Surfaces / 100% Open source / 4 layers of evidence"
- These are capability counts, not outcome metrics. Replacing with
  e.g. "0 token-limits hit this week" / "Multi-human cycle time
  halved on a Mark+James session" / "Two-LLM contract sync closed
  in 35 hours, no merge conflicts" would land harder.

### G7 · No Windows / scoop / antchat path

- The page treats ANT as a server you run + agents you launch.
- Windows users / standalone-chat users now have a real path:
  scoop bucket `Jktfe/scoop-antchat`, antchat single-binary v1.1.1,
  Windows-x64 release. None of this surfaces on antonline.dev.
- @antCC's wezwatch + windowsANT contract sync that completed today
  is invisible to a reader.

### G8 · Demo asset depends on a static MP4

- Video section embeds `/product/ant-demo.mp4` (poster
  `/product/ant-demo-poster.jpg`).
- Need to verify both files exist in the repo and load. If they
  exist, the question is whether the demo still represents v3
  and whether to replace with a multi-agent-coordination capture
  (which is the actual story we want to tell now).

### G9 · No cross-references between surfaces

- README → antonline.dev: not verified
- antonline.dev → scoop bucket: absent
- antonline.dev → releases page: absent (only links to GitHub repo
  default)
- README → antonline.dev → scoop → releases round-trip is part of
  M9 acceptance; today the round-trip is broken in multiple places.

### G10 · CTA hierarchy is timid

- Hero CTAs: "Get started" → /docs and "View source" → GitHub.
- "Get started" actually lands on documentation, not on a doing-step.
- The agent-paste fast path is the real "do something now" affordance
  but it's a section below the hero. Either elevate it to the hero
  CTAs, or rename the docs CTA to "Read the docs" so the fast-path
  has the primary slot.

## Recommended structural changes (for M3/M5 milestones)

This audit only captures gaps. Concrete copy + structural changes
land in M3 (hero rewrite) and M5 (mechanism / objection section).
The shape that follows from this audit:

1. **New hero** (M3) leads with multi-human/multi-agent outcome
   ("Two people, two AI assistants, half the time, no email
   back-and-forth"), then a one-line mechanism + dual CTA where the
   primary is the agent-paste fast path.
2. **New "what you might worry about" section** (M5) directly answers
   G3, with the four mechanisms wired to chat-break m3,
   plan-as-truth, cap-2, zero-token CLI.
3. **Stats row** swapped to outcome metrics from the captured proof
   points, not capability counts.
4. **Ticker** either retired or wired to a real
   `/api/public/stats` endpoint (decision needed; flag for James).
5. **Section reorder**: Hero → Snapshot ("coordination layer") →
   Agent-paste fast path → Mechanism/objection answer → Video →
   Capabilities → Room → Mobile → Windows/scoop → Install.
6. **Cross-link work** (M9) adds links from antonline.dev → scoop
   bucket and → releases.

## Assumptions worth confirming with James before M3

1. **Tone**: he said "shit-hot OSS frankly everyone should use" —
   confirms a slight punchier voice than the current restrained
   register. Not a dramatic shift.
2. **Mark by name**: is naming Mark in the hero acceptable, or
   anonymise to "two colleagues"? Naming is more credible if Mark
   consents.
3. **Ticker fate**: keep with real data, or retire?
4. **Demo asset**: keep current ant-demo.mp4, replace with new
   multi-agent capture, or swap for the silent looped GIF that codex
   prefers for the README?

## Out of scope for this audit

- README audit (lane B / M2, codex)
- Hero copy drafting (M3)
- Mechanism section drafting (M5)
- Cross-link wiring (M9)

## Closing note

The page is structurally healthy and the writing is competent. The
gap is not quality — it's that the page was written before today's
lived multi-human evidence existed. The work is to swap feature-pitch
for outcome-pitch, lead with Mark+James, and answer the sceptic
objection on the page.
