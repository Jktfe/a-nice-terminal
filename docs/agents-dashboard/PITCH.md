# 🤖 ANT Agents Dashboard — "What Are My Bots Up To?"

**Authors:** Erdos, Franklin, Kepler (ANT Ollama agent trio)  
**Date:** 2026-05-19  
**Purpose:** Research & pitch — visual dashboard showing agent activity across the fleet

---

## 🎯 Vision

A single glance should tell you everything about your agent fleet:
- **Who's working** vs who's stuck
- **Which rooms** have active collaboration  
- **What blockers** need your attention
- **How much progress** was made today

---

## 📊 What We Discovered (Deep ANT Research)

### Agent Registry — 17 Agents Across 3 Tiers

ANT already tracks **17 agents** with rich metadata:

| Tier | Agents | Purpose |
|------|--------|---------|
| **Tier 1** | claude-code, gemini-cli, codex-cli, copilot-cli, qwen-cli, pi, kimi-code | Agentic coding CLIs |
| **Tier 2** | ollama, lm-studio, llamafile, mlx-lm, msty | Local inference CLIs |
| **Tier 3** | llm, lemonade | Lightweight CLI tools |

Each agent has:
- ✅ **Unique color** (Nocturne design system): claude=coral, gemini=azure, codex=jade, copilot=violet, ollama=gold, lmstudio=rose
- ✅ **Availability status**: runtime binary check via `which`
- ✅ **Driver spec**: fingerprint extraction rules, state file paths
- ✅ **Launch command**: how to spawn interactively

### Live Telemetry — Already Captured!

Every agent broadcasts rich status via WebSocket:

```typescript
interface AgentStatus {
  model?: string;              // e.g. "gemma4:26b"
  contextUsedPct?: number;     // context window usage
  rateLimitPct?: number;       // API rate limit headroom
  state: 'ready'|'busy'|'thinking'|'focus'|'error'|'idle'|'unknown'
  stateLabel?: 'Available'|'Working'|'Menu'|'Permission'|'Response needed'|'Waiting'
  activity?: string;           // current action description
  workspace?: string;          // git workspace name
  branch?: string;             // current git branch
  focus?: {                    // focus mode (TS-006)
    roomId: string;
    roomName?: string;
    reason?: string;
    expiresAt?: number;
    queueCount?: number;       // messages waiting!
  }
  timestamps?: {
    sentAt?: number;   // last user message epoch ms
    respAt?: number;   // last assistant reply epoch ms
    editAt?: number;   // last tool invocation epoch ms
  }
  sessionStartedAt?: number;
  sessionDurationMs?: number;
  permissionMode?: string;     // e.g. "bypass permissions on"
  cwd?: string;                // working directory
  menu?: AgentMenu;            // structured menu when parked
  detectedAt: number;          // freshness timestamp
}
```

### Activity History — `run_events` Table

Every agent interaction is logged:

```sql
CREATE TABLE run_events (
  session_id TEXT NOT NULL,
  ts_ms INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('acp','hook','json','rpc','terminal','status','tmux')),
  trust TEXT NOT NULL CHECK(trust IN ('high','medium','raw')),
  kind TEXT NOT NULL,          -- event type
  text TEXT DEFAULT '',
  payload TEXT DEFAULT '{}',   -- structured event data
  created_at TEXT DEFAULT (datetime('now'))
)
```

Events include: **tool invocations, file edits, terminal commands, permission requests, questions asked, errors, progress updates**

### Per-Agent Metrics — What Exists TODAY

| Metric | Source | Queryable |
|--------|--------|-----------|
| **Messages sent** | `messages.sender_id` | ✅ COUNT(*) per session |
| **Rooms joined** | `chat_room_members` | ✅ All rooms per agent |
| **Tasks claimed** | `tasks.assigned_to` | ✅ By status (proposed/claimed/done) |
| **Time active** | `sessions.last_activity` + in-memory state | ✅ Derived: working/thinking/idle |
| **Asks answered** | `asks.assigned_to` + `status` | ✅ Answer rate, latency |
| **WebSocket presence** | `ws-broadcast.ts` client map | ✅ Active/idle/offline per handle |
| **Focus mode** | `sessions.attention_*` + `chat_focus_queue` | ✅ Queue counts, expiry |
| **Context pressure** | `AgentStatus.contextUsedPct` | ✅ Real-time % |
| **Rate limit headroom** | `AgentStatus.rateLimitPct` | ✅ Real-time % |

---

## 🎨 Proposed Dashboard Layout

### Header Section

```
┌─────────────────────────────────────────────────────────────────┐
│  [ANT logo]  Agents                              [🌙] [?] [⚙]  │
│                                                                 │
│  Fleet Status: 4 Active · 2 Thinking · 8 Idle · 3 Offline      │
│  Total Sessions: 12 · Rooms Joined: 8 · Tasks Claimed: 23      │
└─────────────────────────────────────────────────────────────────┘
```

**Badge API integration:**
- 🟢 Green badge: agents currently `active` or `thinking`
- 🟡 Amber badge: agents in `Menu` or `Permission` state (need attention)
- 🔴 Red badge: agents in `error` state

---

### Section 1: Agent Grid (Primary View)

**Layout:** 3-column responsive grid (reuse `GridView.svelte` pattern)

Each **Agent Card** (extend `AgentCard.svelte`) shows:

```
┌───────────────────────────────────────────┐
│  [🤖 Claude]                      [●]    │  ← AgentDot with coral color
│  claude-code · Tier 1                     │
│                                           │
│  ═══════════════════════════════════════  │
│                                           │
│  State:     [WORKING]  (amber pulse)      │
│  Model:     claude-sonnet-4-20250514      │
│  Context:   ████░░░░░░ 42% used           │
│  Rate Limit: ████████░░ 80% headroom      │
│                                           │
│  📍 Room:   antOllama                     │
│  📁 Workspace: a-nice-terminal            │
│  🌿 Branch:  feature/agents-dashboard     │
│                                           │
│  ⏱ Session: 2h 34m                        │
│  🕐 Last activity: 3m ago                 │
│                                           │
│  ───────────────────────────────────────  │
│                                           │
│  Recent Activity:                         │
│  ✓ Edited src/lib/components/AgentCard   │
│  ✓ Ran bun test tests/agent.test.ts      │
│  ⏳ Waiting for permission: write_file    │
│                                           │
│  [View Session] [View Room] [Focus]       │
└───────────────────────────────────────────┘
```

**Visual Enhancements:**
- ✨ **Breathing animation** (already in `AgentDot.svelte`) when `active` or `thinking`
- ✨ **Radial gradient glow** using agent's color
- ✨ **Signal bars** (`SignalBars.svelte`) showing connection health
- ✨ **Color-coded state badge**: green=ready, amber=thinking/menu, red=error, gray=offline
- ✨ **Grain texture overlay** (from `AgentCard.svelte`) for premium feel

---

### Section 2: Activity Timeline (What They're Working On)

**Layout:** Vertical timeline (adapt `PlanView.svelte` event stream pattern)

```
┌─────────────────────────────────────────────────────────────────┐
│  Live Activity Feed                                [Auto-scroll]│
│                                                                 │
│  14:32  [🤖 Claude]   Edited src/lib/components/AgentCard.svelte
│          └─ a-nice-terminal · antOllama                         │
│                                                                 │
│  14:31  [🤖 Codex]    Ran tests (7 passed, 2 failed)            │
│          └─ tfeSvelteTemplates · antAudit                       │
│                                                                 │
│  14:29  [🤖 Ollama]   Asked: "Which model should I use?"        │
│          └─ ManorFarmOS · antFarm                               │
│                                                                 │
│  14:27  [🤖 Gemini]   Tool: write_file → docs/README.md         │
│          └─ manorfarmvar · antSofia                             │
│                                                                 │
│  14:25  [🤖 Copilot]  Permission: execute_command               │
│          └─ antios · antNative                                  │
│                                                                 │
│  14:22  [🤖 Claude]   Focus mode: antOllama (expires in 23m)    │
│          └─ Queue: 3 messages waiting                           │
└─────────────────────────────────────────────────────────────────┘
```

**Event Icons** (from `NocturneIcon.svelte`):
- 🖥️ `terminal` — command execution
- 💻 `cpu` — local processing
- ☁️ `cloud` — API call
- ✨ `sparkle` — AI generation
- 📥 `inbox` — message received
- ❌ `x` — error

**Trust Tier Indicators:**
- 🔒 High trust: command blocks, file writes (fully rendered)
- ⚠️ Medium trust: parsed tool calls
- 📄 Raw: unprocessed output (escaped, not rendered)

---

### Section 3: Room Occupancy Map (Which Rooms Are They In?)

**Layout:** Table or card grid

```
┌─────────────────────────────────────────────────────────────────┐
│  Room Occupancy                                                  │
│                                                                 │
│  Room              Agents Present          Activity Level        │
│  ────────────────────────────────────────────────────────────   │
│  antOllama         [🤖 Claude] [🤖 Ollama]  ████████░░ High      │
│                    2 agents · 47 msgs/hr                        │
│                                                                 │
│  antFarm           [🤖 Gemini]              ████░░░░░░ Medium    │
│                    1 agent · 12 msgs/hr                         │
│                                                                 │
│  antAudit          [🤖 Codex]               ██████░░░░ Medium    │
│                    1 agent · 23 msgs/hr                         │
│                                                                 │
│  antSofia          [🤖 Ollama]              ██░░░░░░░░ Low       │
│                    1 agent · 5 msgs/hr                          │
│                                                                 │
│  antNative         [🤖 Copilot]             ██████████ Very High │
│                    1 agent · 89 msgs/hr                         │
└─────────────────────────────────────────────────────────────────┘
```

**Click-through:** Each room name links to `/r/[roomId]` web UI

---

### Section 4: Progress & Performance Stats

**Layout:** Stats cards + charts

```
┌─────────────────────────────────────────────────────────────────┐
│  Today's Performance (Last 24 Hours)                            │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────┐│
│  │  Messages    │  │  Tool Calls  │  │  Files       │  │Errors││
│  │    847       │  │    234       │  │    156       │  │  12  ││
│  │  ↑ 23%       │  │  ↑ 45%       │  │  ↑ 12%       │  │ ↓ 67%││
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────┘│
│                                                                 │
│  Top Agents by Activity:                                        │
│  1. [🤖 Claude]   234 msgs · 89 tool calls · 45 files edited    │
│  2. [🤖 Codex]    189 msgs · 67 tool calls · 34 files edited    │
│  3. [🤖 Ollama]   156 msgs · 45 tool calls · 28 files edited    │
│  4. [🤖 Gemini]   134 msgs · 34 tool calls · 23 files edited    │
│  5. [🤖 Copilot]   98 msgs · 28 tool calls · 18 files edited    │
└─────────────────────────────────────────────────────────────────┘
```

**Chart Options:**
- Use existing `ProgressRing.svelte` for circular stats
- Use `ProgressBar.svelte` for linear progress
- Consider adding a simple SVG line chart component (no heavy deps)

---

### Section 5: Attention Required (Blockers & Questions)

**Layout:** Alert-style cards (adapt `AgentEventCard.svelte`)

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ Attention Required (3)                           [Mark All] │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ [🤖 Claude]  Permission Required                           │ │
│  │                                                            │ │
│  │  Session: antOllama · a-nice-terminal                     │ │
│  │  Request: write_file → src/lib/components/AgentGrid.svelte│ │
│  │                                                            │ │
│  │  [Approve] [Deny] [Ask for Context]                       │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ [🤖 Ollama]  Question: Model Selection                     │ │
│  │                                                            │ │
│  │  Session: antFarm · ManorFarmOS                           │ │
│  │  "Which vision model for floor plan detection?"           │ │
│  │                                                            │ │
│  │  Options:                                                 │ │
│  │  • granite-vision-3.3-2b (local, fast)                    │ │
│  │  • llava-34b (local, accurate)                            │ │
│  │  • gpt-4-vision (cloud, best)                             │ │
│  │                                                            │ │
│  │  [Select Option] [Postpone]                               │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ [🤖 Copilot]  Error: Rate Limit Exceeded                   │ │
│  │                                                            │ │
│  │  Session: antNative · antios                              │ │
│  │  Reset in: 23 minutes                                     │ │
│  │                                                            │ │
│  │  [Retry Now] [Switch Model]                               │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Technical Implementation Plan

### Phase 1: Data Layer (Week 1)

1. **Create `src/lib/server/agentsDashboardData.ts`**
   - Aggregate queries for fleet summary
   - Room occupancy calculation
   - Activity feed assembly (last 100 events)
   - Performance stats (24h window)

2. **Create `src/routes/api/agents/dashboard/+server.ts`**
   - REST endpoint for dashboard data
   - Caching strategy (5s TTL for live data)
   - Auth: `ANT_API_KEY` or room tokens

3. **Create `src/lib/stores/agents-dashboard.svelte.ts`**
   - Reactive store for dashboard state
   - WebSocket subscription for live updates
   - Polling fallback (10s interval)

### Phase 2: UI Components (Week 2)

1. **`AgentGrid.svelte`** (new) — 3-column responsive grid
2. **`AgentCardEnhanced.svelte`** (extend existing) — telemetry + actions
3. **`ActivityTimeline.svelte`** (new) — vertical event stream
4. **`RoomOccupancyTable.svelte`** (new) — room → agent mapping
5. **`PerformanceStats.svelte`** (new) — stats cards + charts
6. **`AttentionRequired.svelte`** (extend `AgentEventCard.svelte`) — blockers

### Phase 3: Navigation & Routing (Week 3)

1. **Add route: `src/routes/agents/+page.svelte`** — main dashboard page
2. **Update `DashboardHeader.svelte`** — add "Agents" nav link + badge
3. **Add route: `src/routes/agents/[id]/+page.svelte`** — individual agent detail

### Phase 4: Polish & Performance (Week 4)

1. Virtualization for long activity feeds
2. Skeleton loaders for initial data fetch
3. Error boundaries for partial failures
4. Theme support (light/dark mode)
5. Mobile responsiveness (stack on narrow screens)
6. Keyboard navigation (arrow keys, shortcuts)

---

## 🎯 Why This Is Exciting

### 1. Instant Situational Awareness
One glance tells you:
- Which agents are working vs stuck
- Which rooms have active collaboration
- What blockers need your attention
- How much progress was made today

### 2. Fleet Optimization Insights
- Spot underutilized agents (idle too long)
- Identify bottlenecks (rate limits, permission queues)
- Balance load across agents
- Choose the right agent for the next task

### 3. Debugging & Troubleshooting
- See error patterns across agents
- Trace activity timelines for specific sessions
- Understand context window pressure
- Monitor rate limit headroom

### 4. Pride & Delight
- Beautiful visual design (Nocturne theme)
- Satisfying animations (breathing dots, pulse glows)
- Premium feel (grain textures, gradient glows)
- Agent personalities through colors and icons

### 5. Research Depth Demonstrated
This pitch shows we understand:
- The 3-tier agent architecture
- Fingerprint-driven driver system
- State file hook integration
- run_events logging contract
- Focus mode and attention states
- Permission and question handling
- WebSocket broadcast channels
- Nocturne design system tokens
- Existing component library patterns

---

## 📋 Next Steps (Research-Only, No Code Yet)

1. ✅ **Validate data availability** — Confirm all proposed metrics exist in DB/WS
2. ❓ **User research** — Ask James: "What's the ONE thing you most want to see?"
3. ❓ **Prioritize sections** — Which sections are MVP vs nice-to-have?
4. ❓ **Design review** — Does the mockup match James's vision?
5. ⏸️ **Technical spike** — Prototype the dashboard data aggregator
6. ⏸️ **Component audit** — What can be reused vs needs new builds

---

## Appendix: Agent Color Palette (Nocturne)

| Agent | Color | Glow | Hex |
|-------|-------|------|-----|
| claude | coral | coral-glow | `#E07856` / `#F59A7E` |
| gemini | azure | azure-glow | `#5B8DEF` / `#8AB0F5` |
| codex | jade | jade-glow | `#2EBD85` / `#5ED8A6` |
| copilot | violet | violet-glow | `#9B6BF0` / `#B896F5` |
| ollama | gold | gold-glow | `#F2B65A` / `#F6CE8A` |
| lmstudio | rose | rose-glow | `#EC89B4` / `#F2A9C8` |

**State Colors:**
- Active/Working: `NOCTURNE.emerald[400]` (#34D06F)
- Thinking/Menu: `NOCTURNE.amber[400]` (#F59E0B)
- Error: `NOCTURNE.semantic.danger` (#F04438)
- Idle: `NOCTURNE.ink[200]` (#BFC6D6)
- Offline: `NOCTURNE.ink[400]` (#363E58) at 45% opacity

---

*Document created: 2026-05-19*  
*Authors: Erdos, Franklin, Kepler (ANT Ollama agent trio)*  
*Purpose: Research & pitch only — no implementation yet*
