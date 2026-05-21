<!--
  RoomDetailMemberSheet — Participant-detail orchestration extracted from
  rooms/[roomId]/+page.svelte. Owns the per-sheet mode toggle, the
  RemoveMemberFlow confirm step, and the change-handle / presentation
  alternate-body snippets. Parent retains the trigger (detailSheetMember)
  + the alias-applied banner so the existing route-level UX stays intact.
-->
<script lang="ts">
  import ChangeHandleForm from './ChangeHandleForm.svelte';
  import ParticipantDetailSheet from './ParticipantDetailSheet.svelte';
  import ParticipantPresentationForm from './ParticipantPresentationForm.svelte';
  import RemoveMemberFlow from './RemoveMemberFlow.svelte';
  import type { RoomMember } from '$lib/server/chatRoomStore';
  import type { RoomAliasEntry } from '$lib/server/chatRoomAliasStore';

  type DetailSheetMode = 'actions' | 'changeHandle' | 'presentation';
  type SheetAction =
    | 'change-handle'
    | 'edit-presentation'
    | 'view-activity'
    | 'set-focus'
    | 'remove'
    | 'close';

  type Props = {
    roomId: string;
    member: RoomMember | null;
    aliasesInRoom: RoomAliasEntry[];
    onClose: () => void;
    onAliasApplied: (savedAlias: string, member: RoomMember) => void;
    onMemberRemoved: () => void;
    onPresentationSaved: () => void;
    onSetFocus: (memberHandle: string) => void;
  };

  let {
    roomId,
    member,
    aliasesInRoom,
    onClose,
    onAliasApplied,
    onMemberRemoved,
    onPresentationSaved,
    onSetFocus
  }: Props = $props();

  let detailSheetMode = $state<DetailSheetMode>('actions');
  let memberPendingRemoval = $state<RoomMember | null>(null);

  // Reset mode whenever the sheet is closed (member -> null) so re-opening
  // a member always lands on the action list. Tracking only the truthy
  // transition avoids resetting on the very first render.
  let lastMemberKey = $state<string | null>(null);
  $effect(() => {
    const key = member?.handle ?? null;
    if (key !== lastMemberKey) {
      lastMemberKey = key;
      detailSheetMode = 'actions';
    }
  });

  function findAliasForMember(globalHandle: string): string | undefined {
    return aliasesInRoom.find((entry) => entry.globalHandle === globalHandle)?.alias;
  }

  function handleSheetAction(action: SheetAction): void {
    if (action === 'change-handle') {
      detailSheetMode = 'changeHandle';
      return;
    }
    if (action === 'edit-presentation') {
      detailSheetMode = 'presentation';
      return;
    }
    if (action === 'set-focus') {
      if (member) onSetFocus(member.handle);
      onClose();
      return;
    }
    if (action === 'close') {
      onClose();
      return;
    }
    if (action === 'remove') {
      memberPendingRemoval = member;
      onClose();
    }
  }

  function handleAliasAppliedInternal(savedAlias: string): void {
    if (!member) return;
    onAliasApplied(savedAlias, member);
  }

  function handlePresentationSaved(): void {
    onClose();
    onPresentationSaved();
  }

  function handleChangeHandleCancel(): void {
    detailSheetMode = 'actions';
  }

  function handleMemberRemovedInternal(): void {
    memberPendingRemoval = null;
    onMemberRemoved();
  }
</script>

<RemoveMemberFlow
  {roomId}
  {memberPendingRemoval}
  onRemoved={handleMemberRemovedInternal}
  onCancelled={() => (memberPendingRemoval = null)}
/>

{#if member}
  {@const memberForSheet = member}

  {#snippet changeHandleBody()}
    <ChangeHandleForm
      {roomId}
      globalHandle={memberForSheet.handle}
      currentAlias={findAliasForMember(memberForSheet.handle)}
      onAliasApplied={handleAliasAppliedInternal}
      onCancel={handleChangeHandleCancel}
    />
  {/snippet}

  {#snippet presentationBody()}
    <ParticipantPresentationForm
      {roomId}
      member={memberForSheet}
      onSaved={handlePresentationSaved}
      onCancel={handleChangeHandleCancel}
    />
  {/snippet}

  <ParticipantDetailSheet
    member={memberForSheet}
    aliasInRoom={findAliasForMember(memberForSheet.handle)}
    onAction={handleSheetAction}
    {onClose}
    alternateBody={detailSheetMode === 'changeHandle'
      ? changeHandleBody
      : detailSheetMode === 'presentation'
        ? presentationBody
        : undefined}
  />
{/if}
