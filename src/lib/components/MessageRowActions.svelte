<!--
  MessageRowActions — bottom-right action strip on a chat message row.
  Composes the agent-only ClaimActionBar (look/work/pass pills) and the
  always-rendered MessageReactionsBar. Extracted from MessageRow.svelte
  2026-05-21 to keep the parent under the 600-line component cap;
  behaviour preserved verbatim — same wrapper class, same positioning,
  same gating.
-->
<script lang="ts">
  import type { EntityClaim } from '$lib/server/entityClaimStore';
  import MessageReactionsBar from './MessageReactionsBar.svelte';
  import ClaimActionBar from './ClaimActionBar.svelte';

  type Props = {
    roomId: string;
    messageId: string;
    viewerIsAgent: boolean;
    claims: EntityClaim[];
    asHandle?: string;
    onClaimChanged?: () => void;
  };

  let {
    roomId,
    messageId,
    viewerIsAgent,
    claims,
    asHandle,
    onClaimChanged
  }: Props = $props();
</script>

<!-- JWPK msg_np3zwn7w60 + ux msg_vqj1js81zt: the 🖐️/🤝/👐 action
     pills are AGENT-only coordination signals — humans don't claim
     via the web UI. Gate the ClaimActionBar on a viewer-is-agent
     check derived from the room roster in MessageList, so aliases and
     new agent handle families do not need component changes.
     Humans see only the ClaimChip in the header. -->
<div class="row-action-strip">
  {#if viewerIsAgent}
    <ClaimActionBar
      {roomId}
      {messageId}
      asHandle={asHandle ?? '@you'}
      {claims}
      {onClaimChanged}
    />
  {/if}
  <MessageReactionsBar
    {roomId}
    {messageId}
    {asHandle}
  />
</div>

<style>
  /* JWPK M6 UI slice 2: claim action bar + reactions bar share a row at
     the bottom-right of each message. Both surfaces are inline + small
     so they don't fight the message body for vertical space. */
  .row-action-strip {
    position: absolute;
    bottom: 0.3rem;
    right: 0.6rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    z-index: 2;
  }
</style>
