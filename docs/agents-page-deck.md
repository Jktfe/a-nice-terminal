# Agents Page — Pitch Deck

## Slide 1: Cover
**Title:** Agents Page — The Switchboard  
**Subtitle:** What are my bots up to?  
**Date:** 2026-05-19  
**Room:** ANTollama (c9rm0inoit)

---

## Slide 2: The Problem
**Current State:**
- ActivityRail shows sessions (ephemeral)
- No view of agent identities (persistent)
- Cannot answer: "Where is compute allocated?"
- Cannot answer: "Which agents need my attention?"
- Cannot answer: "What is falling through the cracks?"

**User Question:**
> "What are my bots up to?"

---

## Slide 3: Core Metaphor
**Switchboard, Not Dashboard**

| Dashboard | Switchboard |
|-----------|-------------|
| Stats display | Attention routing |
| Session-centric | Agent-centric |
| "What is running?" | "Who is working?" |
| Ephemeral view | Persistent identities |

**Key Insight:**
Sessions come and go. Agents move between them.

---

## Slide 4: Data Sources (No Schema Changes)
**Existing Data We Surface:**

1. **Agent Registry** (`agent-registry.ts`)
   - 14 agents across 3 tiers
   - Name, binary, launch command, availability

2. **Per-Session Telemetry** (`AgentStatus`)
   - Model, context %, state labels
   - Timestamps, duration, permission mode

3. **Hook Freshness** (`~/.ant/state/<cli>/<session>.json`)
   - mtimeMs → live/stale/absent

4. **Run Events** (`run_events` table)
   - Timestamped commands, tool calls, questions

5. **Room Membership** (`chat_room_members`)
   - Who is in which room, attention state

6. **Nocturne Palette** (`nocturne.ts`)
   - Per-agent identity colors

---

## Slide 5: Horizon 1 — The Canopy
**Header + At-A-Glance Strip**

```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo]  ☀  ?  ✨³  📋  ⚡  ⊞  [Filters]  ⚙                   │
│                    ↑                                            │
│         Sparkle icon with badge (3 agents active)               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  [● Ollama    ] [● Claude   ] [● Codex    ] [● Gemini   ]      │
│   Working       Available     Thinking      Idle                │
│   2 rooms       1 room        0 rooms       3 rooms             │
│   ─────         ─────         ─────         ─────               │
│   coral         azure         jade          gold                │
└─────────────────────────────────────────────────────────────────┘
```

**Specs:**
- Chips: 120px wide each
- Left border: agent identity color
- Dot: AgentDot component (breathing = active)
- Below name: font-mono 11px status + room count
- Click → scrolls to agent detail section
- Horizontally scrollable on mobile

---

## Slide 6: Horizon 2 — The Grid
**Agent Detail Cards (Responsive)**

```
┌────────────────────────────────────┐
│ ● claude-code  [T1] [gemma4:26b] ● │  ← Header
├────────────────────────────────────┤
│ 🟠 Working                         │  ← Status row
│ [████████░░] 78% context           │  ← Context bar
├────────────────────────────────────┤
│ [ANTollama●] [Sofia●] [Test○]      │  ← Room chips
├────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░          │  ← 24h sparkline
│ 247 events • Peak: 2-3pm           │
├────────────────────────────────────┤
│ ⏱ 2h14m  🔓 Bypass  📶 Live       │  ← Telemetry strip
└────────────────────────────────────┘
```

**Card Anatomy:**
1. Header: AgentDot + name + tier badge + model + availability
2. Status: ThinkingShimmer or plain label + context bar
3. Rooms: Up to 3 chips with attention indicators
4. Timeline: 24-hour SVG sparkline (no chart library)
5. Telemetry: Duration, permission mode, hook freshness

---

## Slide 7: Horizon 3 — The Detail Drawer
**Click to Expand**

```
┌─────────────────────────────────────────────────────────────────┐
│  claude-code — Full Profile                              [✕]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ROOM ROSTER (5 rooms)                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ANTollama    │ member    │ 2h14m  │ "Working on..."      │  │
│  │ Sofia        │ moderator │ 4h02m  │ "Permission wait"    │  │
│  │ Test         │ member    │ 15m    │ "Idle"               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  SESSION HISTORY (Last 10)                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ sofia-claude  │ active  │ 2h14m  │ /CascadeProjects/sofia│  │
│  │ test-run-42   │ archived│ 47m    │ /tmp/test             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  INTERACTION HEATMAP (7 days × 24 hours)                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  │
│  │ ... (7 rows, one per day)                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  CONTEXT PRESSURE                                               │
│  [████████░░] 78% used (22% remaining)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Slide 8: Tier-Aware Rendering
**Visual Density by Tier**

| Tier | Type | Card Style |
|------|------|------------|
| **T1** | Agentic CLIs (claude-code, gemini-cli, codex, copilot, qwen, pi, kimi) | Full card with all sections |
| **T2** | Local inference (ollama, lm-studio, llamafile, mlx-lm, msty) | Compact card (no drawer) |
| **T3** | Lightweight tools (llm, lemonade) | Collapsed row (status only) |

**T1 Full Card:**
```
┌────────────────────────────────────┐
│ ● claude-code  [T1] [model] ●      │
│ [Full card with all sections]      │
│ [Clickable → opens drawer]         │
└────────────────────────────────────┘
```

**T2 Compact:**
```
┌────────────────────────────────────┐
│ ● ollama  [T2] [gemma4:26b] ●      │
│ Working • 2 rooms • 78% ctx        │
└────────────────────────────────────┘
```

**T3 Collapsed:**
```
┌────────────────────────────────────┐
│ ● llm  [T3]  Idle • API required   │
└────────────────────────────────────┘
```

---

## Slide 9: ANT-Specific Differentiators
**What Makes This uniquely ANT:**

1. **Hook Freshness**
   - Not "is process running?"
   - But "is status reporter alive?"
   - Live (<30s) / Stale / Absent

2. **Room Membership as Primary Axis**
   - Not "what tasks running"
   - But "where is attention pointed"
   - Foregrounds chat_room_members.attention_state

3. **Focus Mode Surfacing**
   - Amber "FOCUS" chip with queue count
   - Highest-priority signal on page

4. **Permission Mode as Trust Signal**
   - "Bypass" in amber, "Default" in neutral
   - Critical security surface

5. **Tier Awareness**
   - T1 = agentic CLIs with rich state files
   - T2 = local inference runners
   - T3 = lightweight tools
   - Visual density matches capability

---

## Slide 10: Light/Dark Mode Parity
**Theming via surfaceTokens()**

| Token | Dark Mode | Light Mode |
|-------|-----------|------------|
| Background | #0C1021 (ink-900) | #F7F7F5 (neutral-50) |
| Card BG | #1B1A15 (ink-800) | #FFFFFF |
| Border | rgba(255,255,255,0.06) | rgba(0,0,0,0.06) |
| Text Primary | #E3E7F0 (ink-50) | #1B1A15 (neutral-800) |
| Text Muted | #BFC6D6 (ink-100) | #5A584B (neutral-500) |
| Sparkline (active) | 60% opacity | 40% opacity |
| Interior Glow | 14% opacity | 8% opacity |

**AgentDot:** No theme change — colors stay consistent.

---

## Slide 11: API Surface
**One New Endpoint:**

```
GET /api/agents

Response:
{
  "agents": [
    {
      "name": "claude-code",
      "tier": 1,
      "available": true,
      "launchCommand": "claude",
      "driverPath": "src/drivers/claude-code/driver.ts",
      "currentStatus": {
        "model": "gemma4:26b",
        "contextUsedPct": 78,
        "state": "Working",
        "permissionMode": "bypass",
        "sessionDurationMs": 8040000,
        "hookFreshness": "live"
      },
      "rooms": [
        {"id": "c9rm0inoit", "name": "ANTollama", "role": "member", "attention": "focused"},
        {"id": "xyz123", "name": "Sofia", "role": "moderator", "attention": "available"}
      ],
      "stats": {
        "totalSessions": 47,
        "activeSessions": 2,
        "totalRooms": 5,
        "messages24h": 247,
        "runEvents24h": 892
      }
    }
  ],
  "summary": {
    "totalAgents": 14,
    "availableCount": 7,
    "activeCount": 3,
    "focusRoomCount": 2
  }
}
```

**Built from existing data:**
- queries.listSessions()
- run_events aggregation
- chat_room_members joins
- agent-state-reader for live status

---

## Slide 12: Implementation Sequence
**Phase 1: API + Canopy (Week 1)**
- [ ] GET /api/agents endpoint
- [ ] Route: src/routes/agents/+page.svelte + +page.ts
- [ ] DashboardHeader: Add sparkle icon
- [ ] AgentStrip.svelte (horizontal chips)
- [ ] WS integration for live updates

**Phase 2: Grid Cards (Week 2)**
- [ ] AgentGridCard.svelte (T1 full cards)
- [ ] AgentCompactCard.svelte (T2)
- [ ] AgentRow.svelte (T3)
- [ ] SVG sparkline component (24 bars)
- [ ] Context bar component
- [ ] Room chips component

**Phase 3: Detail Drawer (Week 3)**
- [ ] AgentDetailDrawer.svelte
- [ ] Room roster table
- [ ] Session history list
- [ ] Interaction heatmap (7×24 grid)
- [ ] Context pressure indicator

**Phase 4: Polish + Alerts (Week 4)**
- [ ] Stale hook warnings
- [ ] Focus mode highlights
- [ ] Permission mode badges
- [ ] Mobile responsive tuning
- [ ] Keyboard navigation

---

## Slide 13: Component Tree
```
src/lib/components/AgentsPage/
├─ AgentsPage.svelte           # Main container
├─ AgentStrip.svelte           # H1: Horizontal chips
├─ AgentGridCard.svelte        # H2: T1 full cards
├─ AgentCompactCard.svelte     # H2: T2 compact
├─ AgentRow.svelte             # H2: T3 collapsed
├─ AgentDetailDrawer.svelte    # H3: Expansion
├─ AgentSparkline.svelte       # 24h SVG bar chart
├─ AgentContextBar.svelte      # Context usage progress
├─ AgentRoomChips.svelte       # Room membership pills
├─ AgentTelemetryRow.svelte    # Duration, permission, freshness
└─ AgentHeatmap.svelte         # 7×24 interaction grid

Reused Components:
├─ AgentDot.svelte             # Identity dot (breathing)
├─ ThinkingShimmer.svelte      # State indicator
├─ NocturneIcon.svelte         # Iconography
└─ surfaceTokens()             # Theme tokens
```

---

## Slide 14: Success Metrics
**How We Know It Works:**

1. **Time to Answer**
   - "Which agents need attention?" → <5 seconds
   - "What is claude-code working on?" → <10 seconds
   - "What fell through cracks?" → <15 seconds

2. **Operational Insights**
   - Hook staleness detected within 60s
   - Focus mode queue visible at a glance
   - Permission waits surfaced immediately

3. **User Behavior**
   - Daily active viewers > 80% of ANT users
   - Click-through to rooms > 40% of views
   - Reduced "where is my agent?" questions

4. **Technical Health**
   - Zero schema changes required
   - WS updates <100ms latency
   - Mobile Lighthouse score >90

---

## Slide 15: The Pitch
**One Glance Tells You:**

> "claude-code has been grinding on sofia for 2h 14m, 78% context used"
> "gemini stuck waiting for permission approval (47m)"
> "3 agents in focus mode across 2 rooms — 5 messages queued"
> "ollama hook silent 4min — something wrong"

**Not a dashboard. A switchboard.**

Not "what tasks are running" but **"where is attention allocated"**.

Not session-centric but **agent-centric**.

Not stats display but **attention routing tool**.

---

## Slide 16: Next Steps
**Ready to Build?**

1. Review this deck
2. Approve visual direction (Canopy → Grid → Drawer)
3. Greenlight Phase 1 (API + Canopy)
4. Start implementation

**Questions?**
- Tier density gradient clear?
- Hook freshness telemetry valuable?
- Room-centric axis makes sense?
- Light/dark parity sufficient?

---

**End of Deck**
