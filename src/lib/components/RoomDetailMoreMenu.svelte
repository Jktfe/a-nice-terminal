<!--
  RoomDetailMoreMenu — body of the RoomMenuDropdown for rooms/[roomId].
  Holds every CollapsibleSection that toggles between dropdown render
  (when NOT pinned) and pinned right-rail render (handled separately).
  Discipline-links nav stays in the parent route so the legacy source
  assertions in page.test.ts keep matching. Behaviour, DOM, and scoped
  styles are byte-equivalent to the inline original.
-->
<script lang="ts">
  import AttachmentsTray from './AttachmentsTray.svelte';
  import ArtefactsRoomPanel from './ArtefactsRoomPanel.svelte';
  import CollapsibleSection from './CollapsibleSection.svelte';
  import InteractiveAsksPanel from './InteractiveAsksPanel.svelte';
  import InterviewsRoomPanel from './InterviewsRoomPanel.svelte';
  import RoomDetailFocusPanel from './RoomDetailFocusPanel.svelte';
  import RoomDetailParticipantsBlock from './RoomDetailParticipantsBlock.svelte';
  import RoomLinksPanel from './RoomLinksPanel.svelte';
  import RoomMemoryLauncher from './RoomMemoryLauncher.svelte';
  import RoomPlansPanel from './RoomPlansPanel.svelte';
  import RoomTasksPanel from './RoomTasksPanel.svelte';
  import ScreenshotsRoomPanel from './ScreenshotsRoomPanel.svelte';
  import UploadFileButton from './UploadFileButton.svelte';
  import RoomRespondersPanel from './RoomRespondersPanel.svelte';
  import type { Ask } from '$lib/server/askStore';
  import type { RoomAliasEntry } from '$lib/server/chatRoomAliasStore';
  import type { ChatRoom, RoomMember } from '$lib/server/chatRoomStore';
  import type { SharedFile } from '$lib/server/chatAttachmentStore';
  import type { FocusEntry } from '$lib/server/focusModeStore';
  import type { TaskForRoom } from '$lib/server/taskStore';

  type SharedFileMetadata = Omit<SharedFile, 'contentsBase64'>;
  type RoomPlanLink = {
    planId: string;
    attachedAtMs: number;
    attachedBy: string | null;
    completion: {
      planId: string;
      title: string | null;
      total: number;
      completed: number;
      pct: number;
    };
  };

  type Props = {
    room: ChatRoom;
    aliasesInRoom: RoomAliasEntry[];
    focusedMembers: FocusEntry[];
    asksFromServer: Ask[];
    asksFetchFailed: boolean;
    plansForRoom: RoomPlanLink[];
    tasksForRoom: TaskForRoom[];
    sharedFilesFromServer: SharedFileMetadata[];
    callerHandle: string;
    pinnedSectionIds: Set<string>;
    labelForMember: (handle: string) => string;
    onMemberPicked: (member: RoomMember) => void;
    onInviteRequested: () => void;
    onAgentInvited: () => void;
    onOpenFocusModal: () => void;
    onOpenBreakModal: () => void;
    onOpenDigestPanel: () => void;
    responders?: {
      id: number;
      terminal_id: string;
      order_index: number;
      handle: string;
      pane_status: 'unknown' | 'verified' | 'stale';
    }[];
  };

  let {
    room,
    aliasesInRoom,
    focusedMembers,
    asksFromServer,
    asksFetchFailed,
    plansForRoom,
    tasksForRoom,
    sharedFilesFromServer,
    callerHandle,
    pinnedSectionIds,
    labelForMember,
    onMemberPicked,
    onInviteRequested,
    onAgentInvited,
    onOpenFocusModal,
    onOpenBreakModal,
    onOpenDigestPanel,
    responders = []
  }: Props = $props();
</script>

{#if !pinnedSectionIds.has('participants')}
<CollapsibleSection id="participants" title="Participants" count={room.members.length} pinRoomId={room.id}>
  <RoomDetailParticipantsBlock
    roomId={room.id}
    members={room.members}
    {aliasesInRoom}
    {focusedMembers}
    {onMemberPicked}
    {onInviteRequested}
    {onAgentInvited}
  />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('responders')}
<CollapsibleSection id="responders" title="Responders" count={responders.length} pinRoomId={room.id}>
  <RoomRespondersPanel
    roomId={room.id}
    members={room.members}
    {responders}
    callerHandle={callerHandle}
  />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('focus')}
<CollapsibleSection
  id="focus"
  title="Focus mode"
  count={focusedMembers.length}
  pinRoomId={room.id}
>
  <RoomDetailFocusPanel
    roomId={room.id}
    {focusedMembers}
    {labelForMember}
    {onOpenFocusModal}
  />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('asks')}
<CollapsibleSection
  id="asks"
  title="Open asks"
  count={asksFromServer.filter((a) => a.status === 'open').length}
  pinRoomId={room.id}
>
  <InteractiveAsksPanel
    {asksFromServer}
    {asksFetchFailed}
    actorHandle={callerHandle}
    roomNameLabel={room.name}
  />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('plans')}
<CollapsibleSection
  id="plans"
  title="Plans"
  count={plansForRoom.length}
  pinRoomId={room.id}
>
  <RoomPlansPanel plans={plansForRoom} />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('tasks')}
<CollapsibleSection
  id='tasks'
  title='Tasks'
  count={tasksForRoom.length}
  pinRoomId={room.id}
>
  <RoomTasksPanel tasks={tasksForRoom} />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('linked-rooms')}
<CollapsibleSection id="linked-rooms" title="Linked rooms" pinRoomId={room.id}>
  <RoomLinksPanel roomId={room.id} />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('interviews')}
<CollapsibleSection id="interviews" title="Interviews" pinRoomId={room.id}>
  <InterviewsRoomPanel
    roomId={room.id}
    members={room.members}
    asHandle={callerHandle}
  />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('artefacts')}
<CollapsibleSection id="artefacts" title="Artefacts" pinRoomId={room.id}>
  <ArtefactsRoomPanel roomId={room.id} />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('screenshots')}
<CollapsibleSection id="screenshots" title="Screenshots" pinRoomId={room.id}>
  <ScreenshotsRoomPanel roomId={room.id} />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('memory')}
<CollapsibleSection id="memory" title="Room memory" pinRoomId={room.id}>
  <RoomMemoryLauncher roomId={room.id} />
</CollapsibleSection>
{/if}

{#if !pinnedSectionIds.has('attachments')}
<CollapsibleSection id="attachments" title="Attachments" count={sharedFilesFromServer.length} pinRoomId={room.id}>
  <AttachmentsTray roomId={room.id} sharedFiles={sharedFilesFromServer} />
  <UploadFileButton roomId={room.id} />
</CollapsibleSection>
{/if}

<div class="room-menu-actions" aria-label="Room utilities">
  <button type="button" class="room-menu-action" onclick={onOpenBreakModal}>

    Context break
  </button>
  <button type="button" class="room-menu-action" onclick={onOpenDigestPanel}>
    <span aria-hidden="true">📊</span>
    Digest
  </button>
  <a class="room-menu-action" href={`/search?roomId=${room.id}`}>
    <span aria-hidden="true">⌕</span>
    Search this room
  </a>
</div>

<style>
  .room-menu-actions {
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--line-soft);
  }
  .room-menu-action {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-size: 0.86rem;
    font-weight: 800;
    text-decoration: none;
  }
  .room-menu-action:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
