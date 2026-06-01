<!--
  FocusModeModal — #78b agent/participant focus mode entry UI.
  Refactored to ModalShell. Preserves exact API.
-->
<script lang="ts">
  import ModalShell from './ModalShell.svelte';
  import type { RoomMember } from '$lib/server/chatRoomStore';

  type Props = {
    roomId: string;
    members: RoomMember[];
    preselectedHandle?: string | null;
    onClose: () => void;
    onEntered?: () => void;
  };

  let { roomId, members, preselectedHandle, onClose, onEntered }: Props = $props();

  type DurationChoice = { label: string; durationMs: number | null };

  const PRESETS: DurationChoice[] = [
    { label: '15m', durationMs: 15 * 60_000 },
    { label: '30m', durationMs: 30 * 60_000 },
    { label: '1h', durationMs: 60 * 60_000 },
    { label: '2h', durationMs: 120 * 60_000 },
    { label: 'Indefinite', durationMs: null }
  ];

  let selectedMs = $state<number | null>(PRESETS[2].durationMs);
  let selectedHandle = $state('');
  let customMin = $state('');
  let reason = $state('');
  let submitting = $state(false);
  let err = $state('');

  const resolvedMs = $derived.by<number | null>(() => {
    const trimmed = customMin.trim();
    if (trimmed.length > 0) {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n > 0) return Math.round(n * 60_000);
    }
    return selectedMs;
  });

  $effect(() => {
    const handles = members.map((member) => member.handle);
    const preferred = preselectedHandle && handles.includes(preselectedHandle)
      ? preselectedHandle
      : (handles[0] ?? '');
    if (!selectedHandle || !handles.includes(selectedHandle)) selectedHandle = preferred;
  });

  async function submit() {
    if (!selectedHandle) {
      err = 'Choose an agent to focus.';
      return;
    }
    submitting = true; err = '';
    try {
      const body: Record<string, unknown> = { memberHandle: selectedHandle };
      const r = reason.trim();
      if (r.length > 0) body.reason = r;
      if (resolvedMs !== null) body.durationMs = resolvedMs;
      const res = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/focus-mode`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(j.message ?? 'Could not enter focus.');
      }
      onEntered?.(); onClose();
    } catch (e) {
      err = e instanceof Error ? e.message : 'Could not enter focus.';
    } finally {
      submitting = false;
    }
  }
</script>

<ModalShell open={true} onCancel={onClose} size="default">
  {#snippet title()}Set agent focus{/snippet}

  <p class="sub">Choose an agent, set the focus target, and pick how long others should avoid interrupting.</p>

  <form onsubmit={(e) => { e.preventDefault(); void submit(); }}>
    <fieldset class="member-picker">
      <legend>Agent</legend>
      {#if members.length > 0}
        <select bind:value={selectedHandle}>
          {#each members as m}
            <option value={m.handle}>{m.displayName ?? m.handle}</option>
          {/each}
        </select>
      {:else}
        <p class="empty">No agents are in this room yet.</p>
      {/if}
    </fieldset>

    <fieldset class="presets">
      <legend>Duration</legend>
      <div class="row">
        {#each PRESETS as p (p.label)}
          <button
            type="button"
            class="chip"
            class:active={customMin.trim().length === 0 && selectedMs === p.durationMs}
            onclick={() => { selectedMs = p.durationMs; customMin = ''; }}
          >{p.label}</button>
        {/each}
      </div>
      <label class="custom">
        <span>Custom (minutes)</span>
        <input type="number" min="1" step="1" inputmode="numeric" bind:value={customMin} placeholder="e.g. 45" />
      </label>
    </fieldset>

    <label class="reason">
      <span>Focus target (optional)</span>
      <textarea bind:value={reason} maxlength="240" rows="2" placeholder="e.g. writing the PR description"></textarea>
    </label>

    {#if err}
      <p class="error" role="alert">{err}</p>
    {/if}
  </form>

  {#snippet actions()}
    <button type="button" class="ghost" onclick={onClose}>Cancel</button>
    <button type="submit" class="primary" disabled={submitting || !selectedHandle} onclick={() => void submit()}>
      {submitting ? 'Setting…' : 'Set focus'}
    </button>
  {/snippet}
</ModalShell>

<style>
  .sub { margin: 0; color: var(--ink-soft); font-size: 0.85rem; }
  form { display: flex; flex-direction: column; gap: 0.75rem; }
  .member-picker { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .member-picker legend { padding: 0; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); font-weight: 800; }
  .member-picker select { padding: 0.5rem 0.6rem; border: 1px solid var(--line-soft); border-radius: 0.5rem; background: var(--bg); color: var(--ink-strong); font: inherit; }
  .empty { margin: 0; color: var(--ink-soft); font-size: 0.85rem; }
  .presets { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .presets legend { padding: 0; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); font-weight: 800; }
  .row { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip {
    padding: 0.35rem 0.7rem; border: 1px solid var(--line-soft); border-radius: 999px;
    background: var(--bg); color: var(--ink-strong); font: inherit; font-weight: 700; cursor: pointer;
  }
  .chip.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--bg)); color: var(--accent); }
  .custom, .reason { display: flex; flex-direction: column; gap: 0.2rem; }
  .custom span, .reason span { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); font-weight: 800; }
  .custom input, .reason textarea { padding: 0.55rem 0.7rem; border: 1px solid var(--line-soft); border-radius: 0.55rem; background: var(--bg); color: var(--ink-strong); font: inherit; }
  .error { margin: 0; color: var(--accent); font-size: 0.85rem; }
  button.ghost, button.primary { padding: 0.5rem 1rem; border-radius: 999px; font-weight: 800; font-size: 0.9rem; cursor: pointer; }
  button.ghost { border: 1px solid var(--line-soft); background: transparent; color: var(--ink-strong); }
  button.primary { border: none; background: var(--accent); color: white; }
  button.primary:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
