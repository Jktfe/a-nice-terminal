<!--
  AgentStatusFooter — Task #115 v3 footer parity, upgraded with fun-ant
  presence visuals.

  Always-visible compact strip showing each agent member's status so the
  user can tell at a glance who is working vs idle without opening the
  digest. Polls /api/chat-rooms/:roomId/agent-statuses every few seconds.

  Source audit: /Users/ant/ant-research-site/footer/agent-footer.html:
  43-160,231-520,560-674. Verdict CHANGE: keep the approved ant anatomy,
  gradients, and state model, but render them as a theme-aware Svelte component
  bounded to the chat composer and fed by /agent-statuses.
-->
<script lang="ts">
  import { subscribeToRoomEvents } from '$lib/stores/realtimeRoom.svelte';
  import AgentContextChip from './AgentContextChip.svelte';

  type AgentStatus = 'idle' | 'thinking' | 'working' | 'response-required' | 'unknown';
  type StatusEntry = {
    handle: string;
    status: AgentStatus;
    statusAtMs: number | null;
    // Optional context-window telemetry — added in the AgentContextChip
    // slice (JWPK msg_u7r6znc3ec). Codex's agent-statuses feed populates
    // these when available; chip hides itself when both are null.
    uptimeMs?: number | null;
    contextFill?: number | null;
  };

  type Props = {
    roomId: string;
    pollIntervalMs?: number;
  };

  let { roomId, pollIntervalMs = 30_000 }: Props = $props();

  const STATUS_LABEL: Record<AgentStatus, string> = {
    idle: 'idle',
    thinking: 'thinking',
    working: 'working',
    'response-required': 'needs reply',
    unknown: '—'
  };
  const STATUS_HELP: Record<AgentStatus, string> = {
    idle: 'resting',
    thinking: 'thinking',
    working: 'working',
    'response-required': 'needs a reply',
    unknown: 'status unknown'
  };
  const KNOWN_AGENT_ACCENTS: Record<string, string> = {
    '@researchant': '#e8a33d',
    '@oiresearch': '#4fb3ff',
    '@minisearch': '#56d6a0',
    '@masterclaude': '#c08bff',
    '@speedy': '#ff7a9c',
    '@localantchair': '#f2c14e'
  };
  const FALLBACK_ACCENTS = ['#e8a33d', '#4fb3ff', '#56d6a0', '#c08bff', '#ff7a9c', '#f2c14e'];

  let statuses = $state<StatusEntry[]>([]);
  let lastFetchFailed = $state(false);

  function accentForHandle(handle: string): string {
    const known = KNOWN_AGENT_ACCENTS[handle.toLowerCase()];
    if (known) return known;
    const score = [...handle].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return FALLBACK_ACCENTS[score % FALLBACK_ACCENTS.length];
  }

  function antStateForStatus(status: AgentStatus): 'walking' | 'resting' | 'stuck' {
    if (status === 'response-required') return 'stuck';
    if (status === 'thinking' || status === 'working') return 'walking';
    return 'resting';
  }

  function hexToRgb(hex: string) {
    let value = hex.replace('#', '');
    if (value.length === 3) value = value.split('').map((char) => char + char).join('');
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16)
    };
  }

  function rgbToHex(r: number, g: number, b: number): string {
    const channel = (value: number) =>
      Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${channel(r)}${channel(g)}${channel(b)}`;
  }

  function shade(hex: string, amount: number): string {
    const { r, g, b } = hexToRgb(hex);
    if (amount >= 0) {
      return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
    }
    const factor = 1 + amount;
    return rgbToHex(r * factor, g * factor, b * factor);
  }

  function paletteFromAccent(accent: string) {
    return {
      body0: shade(accent, 0.18),
      body1: shade(accent, -0.18),
      body2: shade(accent, -0.46),
      body3: shade(accent, -0.74),
      head0: shade(accent, 0.26),
      head1: shade(accent, -0.3),
      head2: shade(accent, -0.66),
      leg0: shade(accent, -0.34),
      leg1: shade(accent, -0.72),
      detail: shade(accent, -0.66),
      detail2: shade(accent, -0.5),
      detail3: shade(accent, -0.74),
      foot: shade(accent, -0.72)
    };
  }

  function agentStyle(entry: StatusEntry, index: number, count: number): string {
    const speed = 21 + (index % 3) * 3;
    const delay = count > 0 ? -(speed / count) * index : 0;
    const restLeft = count > 0 ? ((index + 0.5) / count) * 100 : 50;
    return `--agent-accent:${accentForHandle(entry.handle)}; --crawl-speed:${speed}s; --crawl-delay:${delay}s; --rest-left:${restLeft}%;`;
  }

  async function refreshFromServer() {
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/agent-statuses`);
      if (!response.ok) throw new Error(`Could not fetch (${response.status}).`);
      const body = (await response.json()) as { statuses: StatusEntry[] };
      statuses = body.statuses ?? [];
      lastFetchFailed = false;
    } catch {
      lastFetchFailed = true;
    }
  }

  $effect(() => {
    if (!roomId) return;
    void refreshFromServer();
    const handle = setInterval(refreshFromServer, pollIntervalMs);
    return () => clearInterval(handle);
  });

  // #117 fix: subscribe to the room SSE stream and refresh as soon as the
  // server emits an agent_activity tick (or a message_added event, since
  // both signal that someone just acted). Drops the perceived "everyone
  // is idle" lag that polling alone produces.
  // PATCH B: replaced the 750ms setInterval watcher with a reactive
  // $effect on handle.eventCount. Same outcome (refresh on relevant SSE
  // events) without a perpetual busy-poll competing with the page-level
  // SSE-event-burst debounce.
  let handle = $state<ReturnType<typeof subscribeToRoomEvents> | null>(null);
  let lastSeenEventCount = $state(0);
  $effect(() => {
    if (!roomId) return;
    const h = subscribeToRoomEvents(roomId);
    handle = h;
    lastSeenEventCount = 0;
    return () => {
      h.close();
      handle = null;
    };
  });
  $effect(() => {
    const count = handle?.eventCount ?? 0;
    if (count <= lastSeenEventCount) return;
    lastSeenEventCount = count;
    const event = handle?.lastEvent;
    if (!event) return;
    if (event.type === 'agent_activity' || event.type === 'message_added') {
      void refreshFromServer();
    }
  });
</script>

<aside class="agent-status-footer" aria-label="Agent presence footer">
  <div class="agent-track" aria-hidden="true"></div>
  {#if statuses.length > 0}
    {#each statuses as entry, index (entry.handle)}
      {@const accent = accentForHandle(entry.handle)}
      {@const palette = paletteFromAccent(accent)}
      {@const bodyGradient = `ant-body-${index}`}
      {@const headGradient = `ant-head-${index}`}
      {@const legGradient = `ant-leg-${index}`}
      <button
        type="button"
        class={`agent-ant status-${entry.status} ant-${antStateForStatus(entry.status)}`}
        style={agentStyle(entry, index, statuses.length)}
        title={`${entry.handle}: ${STATUS_HELP[entry.status]}`}
        aria-label={`${entry.handle}: ${STATUS_HELP[entry.status]}`}
      >
        <span class="ant-motion" aria-hidden="true">
          <svg class="ant-svg" viewBox="0 0 130 84" focusable="false">
            <defs>
              <radialGradient id={bodyGradient} cx="42%" cy="32%" r="82%">
                <stop offset="0%" stop-color={palette.body0} />
                <stop offset="30%" stop-color={palette.body1} />
                <stop offset="68%" stop-color={palette.body2} />
                <stop offset="100%" stop-color={palette.body3} />
              </radialGradient>
              <radialGradient id={headGradient} cx="50%" cy="36%" r="76%">
                <stop offset="0%" stop-color={palette.head0} />
                <stop offset="55%" stop-color={palette.head1} />
                <stop offset="100%" stop-color={palette.head2} />
              </radialGradient>
              <linearGradient id={legGradient} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color={palette.leg0} />
                <stop offset="100%" stop-color={palette.leg1} />
              </linearGradient>
              <filter id={`ant-soft-${index}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" />
              </filter>
            </defs>
            <g class="ant-top" transform="translate(65 42)">
              <g class="leg tripod-a">
                <line x1="14" y1="-9" x2="26" y2="-26" />
                <line x1="26" y1="-26" x2="38" y2="-42" />
                <circle cx="38" cy="-42" r="1.8" />
              </g>
              <g class="leg tripod-b">
                <line x1="14" y1="9" x2="26" y2="26" />
                <line x1="26" y1="26" x2="38" y2="42" />
                <circle cx="38" cy="42" r="1.8" />
              </g>
              <g class="leg tripod-b">
                <line x1="2" y1="-9" x2="8" y2="-27" />
                <line x1="8" y1="-27" x2="7" y2="-45" />
                <circle cx="7" cy="-45" r="1.8" />
              </g>
              <g class="leg tripod-a">
                <line x1="2" y1="9" x2="8" y2="27" />
                <line x1="8" y1="27" x2="7" y2="45" />
                <circle cx="7" cy="45" r="1.8" />
              </g>
              <g class="leg tripod-a">
                <line x1="-12" y1="-9" x2="-22" y2="-27" />
                <line x1="-22" y1="-27" x2="-34" y2="-40" />
                <circle cx="-34" cy="-40" r="1.8" />
              </g>
              <g class="leg tripod-b">
                <line x1="-12" y1="9" x2="-22" y2="27" />
                <line x1="-22" y1="27" x2="-34" y2="40" />
                <circle cx="-34" cy="40" r="1.8" />
              </g>
              <g class="ant-body">
                <ellipse cx="-34" cy="0" rx="24" ry="16" fill={`url(#${bodyGradient})`} />
                <ellipse cx="-44" cy="0" rx="15" ry="11" fill={palette.detail} opacity="0.55" />
                <rect x="-14" y="-3.2" width="10" height="6.4" rx="3" fill={palette.detail2} />
                <ellipse cx="0" cy="0" rx="16" ry="11" fill={`url(#${bodyGradient})`} />
                <rect x="13" y="-2.6" width="6" height="5.2" rx="2.4" fill={palette.detail2} />
                <ellipse cx="27" cy="0" rx="13" ry="12" fill={`url(#${headGradient})`} />
                <path d="M38,-5 q9,-2 11,-7 q-2,6 -7,9 z" fill={palette.detail3} />
                <path d="M38, 5 q9, 2 11, 7 q-2,-6 -7,-9 z" fill={palette.detail3} />
                <path class="antenna antenna-left" d="M33,-7 q12,-9 20,-7 q-6,2 -9,8" fill="none" stroke={palette.detail} />
                <path class="antenna antenna-right" d="M33, 7 q12, 9 20, 7 q-6,-2 -9,-8" fill="none" stroke={palette.detail} />
                <circle class="eye" cx="30" cy="-6" r="2.2" />
                <circle class="eye" cx="30" cy="6" r="2.2" />
                <ellipse
                  cx="-30"
                  cy="-5"
                  rx="9"
                  ry="4"
                  fill="rgba(255,245,235,.20)"
                  filter={`url(#ant-soft-${index})`}
                />
              </g>
            </g>
          </svg>
          {#if entry.status === 'response-required'}
            <span class="warning-mark">⚠</span>
          {/if}
        </span>
        <span class="agent-nameplate" aria-hidden="true">
          <strong>{entry.handle}</strong>
          <span>{STATUS_LABEL[entry.status]}</span>
        </span>
        <span class="agent-tooltip" role="tooltip">
          <strong>{entry.handle}</strong>
          <span>{STATUS_LABEL[entry.status]}</span>
          <AgentContextChip uptimeMs={entry.uptimeMs ?? null} contextFill={entry.contextFill ?? null} compact />
        </span>
      </button>
    {/each}
  {:else}
    <span class="status-empty" role="status">checking agents</span>
  {/if}
  {#if lastFetchFailed}
    <span class="status-stale" role="status">offline</span>
  {/if}
</aside>

<style>
  .agent-status-footer {
    position: relative;
    width: 100%;
    max-width: 100%;
    height: var(--agent-footer-height, 52px);
    min-height: var(--agent-footer-height, 52px);
    overflow-x: clip;
    overflow-y: visible;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line-soft));
    border-top: 1px solid color-mix(in srgb, var(--accent) 25%, var(--line-soft));
    border-radius: 0.75rem 0.75rem 0 0;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--surface-card) 96%, transparent), color-mix(in srgb, var(--surface-raised) 92%, transparent)),
      var(--surface-card);
    box-shadow: 0 -0.2rem 0.8rem rgb(57 33 20 / 10%);
    font-size: 0.75rem;
    isolation: isolate;
    backdrop-filter: blur(4px);
  }

  :global(:root[data-theme='dark']) .agent-status-footer {
    border-color: #2c2316;
    border-top-color: #2c2316;
    background:
      linear-gradient(0deg, rgb(8 6 3 / 96%), rgb(20 15 9 / 92%)),
      #150f09;
    box-shadow: 0 -0.38rem 1.5rem rgb(0 0 0 / 35%);
  }

  .agent-track {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .agent-track::before {
    content: '';
    position: absolute;
    inset: auto 0 0;
    height: 1px;
    background: color-mix(in srgb, var(--accent) 26%, transparent);
  }

  .agent-ant {
    --ant-height: 26px;
    position: absolute;
    top: 0;
    left: 0;
    display: inline-grid;
    place-items: center;
    width: 7.25rem;
    height: 100%;
    min-height: 100%;
    padding: 0;
    border: 0;
    color: var(--agent-accent);
    background: transparent;
    cursor: default;
    animation: ant-crawl var(--crawl-speed) linear infinite both;
    animation-delay: var(--crawl-delay);
    outline: none;
    will-change: transform;
  }

  .ant-motion {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 4rem;
    height: 2.1rem;
    align-self: start;
    filter: drop-shadow(0 0.08rem 0.12rem rgb(57 33 20 / 24%));
  }

  :global(:root[data-theme='dark']) .ant-motion {
    filter: drop-shadow(0 0.08rem 0.12rem rgb(0 0 0 / 60%));
  }

  .ant-svg {
    display: block;
    width: auto;
    height: var(--ant-height);
    overflow: visible;
  }

  .leg line {
    stroke: color-mix(in srgb, currentColor 62%, #0c0a07);
    stroke-width: 3.2px;
    stroke-linecap: round;
  }

  .leg circle {
    fill: color-mix(in srgb, currentColor 30%, #0c0a07);
  }

  .tripod-a,
  .tripod-b {
    transform-box: fill-box;
    transform-origin: center;
  }

  .ant-body {
    filter: drop-shadow(0 0.06rem 0.05rem rgb(0 0 0 / 38%));
  }

  .antenna {
    stroke-width: 1.7px;
    stroke-linecap: round;
    transform-box: fill-box;
    transform-origin: 33px 0;
  }

  .eye {
    fill: #120a04;
  }

  .ant-walking .tripod-a {
    animation: ant-leg-a 560ms linear infinite;
  }

  .ant-walking .tripod-b {
    animation: ant-leg-b 560ms linear infinite;
  }

  .ant-walking .antenna-left {
    animation: antenna-left 1.4s ease-in-out infinite;
  }

  .ant-walking .antenna-right {
    animation: antenna-right 1.4s ease-in-out infinite;
  }

  .ant-resting {
    left: var(--rest-left);
    opacity: 1;
    transform: translateX(-50%);
    animation: none;
  }

  .ant-resting .ant-motion {
    animation: ant-breathe 2.8s ease-in-out infinite;
  }

  .ant-stuck {
    animation-play-state: paused;
    color: #e0533d;
  }

  .ant-stuck .ant-motion {
    animation: ant-attention 1.2s ease-in-out infinite;
  }

  .warning-mark {
    position: absolute;
    top: 0.12rem;
    left: 50%;
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    transform: translateX(-50%) translateY(-0.25rem);
    border: 1px solid rgb(255 122 93 / 72%);
    border-radius: 999px;
    color: white;
    background: #e0533d;
    font-size: 0.62rem;
    font-weight: 950;
    line-height: 1;
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 60%));
    animation: warn-pulse 1.1s ease-in-out infinite;
  }

  .agent-nameplate {
    position: absolute;
    left: 50%;
    bottom: 0.18rem;
    display: inline-flex;
    align-items: center;
    gap: 0.26rem;
    max-width: 6.9rem;
    transform: translateX(-50%);
    padding: 0.12rem 0.42rem;
    border: 1px solid color-mix(in srgb, var(--agent-accent) 48%, var(--line-soft));
    border-radius: 999px;
    color: var(--ink-strong);
    background: color-mix(in srgb, var(--surface-card) 94%, white 6%);
    box-shadow: 0 0.08rem 0.28rem rgb(57 33 20 / 16%);
    font-size: 0.62rem;
    line-height: 1.1;
    white-space: nowrap;
    pointer-events: none;
  }

  .agent-nameplate strong,
  .agent-nameplate span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .agent-nameplate strong {
    max-width: 4.7rem;
    font-weight: 850;
  }

  .agent-nameplate span {
    color: var(--ink-muted);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  :global(:root[data-theme='dark']) .agent-nameplate {
    color: #f4efe7;
    background: rgb(20 15 9 / 92%);
    box-shadow: 0 0.08rem 0.35rem rgb(0 0 0 / 46%);
  }

  .agent-tooltip {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 0.5rem);
    z-index: 4;
    min-width: max-content;
    transform: translateX(-50%) translateY(0.2rem);
    padding: 0.46rem 0.68rem;
    border: 1px solid color-mix(in srgb, var(--agent-accent) 64%, #b45309);
    border-radius: 0.65rem;
    color: var(--ink-strong);
    background: color-mix(in srgb, var(--surface-card) 97%, transparent);
    box-shadow: var(--shadow-card);
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease, transform 120ms ease;
  }

  .agent-tooltip strong,
  .agent-tooltip span {
    display: block;
  }

  .agent-tooltip::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -0.42rem;
    transform: translateX(-50%);
    border: 0.42rem solid transparent;
    border-top-color: color-mix(in srgb, var(--agent-accent) 64%, #b45309);
  }

  .agent-tooltip strong {
    font-size: 0.78rem;
    font-weight: 750;
  }

  .agent-tooltip span {
    color: var(--ink-muted);
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .agent-ant:hover .agent-tooltip,
  .agent-ant:focus-visible .agent-tooltip {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  .agent-ant:hover,
  .agent-ant:focus-visible {
    z-index: 5;
    animation-play-state: paused;
  }

  .agent-ant:focus-visible .ant-motion {
    border-radius: 999px;
    outline: 2px solid color-mix(in srgb, var(--agent-accent) 75%, white);
    outline-offset: 0.2rem;
  }

  .status-stale {
    position: absolute;
    right: 0.65rem;
    top: 0.72rem;
    margin-left: auto;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    border: 1px dashed var(--surface-edge);
    color: var(--ink-soft);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .status-empty {
    position: absolute;
    left: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--ink-soft);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  @keyframes ant-crawl {
    0% {
      opacity: 0;
      left: -6rem;
    }
    8%,
    92% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      left: calc(100% + 6rem);
    }
  }

  @keyframes ant-leg-a {
    0%, 100% { transform: translateX(0.32rem) rotate(-4deg); }
    50% { transform: translateX(-0.34rem) rotate(5deg); }
  }

  @keyframes ant-leg-b {
    0%, 100% { transform: translateX(-0.34rem) rotate(5deg); }
    50% { transform: translateX(0.32rem) rotate(-4deg); }
  }

  @keyframes antenna-left {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(5deg); }
  }

  @keyframes antenna-right {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(-5deg); }
  }

  @keyframes ant-breathe {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.045); }
  }

  @keyframes ant-attention {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-0.12rem); }
  }

  @keyframes warn-pulse {
    0%, 100% { opacity: 0.65; }
    50% { opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-ant,
    .agent-ant .leg,
    .agent-ant .ant-motion {
      animation: none;
    }
    .agent-ant {
      position: relative;
      left: auto;
      display: inline-grid;
      margin-right: 0.45rem;
      transform: none;
    }
    .agent-status-footer {
      display: flex;
      align-items: center;
      gap: 0.2rem;
    }
  }
</style>
