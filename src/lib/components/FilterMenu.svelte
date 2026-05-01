<script lang="ts">
  import NocturneIcon from './NocturneIcon.svelte';

  type DashboardOrderMode = 'activity' | 'manual';
  type DashboardTypeFilter = 'all' | 'terminals' | 'chats';

  let {
    typeFilter,
    onSetTypeFilter,
    searchText,
    onSetSearchText,
    orderMode,
    hasManualOrder,
    onSetOrderMode,
    onResetOrder,
  }: {
    typeFilter: DashboardTypeFilter;
    onSetTypeFilter: (value: DashboardTypeFilter) => void;
    searchText: string;
    onSetSearchText: (value: string) => void;
    orderMode: DashboardOrderMode;
    hasManualOrder: boolean;
    onSetOrderMode: (mode: DashboardOrderMode) => void;
    onResetOrder: () => void;
  } = $props();

  let open = $state(false);
  let searchEl = $state<HTMLInputElement | null>(null);

  const isFiltered = $derived(
    typeFilter !== 'all' || (searchText?.trim().length ?? 0) > 0
  );

  function handleWindowClick(event: MouseEvent) {
    const target = event.target as Element | null;
    if (!target?.closest('[data-filter-menu]')) open = false;
  }

  function toggle() {
    open = !open;
    if (open) setTimeout(() => searchEl?.focus(), 0);
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="filter-shell" data-filter-menu>
  <button
    type="button"
    class="filter-trigger"
    class:active={open}
    class:filtered={isFiltered}
    onclick={toggle}
    title="Filter & order"
    aria-label="Filter & order"
  >
    <NocturneIcon name="filter" size={18} />
    {#if isFiltered}<span class="filter-dot" aria-hidden="true"></span>{/if}
  </button>

  {#if open}
    <div class="filter-menu" role="menu">
      <div class="filter-section">
        <div class="filter-section__title">Search</div>
        <input
          bind:this={searchEl}
          type="search"
          class="search-input"
          placeholder="Find a session…"
          value={searchText}
          oninput={(e) => onSetSearchText((e.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <div class="filter-section">
        <div class="filter-section__title">Show</div>
        <div class="seg-toggle">
          <button
            type="button"
            class:active={typeFilter === 'all'}
            onclick={() => onSetTypeFilter('all')}
          >All</button>
          <button
            type="button"
            class:active={typeFilter === 'terminals'}
            onclick={() => onSetTypeFilter('terminals')}
          >Terminals</button>
          <button
            type="button"
            class:active={typeFilter === 'chats'}
            onclick={() => onSetTypeFilter('chats')}
          >Chats</button>
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-section__title">Order</div>
        <div class="seg-toggle">
          <button
            type="button"
            class:active={orderMode === 'activity'}
            onclick={() => onSetOrderMode('activity')}
            title="Order by latest activity"
          >Activity</button>
          <button
            type="button"
            class:active={orderMode === 'manual'}
            onclick={() => onSetOrderMode('manual')}
            title="Drag cards to reorder"
          >Manual</button>
        </div>
        {#if hasManualOrder}
          <button
            type="button"
            class="reset-btn"
            onclick={() => { onResetOrder(); }}
            title="Reset manual order"
          >Reset manual order</button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .filter-shell {
    position: relative;
    display: inline-flex;
  }

  .filter-trigger {
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
    position: relative;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .filter-trigger:hover,
  .filter-trigger.active {
    background: var(--bg-card);
    border-color: var(--border-subtle);
    color: var(--text);
  }

  .filter-trigger.filtered {
    color: #6366F1;
  }

  .filter-dot {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #6366F1;
    box-shadow: 0 0 0 2px var(--bg);
  }

  .filter-menu {
    position: absolute;
    right: 0;
    top: 38px;
    z-index: 60;
    width: min(280px, calc(100vw - 24px));
    border: 1px solid var(--border-light);
    border-radius: 12px;
    background: var(--bg-card);
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.2);
    padding: 12px 14px;
  }

  .filter-section + .filter-section {
    margin-top: 12px;
    border-top: 1px solid var(--border-subtle);
    padding-top: 12px;
  }

  .filter-section__title {
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .search-input {
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 7px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .search-input:focus {
    border-color: #6366F1;
    box-shadow: 0 0 0 2px #6366F122;
  }

  .seg-toggle {
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg);
  }

  .seg-toggle button {
    flex: 1;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .seg-toggle button.active {
    background: #6366F1;
    color: #fff;
  }

  .reset-btn {
    margin-top: 8px;
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 7px;
    background: transparent;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .reset-btn:hover {
    color: var(--text);
    background: var(--bg);
    border-color: var(--border-light);
  }
</style>
