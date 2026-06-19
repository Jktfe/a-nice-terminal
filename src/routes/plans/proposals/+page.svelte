<!--
  /plans/proposals — M-ProposalTracks surface.

  Surfaces evidence refs of kind 'proposal' as Proposal Tracks.
  Each track shows: label, external URL, attribution (task owner/agent),
  and an 'Adopt' button that creates a plan_decision event.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import { safeUrlForTrackerLink } from '$lib/chat/trackerRefs';
  import { resolvePreferredProvider, type TTSProvider } from '$lib/voice/interview-tts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let adopting = $state<string | null>(null);
  let notice = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
  let playing = $state<string | null>(null);
  let ttsProvider: TTSProvider | null = null;

  async function playNarration(taskId: string, narration: string) {
    if (!ttsProvider) {
      ttsProvider = await resolvePreferredProvider();
    }
    if (!ttsProvider.available()) {
      notice = { kind: 'err', text: 'TTS not available.' };
      return;
    }
    playing = taskId;
    const handle = ttsProvider.speak(narration);
    handle.onEnd = () => { playing = null; };
    handle.onStart = () => { playing = taskId; };
  }

  async function responseMessage(response: Response, fallback: string): Promise<string> {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    return message ? `${fallback} (${response.status}): ${message}` : `${fallback} (${response.status}).`;
  }

  async function adopt(proposal: { taskId: string; planId: string | null; ref: string; label: string | null }) {
    if (!proposal.planId) {
      notice = { kind: 'err', text: 'Cannot adopt: proposal is not attached to a plan.' };
      return;
    }
    adopting = proposal.taskId;
    notice = null;
    try {
      const res = await fetch('/api/plans/proposals/adopt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planId: proposal.planId,
          taskId: proposal.taskId,
          ref: proposal.ref,
          label: proposal.label
        })
      });
      if (!res.ok) {
        notice = { kind: 'err', text: await responseMessage(res, 'Adopt failed') };
        return;
      }
      notice = { kind: 'ok', text: `Adopted "${proposal.label ?? 'proposal'}". Decision recorded.` };
    } catch (cause) {
      notice = { kind: 'err', text: cause instanceof Error ? cause.message : 'Adopt failed.' };
    } finally {
      adopting = null;
    }
  }
</script>

<svelte:head>
  <title>Proposal Tracks | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow="Plans"
  title="Proposal Tracks"
  summary="Version-B alternatives prepared by agents. Each track links to an external artefact. Click Adopt to record a decision."
>
  <nav class="proposals-subnav" aria-label="Plan secondary nav">
    <a class="subnav-link" href="/plans">← All plans</a>
    <a class="subnav-link" href="/plans/evidence">Evidence →</a>
  </nav>

  {#if notice}
    <p class={notice.kind === 'ok' ? 'notice-ok' : 'notice-err'} role="status">
      {notice.text}
    </p>
  {/if}

  {#if data.proposalsFetchFailed}
    <p class="notice-err" role="alert">
      Could not load Proposal Tracks. {data.proposalsFetchMessage}
    </p>
  {/if}

  {#if data.proposals.length === 0 && !data.proposalsFetchFailed}
    <p class="empty">
      No Proposal Tracks yet. Agents create them by attaching evidence of kind
      <code>proposal</code> to a task.
    </p>
  {:else}
    <ul class="proposal-list">
      {#each data.proposals as p}
        <li class="proposal-row">
          <div class="proposal-meta">
            <span class="proposal-kind">P</span>
            <span class="proposal-label">{p.label ?? 'Untitled proposal'}</span>
          </div>
          {#if safeUrlForTrackerLink(p.ref)}
            <a class="proposal-ref" href={safeUrlForTrackerLink(p.ref) ?? ''} target="_blank" rel="noopener noreferrer">
              {p.ref}
            </a>
          {:else}
            <span class="proposal-ref unsafe-ref" title="Not a safe URL">{p.ref}</span>
          {/if}
          <div class="proposal-attribution">
            From task <strong>{p.taskSubject}</strong>
            {#if p.planTitle}
              in plan <strong>{p.planTitle}</strong>
            {/if}
          </div>
          {#if p.narration}
            <button
              class="play-btn"
              disabled={playing === p.taskId}
              onclick={() => playNarration(p.taskId, p.narration ?? '')}
            >
              {playing === p.taskId ? '▶ Playing…' : '▶ Play narration'}
            </button>
          {/if}
          <button
            class="adopt-btn"
            disabled={adopting === p.taskId || !p.planId}
            onclick={() => adopt(p)}
          >
            {adopting === p.taskId ? 'Adopting…' : 'Adopt'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</SimplePageShell>

<style>
  .proposals-subnav {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .subnav-link {
    font-size: 0.875rem;
    color: var(--ink-muted);
  }
  .subnav-link:hover {
    color: var(--ink-strong);
  }
  .notice-ok, .notice-err {
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }
  .notice-ok {
    background: rgba(34, 197, 94, 0.1);
    color: #166534;
  }
  .notice-err {
    background: rgba(239, 68, 68, 0.1);
    color: #991b1b;
  }
  .empty {
    color: var(--ink-muted);
    font-size: 0.875rem;
  }
  .proposal-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .proposal-row {
    border: 1px solid var(--border-subtle);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .proposal-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .proposal-kind {
    width: 1.5rem;
    height: 1.5rem;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .proposal-label {
    font-weight: 600;
    font-size: 0.9375rem;
  }
  .proposal-ref {
    font-size: 0.8125rem;
    color: var(--ink-muted);
    word-break: break-all;
  }
  .proposal-ref:hover {
    color: var(--ink-strong);
  }
  .proposal-ref.unsafe-ref:hover {
    color: var(--ink-muted);
  }
  .proposal-attribution {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .play-btn, .adopt-btn {
    align-self: flex-start;
    margin-top: 0.25rem;
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    border: 1px solid var(--border-subtle);
    background: var(--surface-1);
    border-radius: 0.375rem;
    cursor: pointer;
  }
  .play-btn {
    background: rgba(59, 130, 246, 0.1);
    border-color: rgba(59, 130, 246, 0.3);
    color: #1d4ed8;
  }
  .play-btn:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.2);
  }
  .adopt-btn:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .play-btn:disabled, .adopt-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
