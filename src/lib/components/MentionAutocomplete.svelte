<!--
  MentionAutocomplete — alias-aware @ handle dropdown for the composer.
  Wireframe board WTHef state h05 (Claude lane, x=-6200 y=1800).

  Purely presentational: the parent (ChatComposer) owns the active index
  and key handling, since the keystrokes land on the textarea, not here.
  Hover sets the active index for mouse parity. role=listbox with
  aria-activedescendant so screen readers announce the highlighted option
  as the user arrows through.
-->
<script lang="ts">
  import type { MentionOption } from '$lib/composer/composerMentions';

  type Props = {
    options: MentionOption[];
    activeIndex: number;
    onPick: (handleToInsert: string) => void;
    onHover: (newActiveIndex: number) => void;
  };

  let { options, activeIndex, onPick, onHover }: Props = $props();
</script>

{#if options.length > 0}
  <div
    class="mention-autocomplete"
    role="listbox"
    aria-label="Pick a handle to mention"
    aria-activedescendant={`mentionOption-${activeIndex}`}
    tabindex="-1"
  >
    {#each options as option, optionIndex (option.handleToInsert)}
      <button
        type="button"
        id={`mentionOption-${optionIndex}`}
        role="option"
        aria-selected={optionIndex === activeIndex}
        class="mention-option"
        class:active={optionIndex === activeIndex}
        class:broadcast={option.optionKind === 'broadcast'}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => onPick(option.handleToInsert)}
        onmouseenter={() => onHover(optionIndex)}
      >
        <span class="option-label">{option.displayLabel}</span>
        <span class="option-hint">{option.contextHint}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .mention-autocomplete {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin-top: 0.4rem;
    padding: 0.3rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 0.6rem;
    box-shadow: var(--shadow-card);
    max-height: 12rem;
    overflow-y: auto;
  }
  .mention-option {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    background: transparent;
    border: none;
    border-radius: 0.4rem;
    cursor: pointer;
    text-align: left;
    color: var(--ink-strong);
    font: inherit;
  }
  .mention-option.active,
  .mention-option:focus-visible {
    background: var(--accent);
    color: white;
    outline: none;
  }
  .option-label {
    font-weight: 800;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.9rem;
  }
  .option-hint {
    font-size: 0.72rem;
    opacity: 0.85;
  }
  .mention-option.broadcast {
    border: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .mention-option.broadcast .option-label::before {
    content: '⚠ ';
  }
</style>
