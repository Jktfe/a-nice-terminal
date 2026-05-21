<!--
  KeyboardShortcutsOverlay — global discoverability for keyboard
  shortcuts. Press `?` anywhere outside an input to open. Esc closes.
  Lives in the root layout alongside CommandPalette so every page
  inherits it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';

  type Shortcut = { keys: string[]; description: string };
  type Section = { title: string; shortcuts: Shortcut[] };

  const SECTIONS: Section[] = [
    {
      title: 'Anywhere',
      shortcuts: [
        { keys: ['⌘', 'K'], description: 'Open command palette — jump to any room, plan, or terminal' },
        { keys: ['?'], description: 'Show this keyboard shortcuts overlay' },
        { keys: ['Esc'], description: 'Close palette / overlay / modal' }
      ]
    },
    {
      title: 'Quick nav (g-prefix)',
      shortcuts: [
        { keys: ['g', 'd'], description: 'Go to Dashboard' },
        { keys: ['g', 'r'], description: 'Go to Rooms' },
        { keys: ['g', 'p'], description: 'Go to Plans' },
        { keys: ['g', 't'], description: 'Go to Terminals' },
        { keys: ['g', 's'], description: 'Go to Search' },
        { keys: ['g', 'a'], description: 'Go to Asks queue' },
        { keys: ['g', 'v'], description: 'Go to Verification policies' },
        { keys: ['g', 'c'], description: 'Go to Chair board' }
      ]
    },
    {
      title: 'Command palette',
      shortcuts: [
        { keys: ['↑'], description: 'Move active row up' },
        { keys: ['↓'], description: 'Move active row down' },
        { keys: ['↵'], description: 'Jump to active row' }
      ]
    },
    {
      title: 'Chat composer',
      shortcuts: [
        { keys: ['↵'], description: 'Send message' },
        { keys: ['⇧', '↵'], description: 'New line without sending' }
      ]
    },
    {
      title: 'Deck viewer',
      shortcuts: [
        { keys: ['←'], description: 'Previous slide' },
        { keys: ['→'], description: 'Next slide' },
        { keys: ['Space'], description: 'Next slide' },
        { keys: ['I'], description: 'Toggle slide JSON inspector' }
      ]
    },
    {
      title: 'Doc viewer',
      shortcuts: [
        { keys: ['S'], description: 'Toggle markdown source view' }
      ]
    }
  ];

  let open = $state(false);

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function handleGlobalKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      open = false;
      return;
    }
    if (event.key !== '?') return;
    if (isTypingTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    open = !open;
  }

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  });
</script>

{#if open}
  <div
    class="overlay-backdrop"
    role="presentation"
    onclick={() => (open = false)}
    onkeydown={(event) => { if (event.key === 'Escape') open = false; }}
    transition:fade={{ duration: 120 }}
  >
    <div
      class="overlay-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
      transition:scale={{ duration: 160, start: 0.95 }}
    >
      <header class="overlay-header">
        <h2>Keyboard shortcuts</h2>
        <button type="button" class="close-btn" onclick={() => (open = false)} aria-label="Close">esc</button>
      </header>
      <div class="overlay-grid">
        {#each SECTIONS as section (section.title)}
          <section class="overlay-section">
            <h3>{section.title}</h3>
            <dl>
              {#each section.shortcuts as shortcut (shortcut.description)}
                <div class="row">
                  <dt class="keys">
                    {#each shortcut.keys as key, i (key + i)}
                      <kbd>{key}</kbd>
                    {/each}
                  </dt>
                  <dd>{shortcut.description}</dd>
                </div>
              {/each}
            </dl>
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink-strong, #0d130d) 55%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 8vh;
    z-index: 1001;
  }
  .overlay-panel {
    width: min(760px, calc(100vw - 2rem));
    max-height: 80vh;
    overflow: auto;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    box-shadow: 0 30px 80px rgb(0 0 0 / 25%);
  }
  .overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.2rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .overlay-header h2 { margin: 0; font-size: 1.05rem; }
  .close-btn {
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    background: var(--bg);
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.72rem;
    font-weight: 800;
    font-family: 'JetBrains Mono', monospace;
    cursor: pointer;
  }
  .close-btn:hover { border-color: var(--accent); color: var(--accent); }
  .overlay-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0.85rem 1.5rem;
    padding: 1.1rem 1.2rem 1.3rem;
  }
  .overlay-section h3 {
    margin: 0 0 0.55rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    font-weight: 800;
  }
  .overlay-section dl { margin: 0; }
  .row {
    display: grid;
    grid-template-columns: max-content 1fr;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.35rem 0;
    border-bottom: 1px dashed var(--line-soft);
  }
  .row:last-child { border-bottom: none; }
  .keys { margin: 0; display: flex; gap: 0.2rem; flex-wrap: wrap; align-items: center; }
  dd { margin: 0; color: var(--ink-strong); font-size: 0.88rem; line-height: 1.35; }
  kbd {
    display: inline-block;
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.35rem;
    background: var(--bg);
    color: var(--ink-strong);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.78rem;
    font-weight: 700;
    min-width: 1rem;
    text-align: center;
  }
</style>
