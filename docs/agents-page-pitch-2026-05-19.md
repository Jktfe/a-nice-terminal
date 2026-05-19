# Agents Page Pitch — "What Are My Bots Up To?"

**Date:** 2026-05-19  
**Context:** ANTollama room c9rm0inoit  
**Authors:** ANT multi-agent team (Ollama-powered with research across full codebase)

---

## Executive Summary

This pitch proposes a **header navigation item "Agents"** with an AI icon that leads to a rich, visual dashboard answering:

- **What agents are registered?** → Live registry with availability status
- **Which rooms are they in?** → Room membership with focus-mode indicators
- **What are they working on?** → Real-time activity state, current task context
- **How far have they progressed?** → Session duration, message counts, task completion
- **How long have they been going?** → Session timelines with activity heatmaps
- **What's the context?** → Workspace, branch, model, permission mode, rate limits

The design avoids clichés (no pulsing orbs) and instead uses **activity bars, state rings, timeline strips, and contextual cards** that work beautifully in both light and dark modes using the Nocturne design system.

---

## 1. System Understanding (Research Findings)

### 1.1 Agent Registry (`src/fingerprint/agent-registry.ts`)

ANT tracks **16 agents across 3 tiers**:

| Tier | Agents | Description |
|------|--------|-------------|
| **Tier 1** | claude-code, gemini-cli, codex-cli, copilot-cli, qwen-cli, pi, kimi-code | Agentic coding CLIs |
| **Tier 2** | ollama, lm-studio, llamafile, mlx-lm, msty | Local inference CLIs |
| **Tier 3** | llm, lemonade | Lightweight CLI tools |

Each agent has:
- `launchCommand` — how to start it
- `binary` — runtime availability check via `which`
- `driverPath` — fingerprint driver location
- `specPath` — machine-readable spec (JSON)
- `available` — runtime-probed boolean

### 1.2 Agent Status Telemetry (`src/lib/shared/agent-status.ts`)

Rich state labels (not just "busy/idle"):

```typescript
type AgentStateLabel =
  | 'Available'
  | 'Working'
  | 'Menu'
  | 'Permission'
  | 'Response needed'
  | 'Waiting';
```

**Available metrics per session:**
- `model` — model name (e.g., `gemma4:26b`, `gpt-4.1`)
- `contextUsedPct` / `contextRemainingPct` — context window usage
- `rateLimitPct` / `rateLimitWindow` — API rate limit status
- `state` — rich label above, mapped to legacy states
- `activity` — human-readable activity description
- `workspace` — current working directory
- `branch` — git branch
- `waitingFor` — what the agent is blocked on
- `focus` — room focus mode with queue count
- `timestamps` — sentAt, respAt, editAt (hook-driven)
- `sessionStartedAt` / `sessionDurationMs` — session timing
- `permissionMode` — e.g., "bypass permissions on"
- `remoteControlActive` — remote control flag
- `menu` — structured menu data (AskUserQuestion, ExitPlanMode)
- `stateFileMtimeMs` — freshness indicator

### 1.3 Event Bus (`src/lib/server/agent-event-bus.ts`)

Tracks:
- **Pending events** — user input requests with event class
- **Normalised events** — classified interactions (permission, tool_use, question)
- **Status broadcasts** — fanout to UI via WebSocket
- **Cooldown tracking** — prevents spammy updates

### 1.4 Database Schema (`src/lib/server/db.ts`)

Persisted data:
- `sessions` table — type, status, workspace, TTL, last_activity, meta
- `run_events` — time-series event log (source, trust, kind, payload)
- `asks` — pending questions with agent_resp_at_creation tracking
- `focus` — attention mode with queue counts

### 1.5 Design System (`src/lib/nocturne.ts`)

Agent color palette (avoiding clichés):

```typescript
claude:   { color: '#E07856', glow: '#F59A7E' } // coral
gemini:   { color: '#5B8DEF', glow: '#8AB0F5' } // azure
codex:    { color: '#2EBD85', glow: '#5ED8A6' } // jade
copilot:  { color: '#9B6BF0', glow: '#B896F5' } // violet
ollama:   { color: '#F2B65A', glow: '#F6CE8A' } // gold
lmstudio: { color: '#EC89B4', glow: '#F2A9C8' } // rose
```

Semantic colors:
- `success: '#22C55E'` (emerald-500)
- `warning: '#F59E0B'` (amber-400)
- `danger: '#F04438'`
- `info: '#4285F4'`

---

## 2. Visual Concepts (No Pulsing Orbs!)

### 2.1 Concept A: "Mission Control" — Horizontal Activity Strips

**Layout:** Full-width dashboard with horizontal agent rows

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENTS                                                [+ New Agent]    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ╔═══════════════════════════════════════════════════════════════════╗ │
│  ║ claude-code                          [████████░░] 78% ctx  ⚡ 85%  ║ │
│  ║ 🟠 coral                           active   ▓▓▓▓▓▓▓▓░░  2h 14m    ║ │
│  ║ /CascadeProjects/sofia • main                                [→]  ║ │
│  ╚═══════════════════════════════════════════════════════════════════╝ │
│                                                                         │
│  ╔═══════════════════════════════════════════════════════════════════╗ │
│  ║ gemini-cli                           [██████░░░░] 62% ctx  ⚡ 92%  ║ │
│  ║ 🔵 azure                         permission  ▓▓▓▓▓▓░░░░  47m      ║ │
│  ║ /CascadeProjects/manorfarmios • feature/visuals              [→]  ║ │
│  ╚═══════════════════════════════════════════════════════════════════╝ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Visual elements:**
- **Left:** Agent icon (colored circle with CLI-specific glyph)
- **Center-top:** Name + context bar (gradient fill = context used)
- **Center-bottom:** State badge + activity timeline strip (last 60min sparkline)
- **Right:** Session duration + navigate arrow
- **Background:** Subtle agent-color wash at 4% opacity

**State indicators (no orbs):**
- `active` → Solid color bar with right-to-left gradient fade
- `thinking` → Dashed border, subtle diagonal stripe pattern
- `permission` → Amber caution stripe across top
- `waiting` → Gray with "Waiting for..." text inline
- `offline` → 40% opacity, grayscale

---

### 2.2 Concept B: "Agent Cards" — Modular Grid Layout

**Layout:** Responsive grid (2-4 columns) with rich cards

```
┌──────────────────────┐  ┌──────────────────────┐
│ 🟠 claude-code       │  │ 🔵 gemini-cli        │
│ ──────────────────── │  │ ──────────────────── │
│                      │  │                      │
│   [████████░░]       │  │   [██████░░░░]       │
│   78% context        │  │   62% context        │
│                      │  │                      │
│   ⚡ 85% rate headrm  │  │   ⚡ 92% rate headrm  │
│                      │  │                      │
│   ╭──────────────╮   │  │   ╭──────────────╮   │
│   │ Working      │   │  │   │ Permission   │   │
│   │ 2h 14m       │   │  │   │ 47m          │   │
│   ╰──────────────╯   │  │   ╰──────────────╯   │
│                      │  │                      │
│   📁 sofia           │  │   📁 manorfarmios    │
│   🌿 main            │  │   🌿 feat/visuals    │
│                      │  │                      │
│   ━━━━━━━━━━━━▸▹▹    │  │   ━━━━━━▸▹▹▹▹▹▹      │
│   (60min activity)   │  │   (60min activity)   │
│                      │  │                      │
│   [View] [Focus] [✕] │  │   [View] [Focus] [✕] │
└──────────────────────┘  └──────────────────────┘
```

**Card anatomy:**
1. **Header:** Agent icon + name + availability dot (green = binary available)
2. **Context bar:** Visual progress bar (context window usage)
3. **Rate limit badge:** Lightning bolt + percentage + "headroom" label
4. **State lozenge:** Pill badge with state label + duration
5. **Workspace info:** Folder + branch icons
6. **Activity strip:** 60-minute sparkline (5min buckets)
7. **Actions:** View session, Focus mode, Archive

**Dark mode:** Cards use `--bg-card` with `--border-light` strokes  
**Light mode:** Cards use white with subtle shadow elevation

---

### 2.3 Concept C: "Timeline View" — Temporal Activity Flow

**Layout:** Vertical timeline with agent swimlanes

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENTS — Last 4 Hours                               [1h][4h][24h][7d] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  claude-code  ──▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│  gemini-cli   ──░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│  codex-cli    ──▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│  ollama       ──░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│                                                                         │
│               ◄─────►  ◄─────►  ◄─────►  ◄─────►  ◄─────►  ◄─────►     │
│               2:00     2:15     2:30     2:45     3:00     3:15        │
│                                                                         │
│  Legend: ▓ active  ░ idle  ▒ thinking  ▣ permission  ✕ offline         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- **Time range selector:** 1h, 4h, 24h, 7d, 30d
- **Swimlanes:** One per agent, color-coded
- **Pattern fills:** Different patterns for states (no color-only reliance)
- **Hover tooltips:** Exact timestamps, room names, activity descriptions
- **Click to navigate:** Jump to specific session

---

### 2.4 Concept D: "Room-Centric" — Agents by Location

**Layout:** Grouped by room with nested agent cards

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENTS BY ROOM                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  🏠 ANTollama (c9rm0inoit)                          3 agents active    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │
│  │ 🟠 claude   │  │ 🔵 gemini   │  │ 🟡 ollama   │                     │
│  │ active      │  │ thinking    │  │ idle        │                     │
│  │ 2h 14m      │  │ 47m         │  │ 15m         │                     │
│  │ [██████░░░] │  │ [████░░░░░] │  │ [██░░░░░░░] │                     │
│  └─────────────┘  └─────────────┘  └─────────────┘                     │
│                                                                         │
│  🏠 Sofia (r-xyz123)                                2 agents active    │
│  ┌─────────────┐  ┌─────────────┐                                     │
│  │ 🟠 claude   │  │ 🟢 codex    │                                     │
│  │ permission  │  │ active      │                                     │
│  │ 31m         │  │ 4h 2m       │                                     │
│  │ [█████░░░░] │  │ [████████░] │                                     │
│  └─────────────┘  └─────────────┘                                     │
│                                                                         │
│  🏠 ManorFarmOS (r-abc456)                          1 agent active     │
│  ┌─────────────┐                                                       │
│  │ 🔵 gemini   │                                                       │
│  │ waiting     │                                                       │
│  │ 12m         │                                                       │
│  │ [███░░░░░░] │                                                       │
│  └─────────────┘                                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- **Room cards:** Collapsible sections with agent count badge
- **Focus indicator:** Amber border on room with active focus mode
- **Queue badge:** Shows pending message count in focus rooms
- **Quick actions:** "Join room", "Broadcast to all", "Focus review"

---

## 3. Metrics & Statistics (What to Display)

### 3.1 Per-Agent Metrics

| Metric | Source | Display |
|--------|--------|---------|
| **Availability** | `AGENTS.available` | Green dot + "Installed" badge |
| **State** | `AgentStatus.stateLabel` | Badge: active/thinking/permission/waiting |
| **Context usage** | `contextUsedPct` | Progress bar + percentage |
| **Rate limit** | `rateLimitPct` | Lightning icon + "% headroom" |
| **Session duration** | `sessionDurationMs` | Human-readable (2h 14m) |
| **Activity timeline** | `run_events` query | 60min sparkline (5min buckets) |
| **Message count** | `queries.getMessageCount(sessionId)` | "# messages sent" |
| **Task progress** | `queries.getTasks(sessionId)` | "3/7 tasks complete" |
| **Workspace** | `workspace` | Folder name + branch |
| **Model** | `model` | Model name (gemma4:26b) |
| **Permission mode** | `permissionMode` | Badge if bypass active |

### 3.2 Aggregate Metrics

| Metric | Calculation | Display |
|--------|-------------|---------|
| **Total agents** | `AGENTS.length` | "16 agents registered" |
| **Available** | `AGENTS.filter(a => a.available).length` | "7 available now" |
| **Active sessions** | `sessions.filter(s => s.status !== 'idle').length` | "4 active sessions" |
| **Total messages (24h)** | `run_events` count | "1,247 messages today" |
| **Focus rooms** | `focus.count()` | "2 rooms in focus mode" |
| **Pending asks** | `asks.filter(a => !a.resolved)` | "3 questions awaiting input" |

### 3.3 Derived Insights (Smart Summaries)

```
"claude-code has been working continuously for 2h 14m on sofia/"
"gemini-cli is waiting for permission approval (47m in permission state)"
"ollama session idle for 15m — consider archiving"
"3 agents currently in focus mode across 2 rooms"
"Rate limit headroom low on codex-cli (12% remaining)"
```

---

## 4. Light & Dark Mode Design

### 4.1 Dark Mode (Nocturne Ink Palette)

```css
--bg: #0C1021;          /* ink-900 */
--bg-card: #1B1A15;     /* ink-800 */
--bg-elev: #2A2922;     /* ink-700 */
--border-light: rgba(255,255,255,0.08);
--text: #E3E7F0;        /* ink-50 */
--text-muted: #BFC6D6;  /* ink-100 */
--text-faint: #8990A8;  /* ink-200 */

/* Agent colors pop against dark background */
--agent-claude: #E07856;
--agent-gemini: #5B8DEF;
--agent-codex: #2EBD85;
```

**Design choices:**
- Cards use `--bg-card` with subtle `--border-light` stroke
- Text uses `--text` for primary, `--text-muted` for secondary
- Agent colors appear at 100% saturation (they glow against dark)
- Activity strips use luminance contrast (not just hue)

### 4.2 Light Mode (Nocturne Neutral Palette)

```css
--bg: #F7F7F5;          /* neutral-50 */
--bg-card: #FFFFFF;
--bg-elev: #FBFBFA;
--border-light: rgba(0,0,0,0.08);
--text: #1B1A15;        /* neutral-800 */
--text-muted: #5A584B;  /* neutral-500 */
--text-faint: #838173;  /* neutral-400 */

/* Agent colors adjusted for light background */
--agent-claude: #C45A3E;   /* slightly darker coral */
--agent-gemini: #4A7BD9;   /* slightly darker azure */
--agent-codex: #269B6E;    /* slightly darker jade */
```

**Design choices:**
- Cards use white with subtle shadow (no border in light mode)
- Text uses `--text` for primary, higher contrast
- Agent colors at 85% saturation (avoid neon effect)
- Activity strips use darker fills for visibility

### 4.3 Accessibility

- **WCAG AA compliance:** All text meets 4.5:1 contrast ratio
- **Pattern fills:** States distinguished by pattern, not just color
- **Tooltips:** All metrics have text labels on hover
- **Keyboard nav:** Full tab navigation with focus rings

---

## 5. Interaction Patterns

### 5.1 Navigation Flow

```
Dashboard Header → [AI Icon] → /agents

/agents (default view: Cards)
  ├─ [Grid toggle] → Timeline view
  ├─ [Group by] → Rooms / Agents / Status
  ├─ [Time range] → 1h / 4h / 24h / 7d
  └─ [Filter] → Available only / Active only / By tier
```

### 5.2 Card Actions

| Action | Result |
|--------|--------|
| **Click card** | Navigate to session `/session/[id]` |
| **[Focus]** | Enable focus mode for that agent's room |
| **[Archive]** | Archive session with confirmation |
| **[View log]** | Open run_events timeline modal |
| **[Copy handle]** | Copy `@claude` to clipboard |

### 5.3 Real-Time Updates

- **WebSocket subscription** to `SESSIONS_CHANNEL`
- **Polling fallback** for `/api/sessions/[id]/status` every 30s
- **Optimistic UI** for actions (archive, focus)
- **Stale indicators** when status > 2min old

---

## 6. API Requirements (New Endpoints)

### 6.1 `GET /api/agents`

```typescript
{
  agents: Array<{
    name: string;
    tier: 1 | 2 | 3;
    available: boolean;
    launchCommand: string;
    driverPath: string;
    specPath: string | null;
    sessions: Array<{
      sessionId: string;
      roomName: string | null;
      status: AgentStatus;
      durationMs: number;
      messageCount: number;
    }>;
  }>;
  summary: {
    totalAgents: number;
    availableCount: number;
    activeSessions: number;
    focusRoomCount: number;
    pendingAskCount: number;
  };
}
```

### 6.2 `GET /api/agents/activity?window_ms=3600000`

```typescript
{
  windowMs: number;
  buckets: Array<{
    tsMs: number;
    byAgent: Record<string, {
      activeMs: number;
      thinkingMs: number;
      idleMs: number;
      messageCount: number;
    }>;
  }>;
}
```

### 6.3 `GET /api/agents/:name/stats`

```typescript
{
  name: string;
  totalSessions: number;
  totalMessages: number;
  avgSessionDurationMs: number;
  mostUsedWorkspace: string;
  lastActiveAt: number | null;
}
```

---

## 7. Component Architecture

### 7.1 New Components

```
src/lib/components/
├─ AgentsPage/
│  ├─ AgentsPage.svelte          # Main page wrapper
│  ├─ AgentCard.svelte           # Card view component
│  ├─ AgentStrip.svelte          # Horizontal strip component
│  ├─ AgentTimeline.svelte       # Timeline swimlane component
│  ├─ AgentRoomGroup.svelte      # Room-grouped view
│  ├─ ActivitySparkline.svelte   # 60min sparkline viz
│  ├─ ContextBar.svelte          # Context usage progress
│  ├─ StateBadge.svelte          # State lozenge
│  └─ AgentIcon.svelte           # Colored icon with glyph
├─ DashboardHeader.svelte        # ADD: Agents nav item
└─ NocturneIcon.svelte           # ADD: 'agents' icon
```

### 7.2 Stores

```typescript
// src/lib/stores/agents.svelte.ts
const agents = $state<AgentRegistry>();
const agentSessions = $state<Map<string, SessionWithStatus>>();
const activityData = $state<ActivityTimeSeries>();

export function loadAgents(): Promise<AgentRegistry>;
export function subscribeAgentStatus(agentName: string): Readable<AgentStatus>;
export function getActivitySeries(windowMs: number): Promise<ActivityTimeSeries>;
```

---

## 8. Visual Mockup Descriptions (for Screenshots)

### 8.1 Card View (Dark Mode)

**Background:** `#0C1021` (ink-900)  
**Cards:** `#1B1A15` (ink-800) with `rgba(255,255,255,0.08)` border

**Card 1 (claude-code, active):**
- Coral header bar at top (4px, full width)
- Icon: coral circle with `</>` glyph in white
- Title: "claude-code" in `#E3E7F0`
- Context bar: gradient coral fill at 78%
- State badge: "active" in coral, 2h 14m duration
- Workspace: "📁 sofia • 🌿 main" in muted text
- Activity strip: 12 segments, last 8 filled coral
- Footer actions: "View" (primary), "Focus" (secondary)

**Card 2 (gemini-cli, permission):**
- Azure header bar
- Icon: azure circle with `◆` glyph
- State badge: amber background "permission" with caution icon
- Context bar: azure at 62%
- Activity strip: 6 segments filled, last 3 amber (permission state)

### 8.2 Timeline View (Light Mode)

**Background:** `#F7F7F5` (neutral-50)  
**Swimlanes:** White rows with subtle shadow

**Row styling:**
- Agent name left-aligned with icon
- Timeline uses pattern fills:
  - Active: solid color at 60% opacity
  - Thinking: diagonal stripes
  - Idle: dotted pattern
  - Permission: caution stripes (amber/white)
- Hover tooltip: "claude-code was active from 2:14-2:29 PM working on /sofia"

---

## 9. Why This Works (No Clichés)

| Cliché | Our Alternative |
|--------|-----------------|
| Pulsing orbs | Activity strips with temporal data |
| Generic "AI" brain icon | Agent-specific glyphs (code, chat, terminal) |
| Rainbow vomit | Nocturne palette with semantic color use |
| "AI is thinking..." | Specific state labels: "Waiting for permission", "Reviewing diff" |
| Mystical glow | Subtle agent-color wash at 4% opacity |
| Animated sparkles | Meaningful animations: progress bars, timeline fills |

**Design principles:**
1. **Data density over decoration** — Every pixel shows telemetry
2. **Temporal awareness** — Time is a first-class dimension
3. **Contextual grouping** — Agents shown where they work (rooms)
4. **Actionable insights** — Metrics lead to actions (focus, archive, view)
5. **Theme parity** — Light and dark modes equally polished

---

## 10. Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] `GET /api/agents` endpoint
- [ ] `AgentsPage.svelte` shell with card layout
- [ ] `AgentCard.svelte` with basic telemetry
- [ ] Header nav item with AI icon

### Phase 2: Rich Telemetry (Week 2)
- [ ] Activity sparklines from `run_events`
- [ ] Context bars + rate limit badges
- [ ] Real-time WebSocket updates
- [ ] Stale state indicators

### Phase 3: Views & Filters (Week 3)
- [ ] Timeline view toggle
- [ ] Room-grouped view
- [ ] Filter by tier/status/availability
- [ ] Search by workspace/branch

### Phase 4: Actions & Insights (Week 4)
- [ ] Focus mode from card
- [ ] Archive with confirmation
- [ ] Smart summaries ("X has been working for Y...")
- [ ] Export agent report

---

## 11. Evidence & References

**Codebase files inspected:**
- `src/fingerprint/agent-registry.ts` — Agent definitions
- `src/lib/shared/agent-status.ts` — Status types
- `src/lib/server/agent-event-bus.ts` — Event tracking
- `src/lib/server/db.ts` — Schema
- `src/lib/nocturne.ts` — Design tokens
- `src/lib/components/ActivityRail.svelte` — Existing agent UI
- `src/lib/components/DashboardHeader.svelte` — Header structure
- `src/routes/api/sessions/[id]/status/+server.ts` — Status endpoint

**Existing patterns to extend:**
- ActivityRail's agent status map → AgentsPage telemetry
- DashboardHeader's icon buttons → Agents nav item
- SessionCard's state badges → AgentCard state lozenges
- Nocturne's agent colors → Consistent identity across views

---

## 12. The Pitch (TL;DR)

**"What are my bots up to?"** → One glance tells you:

1. **Who's working** → Active state badges with duration
2. **Where they are** → Room-grouped cards with focus indicators
3. **What they're doing** → Workspace + branch + activity descriptions
4. **How much they've done** → Message counts + task progress
5. **How long they've been at it** → Session timelines + duration
6. **What's blocking them** → Permission states + "Waiting for..." labels

**Visual approach:** Clean, data-dense cards and timelines using the Nocturne palette. No orbs, no sparkles, no mysticism — just **honest telemetry** presented beautifully in both light and dark modes.

**The hook:** Open the Agents page and immediately see:
- "claude-code has been grinding on sofia for 2h 14m, 78% context used"
- "gemini is stuck waiting for permission approval (47m)"
- "3 agents in focus mode across 2 rooms — 5 messages queued"

That's the dashboard this pitch delivers.

---

**Next steps:**
1. Review this pitch with the team
2. Approve visual direction (Cards vs Timeline vs Room-centric)
3. Greenlight Phase 1 implementation
4. Schedule screenshot/visual mockup creation

