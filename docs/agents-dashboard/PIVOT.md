# 🔄 Agents Dashboard — Pivot & Deepen

**Feedback from James (2026-05-19):**
> "Meh. I feel like it's been done... this is an Ollama room we've lots of different agents... might look naff if done in light mode"

## 🎯 What We Heard

1. **Generic dashboard feel** — Status cards + timelines are table stakes
2. **Multi-agent reality** — You juggle Codex, Claude, Gemini, pi, Qwen, Copilot, Ollama — not just one agent type
3. **Light mode is first-class** — 50-70% of your time, can't be an afterthought
4. **Want to see the FLEET working together** — Not just individual agent status

---

## 🔍 What Makes THIS Different? (The Real Question)

Most agent dashboards show:
- ❌ Single agent status
- ❌ Generic activity feed
- ❌ One tool, one session

**Your reality:**
- ✅ 6+ agents running simultaneously
- ✅ Different agents in different rooms
- ✅ Agents switching between tasks/rooms
- ✅ Some agents stuck, some flowing
- ✅ Need to see **orchestration**, not just status

---

## 💡 New Direction: "The Conductor's View"

**Metaphor shift:** From "status dashboard" → "orchestration console"

### What You Actually Want to Know:

1. **Which agent is the bottleneck?** — Who's stuck vs flowing?
2. **Who should I hand the next task to?** — Which agent has capacity + right skills?
3. **What's the cross-agent story?** — Claude blocked on Gemini's output? Codex waiting on Copilot's review?
4. **Where's the friction?** — Permission queues, rate limits, context pressure across the fleet
5. **What did I actually ship today?** — Cross-agent output summary, not per-agent metrics

---

## 🎨 Visual Concept: "Agent Flow Map"

Instead of cards, think **sankey diagram meets subway map**:

```
┌─────────────────────────────────────────────────────────────────┐
│  ANT Fleet Flow — 14:32                                         │
│                                                                 │
│  [Rooms]          [Agents]              [Output Today]          │
│                                                                 │
│  antOllama ─────► [🤖 Claude] ────────► 23 files edited        │
│       │           [🤖 Codex]            156 lines written       │
│       │                │                8 tests passing         │
│       └───────────────►│                                       │
│                        │                                       │
│  antFarm ───────────► [🤖 Gemini] ───────► 12 files edited     │
│       │                │                  45 lines written      │
│       │                └──(blocked: rate limit)                │
│       │                                                        │
│  antAudit ──────────► [🤖 Copilot] ──────► 8 reviews done      │
│       │                │                  3 PRs commented       │
│       │                │                                       │
│       └───────────────►│                                       │
│                                                                 │
│  antSofia ──────────► [🤖 pi] ───────────► 34 msgs, 0 files    │
│       │                │                  (design discussion)   │
│       │                                                        │
│  antNative ─────────► [🤖 Qwen] ─────────► 5 files, 2 builds   │
│                                                                 │
│                                                                 │
│  ═══════════════════════════════════════════════════════════   │
│                                                                 │
│  Fleet Health: 4 flowing · 1 blocked · 1 idle                   │
│  Next available: [🤖 Ollama] (antFarm, idle 12m)                │
│  Bottleneck: [🤖 Gemini] (rate limit, resets in 23m)            │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight:** Shows **relationships** (which room → which agent → what output), not just status.

---

## 🌞 Light Mode First Design

**Nocturne light palette** (from `src/lib/nocturne.ts`):

```typescript
// Light mode surfaces
bg: '#F7F7F5'      // neutral[50]
elev: '#FFFFFF'    // white cards
panel: '#FBFBFA'   // neutral[50] variant
raised: '#FFFFFF'
hairline: 'rgba(0,0,0,0.06)'
text: '#1B1A15'    // neutral[800]
textMuted: '#5A584B'  // neutral[500]
textFaint: '#838173'  // neutral[400]
```

**Agent colors stay vibrant** on light bg:
- claude: coral `#E07856` — ✅ high contrast
- gemini: azure `#5B8DEF` — ✅ high contrast
- codex: jade `#2EBD85` — ✅ high contrast
- copilot: violet `#9B6BF0` — ✅ high contrast
- ollama: gold `#F2B65A` — ⚠️ needs darker stroke
- pi: (assign new color — deep teal?)

**State indicators for light mode:**
- Active: emerald `#17A14B` (darker than dark mode)
- Thinking: amber `#B46D04` (darker)
- Error: red `#D92D20` (higher contrast)
- Idle: neutral `#838173` (same)
- Offline: neutral `#5A584B` at 60% opacity

---

## 🔬 Deeper Research Questions

Before we design more, we need to understand:

1. **What's your actual multi-agent workflow?**
   - Do you hand off between agents (Claude → Codex → Copilot)?
   - Do agents collaborate in same room?
   - Do you run parallel sessions for speed?

2. **What decisions do you make looking at agents?**
   - "Which agent should I ask next?"
   - "Why is this agent stuck?"
   - "Did we make progress today?"
   - "Who's free for a new task?"

3. **What's missing from current ANT UI?**
   - Can you see all agents at once currently?
   - Do you know which agent is in which room?
   - Can you compare agent output?

---

## 📋 Proposed Next Steps

1. **Interview James** — 15 min: "Walk me through your last multi-agent session"
2. **Audit current multi-agent visibility** — What can you see TODAY in ANT?
3. **Prototype 3 concepts:**
   - Flow Map (sankey-style relationships)
   - Fleet Console (military ops room vibe)
   - Agent Roster (sports team bench view)
4. **Light mode mockups first** — Dark mode as inverse, not default

---

*Pivot document created: 2026-05-19*
*Authors: Erdos, Franklin, Kepler*
*Status: Waiting on James's workflow walkthrough*
