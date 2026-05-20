<!--
  MemoryHitCard — pure render of one recall hit, branched on hit.kind.
  Backs memory-recall slice 6 (paired endpoint + UI with the new ask kind).

  PURE RENDER + CALLBACK-FREE. No fetch, no invalidateAll, no store or
  endpoint imports. Props are hit + roomNameByRoomId; the parent /memory
  page owns SSR-derived data, states, form, list mount, and key generation.
  This card just renders one row of the hit list.

  Audit-note on copied logic:
  Copied-from src/routes/memory/+page.svelte (memory-recall slice 4 baseline,
  lines 41-72 + per-kind {#each} branches and CSS rules)
  Verdict: KEEP — identical render logic, lifted verbatim so the page slims
  to ~145L without breaking the accepted slice 4 visual contract. The slice
  6 boundary explicitly approved this audit-note + KEEP pattern.

  Slice 6 additions (not in /memory baseline):
  - "ask" branch shows kind-badge "Ask", opener handle, title bold,
    body preview, occurredAt. Discovery-only — NO answer/dismiss controls
    here (the /asks page owns ask resolution).
  - stableKeyFor lives on the parent page (key generation is the #each
    owner's responsibility, not the card's).

  Per @evolveantcodex slice 6 guardrails:
    - Pure render. No state, no callbacks, no side effects.
    - Room links resolve via roomNameByRoomId, fall back to roomId so
      the link is always safe.
    - File hits carry metadata only (the recall layer strips bytes
      structurally so the field is structurally absent anyway).
    - Ask hits are discovery-only — no answer/dismiss surface.
-->
<script lang="ts">
  import type { RecallHitIncludingAsks } from '$lib/server/memoryRecallStore';

  type Props = {
    hit: RecallHitIncludingAsks;
    roomNameByRoomId: Record<string, string>;
  };

  let { hit, roomNameByRoomId }: Props = $props();

  function resolveRoomNameSafely(roomId: string): string {
    return roomNameByRoomId[roomId] ?? roomId;
  }

  function describeOccurredAt(occurredAtMillis: number): string {
    if (!Number.isFinite(occurredAtMillis) || occurredAtMillis <= 0) return '';
    const moment = new Date(occurredAtMillis);
    if (Number.isNaN(moment.getTime())) return '';
    return moment.toLocaleString();
  }

  function previewBody(body: string): string {
    const oneLine = body.replace(/\s+/g, ' ').trim();
    if (oneLine.length <= 220) return oneLine;
    return oneLine.slice(0, 217) + '…';
  }

  // Copied-from src/lib/components/AttachmentsTray.svelte (M11 UI slice 2)
  // Verdict: KEEP — same byte formatting per file hit; kept inline so the
  // card does not import another Svelte component just for one helper.
  function describeByteSize(byteSize: number): string {
    if (byteSize < 1024) return `${byteSize} B`;
    if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
    return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<article class="hit-card">
  {#if hit.kind === 'message'}
    <div class="hit-header">
      <a class="room-link" href="/rooms/{hit.messageHit.roomId}">{hit.messageHit.roomName}</a>
      <span class="kind-badge">Message</span>
      <span class="author">{hit.messageHit.message.authorDisplayName}</span>
      <span class="occurred-time">{describeOccurredAt(hit.occurredAtMillis)}</span>
    </div>
    <p class="hit-body">{previewBody(hit.messageHit.message.body)}</p>
  {:else if hit.kind === 'note'}
    <div class="hit-header">
      <a class="room-link" href="/rooms/{hit.noteHit.roomId}">{resolveRoomNameSafely(hit.noteHit.roomId)}</a>
      <span class="kind-badge kind-note">Chair note</span>
      <span class="occurred-time">{describeOccurredAt(hit.occurredAtMillis)}</span>
    </div>
    <p class="hit-body">{previewBody(hit.noteHit.noteText)}</p>
  {:else if hit.kind === 'agentEvent'}
    <div class="hit-header">
      <a class="room-link" href="/rooms/{hit.roomId}">{resolveRoomNameSafely(hit.roomId)}</a>
      <span class="kind-badge kind-event">Agent activity</span>
      <span class="event-kind">{hit.eventHit.kind}</span>
      <span class="author">{hit.eventHit.authorDisplayName}</span>
      <span class="occurred-time">{describeOccurredAt(hit.occurredAtMillis)}</span>
    </div>
    <p class="hit-body">{previewBody(hit.eventHit.summary)}</p>
  {:else if hit.kind === 'file'}
    <div class="hit-header">
      <a class="room-link" href="/rooms/{hit.roomId}">{resolveRoomNameSafely(hit.roomId)}</a>
      <span class="kind-badge kind-file">Shared file</span>
      <span class="author">{hit.fileHit.uploadedByHandle}</span>
      <span class="byte-size">{describeByteSize(hit.fileHit.byteSize)}</span>
      <span class="occurred-time">{describeOccurredAt(hit.occurredAtMillis)}</span>
    </div>
    <p class="hit-body">{hit.fileHit.filename}</p>
  {:else}
    <div class="hit-header">
      <a class="room-link" href="/rooms/{hit.roomId}">{resolveRoomNameSafely(hit.roomId)}</a>
      <span class="kind-badge kind-ask">Ask</span>
      <span class="author">{hit.askHit.openedByDisplayName}</span>
      <span class="occurred-time">{describeOccurredAt(hit.occurredAtMillis)}</span>
    </div>
    <p class="ask-title-line"><strong>{hit.askHit.title}</strong></p>
    <p class="hit-body">{previewBody(hit.askHit.body)}</p>
  {/if}
</article>

<style>
  .hit-card {
    padding: 0.85rem 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.65rem;
    background: var(--surface);
  }
  .hit-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.55rem;
    margin-bottom: 0.35rem;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }
  .room-link { font-weight: 700; color: var(--accent); text-decoration: none; }
  .room-link:hover { text-decoration: underline; }
  .kind-badge {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: var(--bg);
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    padding: 0 0.5rem;
    color: var(--ink-soft);
  }
  .kind-badge.kind-note,
  .kind-badge.kind-event,
  .kind-badge.kind-file,
  .kind-badge.kind-ask { color: var(--accent); border-color: var(--accent); }
  .author { font-weight: 600; color: var(--ink); }
  .event-kind { font-size: 0.75rem; color: var(--ink-soft); font-style: italic; }
  .byte-size { font-size: 0.75rem; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
  .occurred-time { margin-left: auto; font-variant-numeric: tabular-nums; }
  .hit-body { margin: 0; line-height: 1.45; color: var(--ink-strong); }
  .ask-title-line { margin: 0 0 0.25rem; color: var(--ink-strong); }
</style>
