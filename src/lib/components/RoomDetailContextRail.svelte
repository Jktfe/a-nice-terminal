<!--
  RoomDetailContextRail — pinned right-rail for rooms/[roomId]. Each
  CollapsibleSection inside renders ONLY when its id is pinned via the
  roomSidePanelPins store; mutual-exclusion with RoomDetailMoreMenu
  ensures every panel mounts exactly once. Behaviour, DOM, and scoped
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
    rightPaneCollapsed: boolean;
    labelForMember: (handle: string) => string;
    onMemberPicked: (member: RoomMember) => void;
    onInviteRequested: () => void;
    onAgentInvited: () => void;
    onOpenFocusModal: () => void;
    onToggleRightPane: () => void;
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
    rightPaneCollapsed,
    labelForMember,
    onMemberPicked,
    onInviteRequested,
    onAgentInvited,
    onOpenFocusModal,
    onToggleRightPane
  }: Props = $props();
</script>

<aside class="room-context-rail" class:collapsed={rightPaneCollapsed} aria-label="Pinned room context">
  <button
    type="button"
    class="pane-toggle pane-toggle-right"
    aria-label={rightPaneCollapsed ? 'Expand right pane (press ])' : 'Collapse right pane (press ])'}
    aria-expanded={!rightPaneCollapsed}
    title={rightPaneCollapsed ? 'Expand · ]' : 'Collapse · ]'}
    onclick={onToggleRightPane}
  >
    <svg viewBox="0 0 12 24" aria-hidden="true">
      {#if rightPaneCollapsed}
        <path d="M9 4 L3 12 L9 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      {:else}
        <path d="M3 4 L9 12 L3 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      {/if}
    </svg>
  </button>
  {#if rightPaneCollapsed}<div class="rail-collapsed-spacer" aria-hidden="true"></div>{:else}
  <h2 class="rail-heading">Pinned</h2>
  {#if pinnedSectionIds.size === 0}
    <p class="rail-empty">
      Pin a section from the <strong>More ▾</strong> menu (📌 button in each section header)
      to keep it here as an expand/contract card.
    </p>
  {:else}
    <!-- JWPK msg_8j3yzijma0: pinned sections in the rail render as
         their own expand/contract collapsible cards (NOT jump-to-
         dropdown, NOT always-expanded inline). Each card is the
         SAME CollapsibleSection component as the dropdown counterpart
         — collapsed by default, lazy-mounts its panel on first
         expand. Mutual exclusion: each section renders EITHER in
         dropdown (when !pinned) OR here (when pinned), never both.
         Single mount per section regardless of pinned-state, no
         double-fetch. -->
    {#if pinnedSectionIds.has('participants')}
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
    {#if pinnedSectionIds.has('focus')}
      <CollapsibleSection id="focus" title="Focus mode" count={focusedMembers.length} pinRoomId={room.id}>
        <RoomDetailFocusPanel
          roomId={room.id}
          {focusedMembers}
          {labelForMember}
          {onOpenFocusModal}
        />
      </CollapsibleSection>
    {/if}
    {#if pinnedSectionIds.has('asks')}
      <CollapsibleSection id="asks" title="Open asks" count={asksFromServer.filter((a) => a.status === 'open').length} pinRoomId={room.id}>
        <InteractiveAsksPanel
          {asksFromServer}
          {asksFetchFailed}
          roomNameLabel={room.name}
        />
      </CollapsibleSection>
    {/if}
    {#if pinnedSectionIds.has('plans')}
      <CollapsibleSection id="plans" title="Plans" count={plansForRoom.length} pinRoomId={room.id}>
        <RoomPlansPanel plans={plansForRoom} />
      </CollapsibleSection>
    {/if}
    {#if pinnedSectionIds.has('tasks')}
      <CollapsibleSection id="tasks" title="Tasks" count={tasksForRoom.length} pinRoomId={room.id}>
        <RoomTasksPanel tasks={tasksForRoom} />
      </CollapsibleSection>
    {/if}
    {#if pinnedSectionIds.has('linked-rooms')}
      <CollapsibleSection id="linked-rooms" title="Linked rooms" pinRoomId={room.id}>
        <RoomLinksPanel roomId={room.id} />
      </CollapsibleSection>
    {/if}
    {#if pinnedSectionIds.has('interviews')}
      <CollapsibleSection id="interviews" title="Interviews" pinRoomId={room.id}>
        <InterviewsRoomPanel
          roomId={room.id}
          members={room.members}
          asHandle={callerHandle}
        />
      </CollapsibleSection>
    {/if}
    {#if pinnedSectionIds.has('artefacts')}
      <CollapsibleSection id="artefacts" title="Artefacts" pinRoomId={room.id}>
        <ArtefactsRoomPanel roomId={room.id} />
      </CollapsibleSection>
    {/if}
    {#if pinnedSectionIds.has('screenshots')}
      <CollapsibleSection id="screenshots" title="Screenshots" pinRoomId={room.id}>
        <ScreenshotsRoomPanel roomId={room.id} />
      </CollapsibleSection>
    {/if}
    {#if pinnedSectionIds.has('memory')}
      <CollapsibleSection id="memory" title="Room memory" pinRoomId={room.id}>
        <RoomMemoryLauncher roomId={room.id} />
      </CollapsibleSection>
    {/if}
    {#if pinnedSectionIds.has('attachments')}
      <CollapsibleSection id="attachments" title="Attachments" count={sharedFilesFromServer.length} pinRoomId={room.id}>
        <AttachmentsTray roomId={room.id} sharedFiles={sharedFilesFromServer} />
        <UploadFileButton roomId={room.id} />
      </CollapsibleSection>
    {/if}
  {/if}
  {/if}
</aside>

<style>
  /* Right rail — pinned-section quicklinks. Phase A: jump-to-section
     buttons that open the corresponding CollapsibleSection inside the
     More dropdown + scroll into view. Phase B will promote the SECTION
     CONTENT inline here via the snippet pattern (msg_woy8tl2km1). */
  .room-context-rail {
    position: sticky;
    top: 4.5rem;
    align-self: start;
    max-height: calc(100vh - 6rem);
    overflow-y: auto;
    padding: 0.85rem 0.9rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.95rem;
    background: var(--surface-card);
    display: none;
  }
  @media (min-width: 1240px) {
    .room-context-rail { display: block; }
  }
  .room-context-rail.collapsed {
    padding: 0.55rem 0.2rem;
    overflow: hidden;
  }
  .rail-collapsed-spacer {
    /* keeps the collapsed rail height balanced with the chat column */
    min-height: 6rem;
  }
  .rail-heading {
    margin: 0 0 0.6rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    font-weight: 800;
  }
  .rail-empty {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .rail-empty strong {
    color: var(--ink-strong);
    font-weight: 700;
  }
  @media (max-width: 1239px) {
    /* Below the 3-col breakpoint the panes stack — hide collapse UX. */
    .pane-toggle { display: none; }
  }
  .pane-toggle {
    align-self: flex-end;
    width: 1.4rem;
    height: 2.2rem;
    padding: 0;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    color: var(--ink-soft);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 120ms ease, color 120ms ease;
  }
  .pane-toggle:hover {
    background: color-mix(in srgb, var(--accent, #6b21a8) 8%, var(--surface-card));
    color: var(--ink-strong);
  }
  .pane-toggle svg {
    width: 0.7rem;
    height: 1.2rem;
    display: block;
  }
  .pane-toggle-right {
    /* The right rail's toggle sits at the top-left edge so it remains
       hand-reachable when the rail is collapsed to a thin strip. */
    position: absolute;
    top: 0.55rem;
    left: -0.7rem;
    z-index: 1;
  }
</style>
