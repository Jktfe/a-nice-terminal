# Agents Page — The Switchboard

**Date:** 2026-05-19  
**Room:** ANTollama (c9rm0inoit)  
**Author:** Codex  
**Status:** Pitch — awaiting approval

---

## TL;DR

A new **Agents** page with an AI sparkle icon in the header. One glance tells you: who's working, who's stuck, who's idle, and where each agent's attention is pointed. Built entirely on data ANT already captures. No new schema, no new database tables.

**Visual metaphor: Switchboard, not dashboard.** The question is *attention allocation*, not "stats about my bots."

---

## 1. The Core Idea

The ActivityRail shows *sessions*. This page shows *agents*. Sessions are ephemeral containers; agents are the persistent identities that move between them. The page answers a different question: not "what's running?" but "who's working for me, how hard, and on what?"

Three visual horizons:

| Horizon | What | Scroll? |
|---------|------|---------|
| Canopy | Header icon + horizontal agent chip strip | No — always visible |
| Grid | Expanded agent detail cards | Yes — scrollable |
| Drawer | Full room roster, session history, heatmap | Expand on click |

---

## 2. Data Available (No New Schema)

| Source | What it gives us |
|--------|-------------------|
| `AGENTS` (agent-registry.ts) | 14 agents, 3 tiers, binary availability, driver paths |
| `AgentStatus` | model, contextUsedPct, state, stateLabel, activity, workspace, branch, permissionMode, remoteControlActive |
| Hook state files (`~/.ant/state/<cli>/<id>.json`) | mtimeMs → live/stale/absent freshness classification |
| `run_events` | Timestamped tool_call, tool_result, permission, question, progress events |
| `chat_room_members` | Room membership, role, alias, attention_state (focus/available) |
| `messages` | sender_id, timestamps, message types → interaction counts per agent per room |
| Nocturne palette | Per-agent identity colors: claude=coral, gemini=azure, codex=jade, copilot=violet, ollama=gold |

---

## 3. Horizon 1 — The Canopy

### Header Icon

- **Icon:** `NocturneIcon name="sparkle"` in `DashboardHeader.svelte`, between Help and Plans
- **Badge:** Count of agents in Working/Menu/Permission state — same pattern as the ask queue badge
- **Route:** `/agents`

### At-a-Glance Strip

Horizontal bar of agent identity chips (~120px each):

```
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ ● Ollama   │ │ ● Claude   │ │ ● Codex    │ │ ● Gemini   │
│   Working   │ │   Available│ │   Thinking │ │   Idle     │
│   2 rooms   │ │   1 room   │ │   0 rooms  │ │   3 rooms  │
└────────────┘ └────────────┘ └────────────┘ └────────────┘
```

- Left border: agent identity color
- Dot: existing `AgentDot` component with breathing animation
- Status: `font-mono` 11px, one line
- Room count below status
- **Light mode:** `#FBFBFA` bg, `0.5px solid rgba(0,0,0,0.06)` borders
- **Dark mode:** `#121828` bg, `rgba(255,255,255,0.06)` borders
- No gradients, no glass, no orbs
- Horizontally scrollable on mobile
- Clicking scrolls to the card section

---

## 4. Horizon 2 — The Grid

Responsive grid (2 columns desktop, 1 mobile). Each card extends `AgentCard.svelte` visual DNA.

### Card Structure

```
┌─────────────────────────────────────────────┐
│  ● Ollama                              T2   │  ← AgentDot + name + tier badge
│     gemma4:26b                     ● avail  │  ← model pill + availability dot
│─────────────────────────────────────────────│
│  ▸ Working          ctx [████████░░] 78%    │  ← ThinkingShimmer or status dot + context bar
│─────────────────────────────────────────────│
│  Rooms: #anthollama  #dev-deep  #mmd        │  ← up to 3 room chips with attention dots
│─────────────────────────────────────────────│
│  ▁▃▅▇█▇▅▃▁▁▁▂▃▅▇█▇▅▃▁▁▁▂▃▅▇█▇▅▃▁▁       │  ← 24-bar sparkline (last 24h)
│  127 events · peak 14:00                     │
│─────────────────────────────────────────────│
│  ⏱ 2h 14m   ⏵⏵ bypass   📡 Remote          │  ← AgentTelemetryStrip
└─────────────────────────────────────────────┘
```

**Row-by-row:**

1. **Header row:** `AgentDot` + agent name + T1/T2/T3 badge + model pill + availability dot (green=installed, red=missing)
2. **Status row:** `ThinkingShimmer` when thinking, else plain dot + label. Context bar (0→100%) below. Color: emerald <70%, amber 70-90%, red >90%
3. **Active rooms** (≤3): Room name + role + attention dot (amber=focus, blue=unread). Click navigates to `/r/{roomId}`
4. **Activity sparkline** (24h): 24 `<rect>` SVG bars. Height = event count per hour. Agent color at 60% opacity (40% light). Current hour brighter.
5. **Telemetry row:** Reuse `AgentTelemetryStrip` — duration, permission mode, remote indicator, freshness dot

**Light mode:** `surfaceTokens('light')` — `#FFFFFF` card, `#F7F7F5` page, 8% agent color interior glow  
**Dark mode:** `surfaceTokens('dark')` — `#1B1A15` card, `#0C1021` page, 14% agent color interior glow, `Grain` overlay

---

## 5. Horizon 3 — The Detail Drawer

Click-to-expand (inline on desktop, side drawer on mobile):

### Full Room Roster
Every room the agent is in: name, role, join date, last message timestamp, 3-line preview of most recent message

### Session History
Chronological terminal sessions (filtered by `cli_flag`): status, duration, workspace path

### Interaction Heatmap
7×24 grid (like GitHub contribution graph, denser). Cells colored by intensity using agent identity color. Pure `run_events` + `messages` aggregation.

### Context Pressure
Horizontal bar showing `contextUsedPct`. Quiet progress indicator, not a gauge.

---

## 6. ANT-Specific Differentiators

1. **Tier-awareness:** T1 (agentic CLIs) get full cards, T2 (local inference) gets compact cards, T3 (lightweight tools) gets a collapsed row. Tier badge makes this scannable at a glance.

2. **Hook freshness:** Live/stale/absent classification of `~/.ant/state/<cli>/<id>.json`. Not "is the process running?" but "is the agent's status reporter alive?" — a diagnostic power tool.

3. **Room membership as primary axis:** ANT centers on *rooms*, not tasks. The page foregrounds which rooms an agent is in and their attention state (focused, available, waiting). Key insight from `chat_room_members.attention_state`.

4. **Focus mode:** Amber "FOCUS" chip (matching `NOCTURNE.amber` from `SessionCard`) with room name and queue count. Highest-priority signal on the entire page.

5. **Permission mode:** "Bypass" in amber, "Default" in neutral. Critical security surface shown as a small pill.

6. **Ollama richness:** Shows loaded model, local vs cloud inference, "serving models" vs "being an agent" — the driver already captures `AgentStatus.model`.

---

## 7. Light Mode Specifics

| Element | Light mode |
|---------|-----------|
| Page bg | `#F7F7F5` (neutral-50) |
| Card bg | `#FFFFFF` |
| Identity borders | Agent color at 4% opacity |
| Sparkline bars | Agent color at 40% opacity |
| Context bar track | `rgba(0,0,0,0.06)` |
| Context bar fill | Full agent color |
| Status dots | Same colors, same glow as dark |
| Text | neutral-800 / neutral-500 / neutral-400 |
| Interior glow | Agent color at 8% opacity |
| Grain | Not applied (dark-mode only) |

No new CSS variables needed. Entire page themes via `surfaceTokens` + per-agent Nocturne palette colors.

---

## 8. API Surface

```
GET /api/agents
```

Returns:
- `agents[]` — Full `AGENTS` registry with `available` flags
- `stats{}` — Per-agent: total sessions, active sessions, total rooms, messages (24h), run_events (24h)
- `status{}` — Per-agent: merged `AgentStatus` from most recent session
- `rooms[]` — Per-agent: room IDs, names, roles, attention states

Built from `queries.listSessions()`, `run_events` aggregation, `chat_room_members` joins, `agent-state-reader` for live status. **No schema changes.**

---

## 9. Implementation Sequence

| Step | Deliverable | Components |
|------|-------------|------------|
| 1 | `GET /api/agents` endpoint | Server-side aggregation |
| 2 | `/agents` route + load function | `+page.svelte`, `+page.ts` |
| 3 | Header sparkle icon | `DashboardHeader.svelte` |
| 4 | Strip + Grid + Drawer components | `AgentStrip`, `AgentGridCard`, `AgentDetailDrawer` |
| 5 | WebSocket live updates | `agent_status_updated`, `session_activity` events |
| 6 | Sparkline SVG | 24 `<rect>` elements, pure SVG |

Reuses: `AgentDot`, `SignalBars`, `ThinkingShimmer`, `AgentTelemetryStrip`, `Grain`, `NocturneIcon`, `surfaceTokens`

---

## 10. No Cliches

| Cliche | Our Alternative |
|--------|-----------------|
| Pulsing orbs | Breathing `AgentDot` (subtle glow on active) |
| Generic AI brain icon | Agent-specific tier badges + identity colors |
| Rainbow gradients | Nocturne palette with semantic color use |
| "AI is thinking..." | Specific state labels: "Working", "Permission", "Menu" |
| Mystical glow | 4-8% agent-color interior wash on cards |
| Animated sparkles | Meaningful sparklines with temporal data |

---

## 11. File References

- `src/fingerprint/agent-registry.ts` — Agent definitions
- `src/lib/shared/agent-status.ts` — Status types + `AgentDotState`
- `src/lib/shared/state-freshness.ts` — Live/stale/absent classifier
- `src/lib/nocturne.ts` — Design tokens + agent colors
- `src/lib/components/AgentCard.svelte` — Card component to extend
- `src/lib/components/AgentDot.svelte` — Breathing dot component
- `src/lib/components/AgentTelemetryStrip.svelte` — Telemetry pills
- `src/lib/components/ActivityRail.svelte` — Existing sidebar agent UI
- `src/lib/components/DashboardHeader.svelte` — Where the icon goes
- `src/lib/server/db.ts` — Database queries to aggregate
