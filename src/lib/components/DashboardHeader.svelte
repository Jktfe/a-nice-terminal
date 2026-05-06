<script lang="ts">
  import { theme } from '$lib/stores/theme.svelte';
  import { useGridStore } from '$lib/stores/grid.svelte';
  import NocturneIcon from './NocturneIcon.svelte';
  import FilterMenu from './FilterMenu.svelte';

  type DashboardOrderMode = 'activity' | 'manual';
  type DashboardTypeFilter = 'all' | 'terminals' | 'chats';

  let {
    orderMode,
    hasManualOrder,
    typeFilter,
    searchText,
    onSetOrderMode,
    onResetOrder,
    onSetTypeFilter,
    onSetSearchText,
    onTogglePersonalSettings,
    askCount = 0,
  }: {
    orderMode: DashboardOrderMode;
    hasManualOrder: boolean;
    typeFilter: DashboardTypeFilter;
    searchText: string;
    onSetOrderMode: (mode: DashboardOrderMode) => void;
    onResetOrder: () => void;
    onSetTypeFilter: (value: DashboardTypeFilter) => void;
    onSetSearchText: (value: string) => void;
    onTogglePersonalSettings: () => void;
    askCount?: number;
  } = $props();

  const grid = useGridStore();
</script>

<header class="dashboard-header">
  <!-- Logo -->
  <div class="logo">
    {#if theme.dark}
      <img src="/ANTlogo.png" alt="ANT" />
    {:else}
      <img src="/ANTlogo-black-text.png" alt="ANT" />
    {/if}
  </div>

  <!-- Right-side icon strip -->
  <div class="actions">
    <!-- Theme toggle -->
    <button
      type="button"
      class="icon-btn"
      onclick={() => theme.toggle()}
      title={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
    >
      <NocturneIcon name={theme.dark ? 'sun' : 'moon'} size={18} />
    </button>

    <!-- Help / docs -->
    <a
      href="/help"
      class="icon-btn"
      title="CLI command reference"
      aria-label="Help"
    >
      <NocturneIcon name="help" size={18} />
    </a>

    <!-- Ask queue -->
    <a
      href="/asks"
      class="icon-btn badge-host"
      class:active={askCount > 0}
      title="Ask queue"
      aria-label="Ask queue"
    >
      <NocturneIcon name="inbox" size={18} />
      {#if askCount > 0}
        <span class="badge">{askCount > 99 ? '99+' : askCount}</span>
      {/if}
    </a>

    <!-- Grid toggle -->
    <button
      type="button"
      class="icon-btn"
      class:active={grid.enabled}
      onclick={() => grid.toggle()}
      title="Toggle grid view"
      aria-label="Toggle grid view"
    >
      <NocturneIcon name="grid" size={18} />
    </button>

    <!-- Grid dimension controls (only visible in grid mode) -->
    {#if grid.enabled}
      <div class="grid-dims" aria-label="Grid dimensions">
        <span class="grid-dims__label">C</span>
        <button class="grid-dims__btn" onclick={() => grid.setDimensions(grid.cols - 1, grid.rows)} disabled={grid.cols <= 1} aria-label="Fewer columns">−</button>
        <span class="grid-dims__count">{grid.cols}</span>
        <button class="grid-dims__btn" onclick={() => grid.setDimensions(grid.cols + 1, grid.rows)} disabled={grid.cols >= 5} aria-label="More columns">+</button>
        <span class="grid-dims__label grid-dims__label--rows">R</span>
        <button class="grid-dims__btn" onclick={() => grid.setDimensions(grid.cols, grid.rows - 1)} disabled={grid.rows <= 1} aria-label="Fewer rows">−</button>
        <span class="grid-dims__count">{grid.rows}</span>
        <button class="grid-dims__btn" onclick={() => grid.setDimensions(grid.cols, grid.rows + 1)} disabled={grid.rows >= 5} aria-label="More rows">+</button>
      </div>
    {/if}

    <!-- Filter & order -->
    {#if !grid.enabled}
      <FilterMenu
        {typeFilter}
        {onSetTypeFilter}
        {searchText}
        {onSetSearchText}
        {orderMode}
        {hasManualOrder}
        {onSetOrderMode}
        {onResetOrder}
      />
    {/if}

    <!-- Personal settings -->
    <button
      type="button"
      class="icon-btn"
      onclick={onTogglePersonalSettings}
      title="Personal settings"
      aria-label="Personal settings"
    >
      <NocturneIcon name="settings" size={18} />
    </button>
  </div>
</header>

<style>
  .dashboard-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg);
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .dashboard-header {
      padding: 12px 16px;
    }
  }

  .logo {
    display: inline-flex;
    align-items: center;
  }

  .logo img {
    height: 36px;
    width: auto;
  }

  .actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .icon-btn:hover {
    background: var(--bg-card);
    border-color: var(--border-subtle);
    color: var(--text);
  }

  .icon-btn.active {
    background: rgba(239, 68, 68, 0.12);
    border-color: rgba(239, 68, 68, 0.35);
    color: #EF4444;
  }

  button.icon-btn.active {
    background: rgba(99, 102, 241, 0.12);
    border-color: rgba(99, 102, 241, 0.35);
    color: #6366F1;
  }

  .badge-host {
    position: relative;
  }

  .badge {
    position: absolute;
    top: -5px;
    right: -6px;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: #EF4444;
    color: white;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    border: 2px solid var(--bg);
  }

  .grid-dims {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: 4px;
    color: var(--text-muted);
  }

  @media (max-width: 640px) {
    .grid-dims { display: none; }
  }

  .grid-dims__label {
    font-family: var(--font-mono);
    font-size: 11px;
    margin: 0 2px;
  }

  .grid-dims__label--rows { margin-left: 6px; }

  .grid-dims__btn {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .grid-dims__btn:hover { background: var(--bg-card); }
  .grid-dims__btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .grid-dims__count {
    width: 14px;
    text-align: center;
    font-size: 11px;
  }
</style>
