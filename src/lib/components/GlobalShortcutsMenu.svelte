<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { SHORTCUT_SCOPES, shortcutScopeLabel } from '$lib/shared/personal-settings';
  import { usePersonalSettings } from '$lib/stores/personal-settings.svelte';

  let {
    currentSessionId = '',
    onOpenSettings = () => {},
  }: {
    currentSessionId?: string;
    onOpenSettings?: () => void;
  } = $props();

  const personal = usePersonalSettings();
  let open = $state(false);

  onMount(() => {
    void personal.load();
  });

  const totalShortcuts = $derived(
    personal.settings.shortcuts.chatrooms.length + personal.settings.shortcuts.linkedChats.length
  );

  function handleWindowClick(event: MouseEvent) {
    const target = event.target as Element | null;
    if (!target?.closest('[data-global-shortcuts]')) open = false;
  }

  function openShortcut(sessionId: string) {
    open = false;
    goto(`/session/${sessionId}`);
  }

  function handleSettings() {
    open = false;
    onOpenSettings();
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="relative" data-global-shortcuts>
  <button
    type="button"
    class="shortcut-trigger"
    class:active={open}
    onclick={() => { open = !open; }}
    title="Global shortcuts"
    aria-label="Global shortcuts"
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M13 10V3L4 14h7v7l9-11h-7z"/>
    </svg>
    {#if totalShortcuts > 0}
      <span>{totalShortcuts}</span>
    {/if}
  </button>

  {#if open}
    <div class="shortcut-menu">
      <div class="shortcut-menu__head">
        <span>Shortcuts</span>
        <button type="button" class="icon-btn" onclick={handleSettings} title="Shortcut settings" aria-label="Shortcut settings">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </button>
      </div>

      {#each SHORTCUT_SCOPES as scope}
        {@const shortcuts = personal.settings.shortcuts[scope]}
        <section class="shortcut-section">
          <div class="shortcut-section__title">{shortcutScopeLabel(scope)}</div>
          {#if shortcuts.length === 0}
            <div class="shortcut-empty">No shortcuts</div>
          {:else}
            <div class="shortcut-list">
              {#each shortcuts as shortcut (shortcut.id)}
                <button
                  type="button"
                  class="shortcut-item"
                  class:current={shortcut.sessionId === currentSessionId}
                  style="--accent:{shortcut.color};"
                  onclick={() => openShortcut(shortcut.sessionId)}
                  title={shortcut.label}
                >
                  <span class="shortcut-item__icon">{shortcut.icon}</span>
                  <span class="shortcut-item__label">{shortcut.label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .shortcut-trigger {
    height: 32px;
    min-width: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .shortcut-trigger:hover,
  .shortcut-trigger.active {
    background: var(--bg-card);
    border-color: var(--border-subtle);
    color: #6366F1;
  }

  .shortcut-trigger span {
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .shortcut-menu {
    position: absolute;
    right: 0;
    top: 38px;
    z-index: 60;
    width: min(340px, calc(100vw - 24px));
    max-height: min(560px, calc(100vh - 80px));
    overflow-y: auto;
    border: 1px solid var(--border-light);
    border-radius: 12px;
    background: var(--bg-card);
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.2);
  }

  .shortcut-menu__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text);
    font-size: 12px;
    font-weight: 700;
  }

  .icon-btn {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-subtle);
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon-btn:hover {
    color: #6366F1;
    background: #6366F112;
    border-color: #6366F155;
  }

  .shortcut-section {
    padding: 10px 12px 12px;
  }

  .shortcut-section + .shortcut-section {
    border-top: 1px solid var(--border-subtle);
  }

  .shortcut-section__title {
    margin-bottom: 7px;
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .shortcut-empty {
    color: var(--text-faint);
    font-size: 12px;
    padding: 5px 0;
  }

  .shortcut-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .shortcut-item {
    min-height: 30px;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--accent);
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .shortcut-item:hover,
  .shortcut-item.current {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  }

  .shortcut-item__icon {
    font-size: 13px;
    line-height: 1;
  }

  .shortcut-item__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
  }
</style>
