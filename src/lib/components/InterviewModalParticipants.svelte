<!--
  InterviewModalParticipants — participant chips + add-agent picker.
  Extracted 2026-05-21 to keep InterviewModal under the 600-line cap.
  Owns its own picker-open local state (parent doesn't need to know).
  Same DOM + classes as the inlined version so existing CSS selectors
  match unchanged.
-->
<script lang="ts">
  import NocturneIcon from './NocturneIcon.svelte';

  export interface InterviewParticipant {
    handle: string;
    displayName?: string;
    isTarget: boolean;
    muted: boolean;
  }

  type Props = {
    participants: InterviewParticipant[];
    candidateAgents: { handle: string; displayName?: string }[];
    onAddParticipant?: (handle: string) => void | Promise<void>;
    onRemoveParticipant?: (handle: string) => void | Promise<void>;
    onToggleMute?: (handle: string, muted: boolean) => void | Promise<void>;
  };

  let {
    participants,
    candidateAgents,
    onAddParticipant,
    onRemoveParticipant,
    onToggleMute,
  }: Props = $props();

  let pickerOpen = $state(false);
</script>

<div class="iv-participants" aria-label="Interview participants">
  {#each participants as p (p.handle)}
    <div class="iv-participant" class:iv-participant--muted={p.muted}>
      <span class="iv-pdot" data-target={p.isTarget ? 'true' : 'false'}></span>
      <span class="iv-phandle">{p.displayName ?? p.handle}</span>
      {#if p.isTarget}
        <span class="iv-ptag">target</span>
      {/if}
      <button
        type="button"
        class="iv-pmute"
        onclick={() => onToggleMute?.(p.handle, !p.muted)}
        title={p.muted ? `Unmute ${p.handle}` : `Mute ${p.handle}`}
        aria-pressed={p.muted}
      >
        <NocturneIcon name={p.muted ? 'x' : 'mic'} size={11} color="currentColor" />
        <span>{p.muted ? 'muted' : 'speaking'}</span>
      </button>
      {#if !p.isTarget}
        <button
          type="button"
          class="iv-premove"
          onclick={() => onRemoveParticipant?.(p.handle)}
          title={`Remove ${p.handle} from this interview`}
          aria-label={`Remove ${p.handle}`}
        >
          <NocturneIcon name="x" size={10} color="currentColor" />
        </button>
      {/if}
    </div>
  {/each}
  {#if candidateAgents.length > 0}
    <div class="iv-add-wrap">
      <button
        type="button"
        class="iv-add-btn"
        onclick={() => (pickerOpen = !pickerOpen)}
        aria-expanded={pickerOpen}
        title="Add an agent from this room"
      >+ add agent</button>
      {#if pickerOpen}
        <div class="iv-picker" role="menu">
          {#each candidateAgents as a (a.handle)}
            <button
              type="button"
              class="iv-picker-row"
              role="menuitem"
              onclick={() => {
                pickerOpen = false;
                void onAddParticipant?.(a.handle);
              }}
            >
              <span class="iv-pdot"></span>
              <span>{a.displayName ?? a.handle}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .iv-participants {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--hairline, rgba(0, 0, 0, 0.08));
  }
  .iv-participant {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 999px;
    border: 0.5px solid var(--hairline-strong, rgba(0, 0, 0, 0.14));
    background: var(--hairline, rgba(0, 0, 0, 0.04));
    font-size: 12px;
  }
  .iv-participant--muted {
    opacity: 0.55;
  }
  .iv-pdot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--accent-blue, #3b82f6);
  }
  .iv-pdot[data-target='true'] {
    background: var(--accent-emerald, #22c55e);
  }
  .iv-phandle { font-family: var(--font-mono, monospace); font-size: 11.5px; }
  .iv-ptag {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted, #6b7280);
  }
  .iv-pmute {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 0.5px solid currentColor;
    background: transparent;
    color: inherit;
    padding: 0 6px;
    border-radius: 3px;
    font: inherit;
    font-size: 10.5px;
    cursor: pointer;
    line-height: 18px;
  }
  .iv-pmute:hover { background: rgba(0, 0, 0, 0.04); }
  .iv-premove {
    border: 0;
    background: transparent;
    color: var(--text-muted, #6b7280);
    cursor: pointer;
    padding: 0 2px;
    display: inline-flex;
    align-items: center;
  }
  .iv-premove:hover { color: var(--text, #111); }
  .iv-add-wrap {
    position: relative;
    display: inline-flex;
  }
  .iv-add-btn {
    border: 0.5px dashed var(--hairline-strong, rgba(0, 0, 0, 0.18));
    background: transparent;
    color: var(--text-muted, #6b7280);
    font: inherit;
    font-size: 11.5px;
    padding: 3px 10px;
    border-radius: 999px;
    cursor: pointer;
  }
  .iv-add-btn:hover { color: var(--text, #111); }
  .iv-picker {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: var(--surface, #fff);
    border: 0.5px solid var(--hairline-strong, rgba(0, 0, 0, 0.16));
    border-radius: 6px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
    min-width: 180px;
    z-index: 2;
    padding: 4px;
  }
  .iv-picker-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 4px;
    font: inherit;
    font-size: 12px;
    text-align: left;
  }
  .iv-picker-row:hover { background: var(--hairline, rgba(0, 0, 0, 0.05)); }
</style>
