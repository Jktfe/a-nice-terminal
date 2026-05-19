<script lang="ts">
  import AgentStrip from '$lib/components/AgentsPage/AgentStrip.svelte';
  import AgentGrid from '$lib/components/AgentsPage/AgentGrid.svelte';
  import AgentDetailDrawer from '$lib/components/AgentsPage/AgentDetailDrawer.svelte';
  import NocturneIcon from '$lib/components/NocturneIcon.svelte';
  import { theme } from '$lib/stores/theme.svelte';

  let { data }: { data: { agents: any[]; summary: any } } = $props();
  let agents = $derived(data.agents);
  let summary = $derived(data.summary);
  let selectedAgent = $state<any | null>(null);

  function handleSelectAgent(agent: any) {
    selectedAgent = agent;
  }

  function handleCloseDrawer() {
    selectedAgent = null;
  }
</script>

<svelte:head>
  <title>Agents — ANT</title>
</svelte:head>

<div class="agents-page" class:light-mode={!theme.dark}>
  <!-- Top nav bar -->
  <nav class="top-nav">
    <a href="/" class="nav-back" title="Back to dashboard">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      <span class="nav-back-label">Dashboard</span>
    </a>
    <h1 class="nav-title">
      <img src="/ant-agents-icon-current.svg" alt="ANT" class="nav-icon" />
      Agents
      <span class="badge">{summary.activeCount} active</span>
    </h1>
    <div class="nav-actions">
      <button class="icon-btn" title="Toggle theme" onclick={() => theme.toggle()}>
        <NocturneIcon name={theme.dark ? 'sun' : 'moon'} size={18} />
      </button>
    </div>
  </nav>

  <!-- Stats bar -->
  <div class="stats-bar">
    <span class="header-stat"><span class="stat-dot active"></span> {summary.activeCount} active</span>
    <span class="header-stat"><span class="stat-dot waiting"></span> {summary.focusRoomCount} in focus</span>
    <span class="header-stat">{summary.availableCount} available</span>
    <span class="header-sep">|</span>
    <span class="header-stat">&#128172; {agents.reduce((s: number, a: any) => s + (a.stats?.messagesSent24h || 0) + (a.stats?.messagesReceived24h || 0), 0)} msgs</span>
    <span class="header-stat">&#128077; {agents.reduce((s: number, a: any) => s + (a.stats?.positiveReactions || 0), 0)} reacts</span>
  </div>

  <!-- Horizon 1: At-A-Glance Strip -->
  <AgentStrip {agents} />

  <!-- Horizon 2: Fleet Grid -->
  <AgentGrid {agents} onSelect={handleSelectAgent} />

  <!-- Horizon 3: Detail Drawer -->
  {#if selectedAgent}
    <AgentDetailDrawer agent={selectedAgent} onClose={handleCloseDrawer} />
  {/if}
</div>

<style>
  .agents-page {
    min-height: 100vh;
    background: var(--bg);
    padding-bottom: 48px;
  }

  .light-mode {
    --bg: #F7F7F5;
    --elev: #FFFFFF;
    --panel: #FBFBFA;
    --hairline: rgba(0,0,0,0.06);
    --hairline-strong: rgba(0,0,0,0.10);
    --text: #2A2922;
    --text-muted: #5A584B;
    --text-faint: #B5B3A7;
  }

  .top-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px;
    border-bottom: 1px solid var(--hairline);
    background: var(--elev);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .nav-back {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 13px;
    font-weight: 500;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 150ms;
  }

  .nav-back:hover {
    color: var(--text);
    background: var(--panel);
  }

  .nav-back-label {
    font-family: var(--font-sans);
  }

  .nav-title {
    font-size: 18px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 10px;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
  }

  .nav-icon {
    width: 24px;
    height: 24px;
    color: var(--text);
  }

  .badge {
    background: var(--emerald-500);
    color: white;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    font-family: var(--font-mono);
  }

  .nav-actions {
    display: flex;
    gap: 4px;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 18px;
    transition: all 150ms;
  }

  .icon-btn:hover {
    background: var(--panel);
    border-color: var(--hairline-strong);
    color: var(--text);
  }

  .stats-bar {
    display: flex;
    gap: 16px;
    padding: 10px 24px;
    border-bottom: 1px solid var(--hairline);
    font-size: 11.5px;
    font-family: var(--font-mono);
    color: var(--text-muted);
    background: var(--bg);
  }

  .header-stat {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .stat-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .stat-dot.active {
    background: var(--emerald-400);
    box-shadow: 0 0 4px rgba(52, 208, 111, 0.6);
  }

  .stat-dot.waiting {
    background: var(--amber-400);
  }

  .header-sep {
    color: var(--hairline-strong);
  }

  @media (max-width: 700px) {
    .top-nav {
      padding: 8px 12px;
    }
    .nav-back-label {
      display: none;
    }
    .nav-title {
      position: static;
      transform: none;
      font-size: 16px;
    }
    .stats-bar {
      flex-wrap: wrap;
      gap: 10px;
    }
  }
</style>
