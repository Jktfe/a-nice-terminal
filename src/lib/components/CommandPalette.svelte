<!--
  CommandPalette — universal Cmd-K / Ctrl-K jump-to anywhere.

  Inspired by tfeSvelteTemplates' commandpalette pattern: keyboard-first
  modal, fuzzy substring match, jump on Enter. Pulls rooms + plans +
  terminals lazily on first open (so app boot pays nothing), then keeps
  the list cached for the rest of the session.

  Keys:
    Cmd/Ctrl + K  — toggle
    Esc           — close
    ↑ / ↓         — move active item
    Enter         — jump
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { fuzzyMatch } from './commandPaletteFuzzy';

  type Item = {
    kind: 'room' | 'plan' | 'terminal' | 'search';
    id: string;
    title: string;
    subtitle: string | null;
    href: string;
  };

  let open = $state(false);
  let query = $state('');
  let activeIndex = $state(0);
  let items = $state<Item[]>([]);
  let loaded = $state(false);
  let loading = $state(false);
  let inputElement = $state<HTMLInputElement | null>(null);

  const filtered = $derived.by(() => {
    const trimmedRaw = query.trim();
    const trimmed = trimmedRaw.toLowerCase();
    if (!trimmed) return items.slice(0, 30);
    const matches = items.filter((item) => fuzzyMatch(trimmed, item.title.toLowerCase()));
    // When a query has no jump matches, fall through to message search
    // across rooms so the palette stays a single keyboard surface for
    // "find anything." When there ARE jump matches we still append the
    // search row at the bottom so users can pivot from "I meant to jump"
    // to "actually I want to search for this." See /search.
    const searchRow: Item = {
      kind: 'search',
      id: `search:${trimmedRaw}`,
      title: `Search messages for "${trimmedRaw}"`,
      subtitle: 'Full-text search across rooms',
      href: `/search?q=${encodeURIComponent(trimmedRaw)}`
    };
    return [...matches.slice(0, 30), searchRow];
  });

  async function loadOnce() {
    if (loaded || loading) return;
    loading = true;
    try {
      const [roomsRes, plansRes, termsRes] = await Promise.all([
        fetch('/api/chat-rooms'),
        fetch('/api/plans'),
        fetch('/api/terminals')
      ]);
      const next: Item[] = [];
      if (roomsRes.ok) {
        const body = (await roomsRes.json()) as { chatRooms: { id: string; name: string; summary: string | null }[] };
        for (const room of body.chatRooms ?? []) {
          next.push({
            kind: 'room',
            id: room.id,
            title: room.name,
            subtitle: room.summary,
            href: `/rooms/${room.id}`
          });
        }
      }
      if (plansRes.ok) {
        const body = (await plansRes.json()) as { plans: { id: string; title: string | null; description: string | null }[] };
        for (const plan of body.plans ?? []) {
          next.push({
            kind: 'plan',
            id: plan.id,
            title: plan.title ?? plan.id,
            subtitle: plan.description,
            href: `/plans/${encodeURIComponent(plan.id)}`
          });
        }
      }
      if (termsRes.ok) {
        const body = (await termsRes.json()) as { terminals: { sessionId: string; name: string }[] };
        for (const term of body.terminals ?? []) {
          next.push({
            kind: 'terminal',
            id: term.sessionId,
            title: term.name || term.sessionId,
            subtitle: term.sessionId,
            href: `/terminals/${encodeURIComponent(term.sessionId)}`
          });
        }
      }
      items = next;
      loaded = true;
    } catch {
      /* soft-fail: show empty list */
    } finally {
      loading = false;
    }
  }

  async function show() {
    open = true;
    query = '';
    activeIndex = 0;
    await loadOnce();
    // Focus the input next microtask so the modal is mounted.
    queueMicrotask(() => inputElement?.focus());
  }

  function hide() {
    open = false;
  }

  function jump(item: Item) {
    hide();
    void goto(item.href);
  }

  function handleGlobalKeyDown(event: KeyboardEvent) {
    const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
    if (isPaletteShortcut) {
      event.preventDefault();
      if (open) hide();
      else void show();
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      hide();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filtered.length === 0) return;
      activeIndex = (activeIndex + 1) % filtered.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target) jump(target);
    }
  }

  // Reset activeIndex whenever the filtered list shrinks past it.
  $effect(() => {
    if (activeIndex >= filtered.length) activeIndex = 0;
  });

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  });

  function iconFor(kind: Item['kind']): string {
    if (kind === 'room') return '◎';
    if (kind === 'plan') return '⌬';
    if (kind === 'search') return '⌕';
    return '▸';
  }
</script>

{#if open}
  <div
    class="palette-backdrop"
    role="presentation"
    onclick={hide}
    onkeydown={(event) => { if (event.key === 'Escape') hide(); }}
  >
    <div
      class="palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <div class="palette-input-row">
        <span class="palette-kbd" aria-hidden="true">⌘K</span>
        <input
          bind:this={inputElement}
          bind:value={query}
          type="text"
          class="palette-input"
          placeholder={loading ? 'Loading…' : 'Jump to room, plan, terminal…'}
          aria-label="Search rooms, plans, terminals"
          autocomplete="off"
          spellcheck="false"
        />
        <button type="button" class="palette-close" onclick={hide} aria-label="Close">esc</button>
      </div>

      <ul class="palette-list" role="listbox" aria-label="Results">
        {#if filtered.length === 0}
          <li class="palette-empty">
            {loading ? 'Loading workspace…' : query.trim() ? 'No matches' : 'Type to search'}
          </li>
        {:else}
          {#each filtered as item, index (item.kind + ':' + item.id)}
            <li class="palette-row" class:active={index === activeIndex} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                class="palette-row-button"
                onclick={() => jump(item)}
                onmouseenter={() => (activeIndex = index)}
              >
                <span class="palette-icon" data-kind={item.kind} aria-hidden="true">{iconFor(item.kind)}</span>
                <span class="palette-row-text">
                  <span class="palette-row-title">{item.title}</span>
                  {#if item.subtitle}
                    <span class="palette-row-sub">{item.subtitle}</span>
                  {/if}
                </span>
                <span class="palette-row-kind">{item.kind}</span>
              </button>
            </li>
          {/each}
        {/if}
      </ul>

      <div class="palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> jump</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .palette-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink-strong, #0d130d) 50%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    z-index: 1000;
    animation: palette-fade-in 0.12s ease-out;
  }
  .palette {
    width: min(640px, calc(100vw - 2rem));
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    box-shadow: 0 30px 80px rgb(0 0 0 / 25%);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: palette-pop-in 0.16s cubic-bezier(0.18, 0.89, 0.32, 1.18);
  }
  .palette-input-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .palette-kbd {
    padding: 0.18rem 0.4rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--bg);
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-weight: 800;
    font-family: 'JetBrains Mono', monospace;
    flex-shrink: 0;
  }
  .palette-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--ink-strong);
    font: inherit;
    font-size: 1rem;
    padding: 0.2rem 0;
  }
  .palette-close {
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--bg);
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.72rem;
    font-weight: 800;
    font-family: 'JetBrains Mono', monospace;
    cursor: pointer;
  }
  .palette-close:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .palette-list {
    list-style: none;
    margin: 0;
    padding: 0.35rem;
    max-height: 56vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .palette-row {
    margin: 0;
  }
  .palette-row-button {
    width: 100%;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.7rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid transparent;
    border-radius: 0.65rem;
    background: transparent;
    color: var(--ink-strong);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .palette-row.active .palette-row-button,
  .palette-row-button:focus-visible {
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-card));
    border-color: color-mix(in srgb, var(--accent) 30%, var(--line-soft));
    outline: none;
  }
  .palette-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 0.45rem;
    background: var(--bg);
    border: 1px solid var(--line-soft);
    color: var(--ink-strong);
    font-weight: 800;
    font-size: 0.95rem;
    flex-shrink: 0;
  }
  .palette-icon[data-kind='room'] { color: var(--accent); }
  .palette-icon[data-kind='plan'] { color: var(--info, #2563eb); }
  .palette-icon[data-kind='terminal'] { color: var(--ok, #16a34a); }
  .palette-icon[data-kind='search'] { color: var(--warn, #d97706); }
  .palette-row-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .palette-row-title {
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .palette-row-sub {
    font-size: 0.78rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .palette-row-kind {
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-soft);
    font-size: 0.65rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }
  .palette-empty {
    padding: 1rem 0.85rem;
    text-align: center;
    color: var(--ink-soft);
    font-size: 0.88rem;
  }
  .palette-footer {
    display: flex;
    gap: 1rem;
    padding: 0.55rem 0.95rem;
    border-top: 1px solid var(--line-soft);
    background: var(--bg);
    color: var(--ink-soft);
    font-size: 0.72rem;
  }
  .palette-footer kbd {
    display: inline-block;
    padding: 0.1rem 0.35rem;
    margin-right: 0.25rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.3rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.68rem;
  }
  @keyframes palette-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes palette-pop-in {
    from { transform: translateY(-8px) scale(0.97); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }
</style>
