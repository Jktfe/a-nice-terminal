<script lang="ts">
  import type { ParticipantBackgroundStyle, RoomMember } from '$lib/server/chatRoomStore';
  import { LLM_LOGOS } from '$lib/icons/llmLogoCatalogue';

  type Props = {
    roomId: string;
    member: RoomMember;
    onSaved?: (member: RoomMember) => void;
    onCancel?: () => void;
  };

  let { roomId, member, onSaved, onCancel }: Props = $props();

  const palette = [
    '#2563EB', '#059669', '#DC2626', '#7C3AED', '#D97706', '#0891B2', '#C026D3', '#4D7C0F',
    // JWPK msg_dacswgrsg3 (2026-05-18): white as a colour option so logo
    // SVGs with white interiors read on the chip without their fill
    // disappearing into the surface. The swatch + avatar both pick up a
    // dark hairline border when --member-color is a near-white so the
    // chip stays visible on light themes.
    '#FFFFFF'
  ];
  // #71 (re-instated per JWPK reversal): brand-shorthand emojis so
  // agents/CLIs feel distinct in the participant chip + footer. Pure
  // emoji — no brand SVGs, no asset distribution. Native paid tier
  // (#71b) keeps the curated brand-mark set as separate work.
  const icons = [
    'A', 'C', 'D', 'K', 'S', 'T',
    '🦀', '⊙', '🐋', '🌙', 'π', '☯', '🤖', '💻',
    '⚡', '✓', '◎', '◇', '→', '•'
  ];
  const backgroundStyles: { value: ParticipantBackgroundStyle; label: string }[] = [
    { value: 'card', label: 'Card' },
    { value: 'tint', label: 'Tint' },
    { value: 'transparent', label: 'Clear' }
  ];

  // Seed local edit state from the selected member; do not overwrite
  // partially edited values if the parent route refreshes mid-edit.
  // svelte-ignore state_referenced_locally
  let displayName = $state(member.displayName);
  // svelte-ignore state_referenced_locally
  let displayColor = $state(member.displayColor);
  // svelte-ignore state_referenced_locally
  let displayIcon = $state(member.displayIcon);
  // svelte-ignore state_referenced_locally
  let displayBackgroundStyle = $state(member.displayBackgroundStyle);
  let saving = $state(false);
  let errorMessage = $state('');

  async function savePresentation() {
    saving = true;
    errorMessage = '';
    try {
      const response = await fetch(
        `/api/chat-rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(member.handle)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ displayName, displayColor, displayIcon, displayBackgroundStyle })
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(body.message ?? 'Could not save participant style.');
      }
      const body = (await response.json()) as { member: RoomMember };
      onSaved?.(body.member);
    } catch (causeOfFailure) {
      errorMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not save participant style.';
    } finally {
      saving = false;
    }
  }
</script>

<form
  class="presentation-form"
  onsubmit={(event) => {
    event.preventDefault();
    void savePresentation();
  }}
>
  <h2>Room identity for {member.handle}</h2>

  <label>
    <span>Display handle</span>
    <input type="text" bind:value={displayName} maxlength="48" />
  </label>

  <div class="field-group">
    <span>Colour</span>
    <div class="swatches" role="group" aria-label="Choose participant colour">
      {#each palette as color (color)}
        <button
          type="button"
          class:active={displayColor === color}
          class="swatch"
          style:--swatch-color={color}
          aria-label={`Use ${color}`}
          onclick={() => (displayColor = color)}
        ></button>
      {/each}
    </div>
  </div>

  <div class="field-group">
    <span>Icon</span>
    <div class="icons" role="group" aria-label="Choose participant icon">
      {#each icons as icon (icon)}
        <button
          type="button"
          class:active={displayIcon === icon}
          class="icon-choice"
          onclick={() => (displayIcon = icon)}
        >{icon}</button>
      {/each}
    </div>
  </div>

  <div class="field-group">
    <span>Logo (LLM / agent brand)</span>
    <div class="logo-gallery" role="group" aria-label="Choose a logo as the participant icon">
      {#each LLM_LOGOS as logo (logo.slug)}
        <button
          type="button"
          class:active={displayIcon === `logo:${logo.slug}`}
          class="logo-choice"
          title={logo.label}
          aria-label={`Use ${logo.label} logo`}
          onclick={() => (displayIcon = `logo:${logo.slug}`)}
        >
          <img src={`/llm-icons/${logo.file}`} alt="" aria-hidden="true" loading="lazy" decoding="async" />
        </button>
      {/each}
    </div>
  </div>

  <label>
    <span>Custom icon</span>
    <input type="text" bind:value={displayIcon} maxlength="80" placeholder="Emoji, short mark, or logo:<file>.svg" />
  </label>

  <div class="field-group">
    <span>Background</span>
    <div class="background-styles" role="group" aria-label="Choose message background">
      {#each backgroundStyles as style (style.value)}
        <button
          type="button"
          class:active={displayBackgroundStyle === style.value}
          class="background-choice"
          data-background-style={style.value}
          onclick={() => (displayBackgroundStyle = style.value)}
        >{style.label}</button>
      {/each}
    </div>
  </div>

  {#if errorMessage}
    <p class="error" role="alert">{errorMessage}</p>
  {/if}

  <div class="actions">
    <button type="button" class="ghost" onclick={onCancel}>Cancel</button>
    <button type="submit" class="primary" disabled={saving || displayName.trim().length === 0}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>
</form>

<style>
  .presentation-form {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1.1rem 1.3rem;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 0.8rem;
    color: var(--ink-strong);
    box-shadow: 0 10px 30px rgb(0 0 0 / 8%);
  }
  :global(:root[data-theme='dark']) .presentation-form {
    background: #1c2417;
    border-color: #465437;
  }
  h2 {
    margin: 0;
    color: var(--ink-strong);
    font-size: 1rem;
  }
  label,
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  label span,
  .field-group > span {
    color: var(--ink-soft);
    font-size: 0.76rem;
    font-weight: 900;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  input {
    padding: 0.62rem 0.75rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font: inherit;
  }
  :global(:root[data-theme='dark']) input {
    background: #10140e;
    border-color: #465437;
  }
  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .swatches,
  .icons,
  .background-styles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .swatch {
    width: 2rem;
    height: 2rem;
    border: 2px solid transparent;
    border-radius: 0.55rem;
    background: var(--swatch-color);
    cursor: pointer;
    /* Inset hairline so pale/white swatches retain a visible edge on the
       light surface. Doesn't interfere with the 2px transparent → accent
       active-state border (that lives outside this inset shadow). */
    box-shadow: inset 0 0 0 1px var(--line-soft);
  }
  .icon-choice {
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    cursor: pointer;
    font-weight: 900;
  }
  /* Mobile polish: 44px+ touch targets for the swatch + icon grids
     so picking an identity colour/icon works on a finger. */
  @media (pointer: coarse) {
    .swatch, .icon-choice, .logo-choice {
      width: 2.75rem;
      height: 2.75rem;
    }
  }
  .logo-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(2.5rem, 1fr));
    gap: 0.4rem;
    max-height: 14rem;
    overflow-y: auto;
    padding: 0.25rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    background: var(--bg);
  }
  .logo-choice {
    width: 2.4rem;
    height: 2.4rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    background: white;
    cursor: pointer;
    padding: 0.2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .logo-choice img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .logo-choice:hover { border-color: var(--accent); }
  .logo-choice.active {
    border-color: var(--ink-strong);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .background-choice {
    padding: 0.48rem 0.72rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    cursor: pointer;
    font-weight: 800;
  }
  .background-choice[data-background-style='tint'] {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-raised));
  }
  .background-choice[data-background-style='transparent'] {
    background: transparent;
  }
  .swatch.active,
  .icon-choice.active,
  .background-choice.active {
    border-color: var(--ink-strong);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .error {
    margin: 0;
    color: #c92020;
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
  }
  .ghost,
  .primary {
    padding: 0.55rem 1rem;
    border-radius: 999px;
    font-weight: 800;
    cursor: pointer;
  }
  .ghost {
    border: 1px solid var(--line-soft);
    background: var(--surface-raised);
    color: var(--ink-strong);
  }
  .primary {
    border: none;
    background: var(--accent);
    color: white;
  }
  .primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
