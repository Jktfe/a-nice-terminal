<!--
  RoomDetailParticipantsBlock — shared ParticipantsPanel + nested
  Invite-an-agent <details> body. Extracted from rooms/[roomId]/+page.svelte
  so the identical block can render in BOTH the More-dropdown and the
  pinned right-rail without text duplication. Behaviour, DOM, and scoped
  styles are byte-equivalent to the inline original.
-->
<script lang="ts">
  import InviteAgentForm from './InviteAgentForm.svelte';
  import InviteTeamMemberForm from './InviteTeamMemberForm.svelte';
  import ParticipantsPanel from './ParticipantsPanel.svelte';
  import type { RoomMember } from '$lib/server/chatRoomStore';
  import type { RoomAliasEntry } from '$lib/server/chatRoomAliasStore';
  import type { FocusEntry } from '$lib/server/focusModeStore';

  type Props = {
    roomId: string;
    members: RoomMember[];
    aliasesInRoom: RoomAliasEntry[];
    focusedMembers: FocusEntry[];
    onMemberPicked: (member: RoomMember) => void;
    onInviteRequested: () => void;
    onAgentInvited: () => void;
  };

  let {
    roomId,
    members,
    aliasesInRoom,
    focusedMembers,
    onMemberPicked,
    onInviteRequested,
    onAgentInvited
  }: Props = $props();
</script>

<ParticipantsPanel
  {roomId}
  {members}
  {aliasesInRoom}
  {focusedMembers}
  {onMemberPicked}
  {onInviteRequested}
/>
<details class="nested-invite-toggle">
  <summary class="nested-invite-summary">
    <span class="nested-invite-label">Invite team member</span>
    <span class="nested-invite-chevron" aria-hidden="true">▾</span>
  </summary>
  <div class="nested-invite-body">
    <InviteTeamMemberForm
      {roomId}
      existingMemberHandles={members.map((m) => m.handle)}
      onMemberInvited={() => onAgentInvited()}
    />
  </div>
</details>
<details id="inviteAgentSection" class="nested-invite-toggle">
  <summary class="nested-invite-summary">
    <span class="nested-invite-label">Invite an agent</span>
    <span class="nested-invite-chevron" aria-hidden="true">▾</span>
  </summary>
  <div class="nested-invite-body">
    <InviteAgentForm
      {roomId}
      {onAgentInvited}
      existingMemberHandles={members.map((m) => m.handle)}
    />
  </div>
</details>

<style>
  /* JWPK msg_5lfbp31u6t: invite form inside Participants is a collapsed
     <details> by default (was always-open). Click 'Invite an agent ▾' to
     expand. Same in both the dropdown render and the rail-card render. */
  .nested-invite-toggle {
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--line-soft);
  }
  .nested-invite-summary {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
    list-style: none;
    color: var(--ink-strong);
    font-weight: 800;
    font-size: 0.92rem;
  }
  .nested-invite-summary::-webkit-details-marker { display: none; }
  .nested-invite-label { flex: 1; }
  .nested-invite-chevron {
    color: var(--ink-soft);
    transition: transform 180ms ease;
  }
  .nested-invite-toggle[open] .nested-invite-chevron {
    transform: rotate(180deg);
  }
  .nested-invite-body { margin-top: 0.6rem; }
</style>
