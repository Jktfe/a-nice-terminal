<script lang="ts">
  import { onMount } from 'svelte';

  type OrgMember = {
    userId: string;
    email: string;
    displayName: string;
    handle: string;
    role: 'owner' | 'admin' | 'member';
    tier?: string;
    inRoom?: boolean;
  };

  type Props = {
    roomId: string;
    existingMemberHandles?: string[];
    onMemberInvited?: (handle: string) => void;
  };

  let { roomId, existingMemberHandles = [], onMemberInvited }: Props = $props();

  let members = $state<OrgMember[]>([]);
  let loading = $state(true);
  let errorMessage = $state('');
  let invitingHandle = $state<string | null>(null);
  let invitedHandle = $state<string | null>(null);

  const existingHandles = $derived(
    new Set(existingMemberHandles.map((handle) => handle.toLowerCase()))
  );
  const inviteCandidates = $derived(
    members.filter((member) => !member.inRoom && !existingHandles.has(member.handle.toLowerCase()))
  );

  async function loadMembers(): Promise<void> {
    loading = true;
    errorMessage = '';
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/members`);
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? `Could not load team members (${response.status}).`);
      }
      const body = (await response.json()) as { members?: OrgMember[] };
      members = body.members ?? [];
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Could not load team members.';
    } finally {
      loading = false;
    }
  }

  async function inviteMember(handle: string): Promise<void> {
    if (invitingHandle) return;
    invitingHandle = handle;
    errorMessage = '';
    invitedHandle = null;
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? `Could not invite ${handle}.`);
      }
      invitedHandle = handle;
      members = members.map((member) =>
        member.handle.toLowerCase() === handle.toLowerCase()
          ? { ...member, inRoom: true }
          : member
      );
      onMemberInvited?.(handle);
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Could not invite team member.';
    } finally {
      invitingHandle = null;
    }
  }

  onMount(() => {
    void loadMembers();
  });
</script>

<section class="team-member-invite" aria-labelledby="inviteTeamMemberHeading">
  <div class="invite-heading">
    <h3 id="inviteTeamMemberHeading">Invite team member</h3>
    <button type="button" class="refresh" onclick={loadMembers} disabled={loading}>Refresh</button>
  </div>

  {#if errorMessage}
    <p class="error-message" role="alert">{errorMessage}</p>
  {/if}

  {#if invitedHandle}
    <p class="success-message" role="status">{invitedHandle} joined this room.</p>
  {/if}

  {#if loading}
    <p class="muted">Loading team members...</p>
  {:else if inviteCandidates.length === 0}
    <p class="muted">Every available team member is already in this room.</p>
  {:else}
    <ul class="team-member-list" aria-label="Team members available to invite">
      {#each inviteCandidates as member (member.handle)}
        <li>
          <span class="member-copy">
            <strong>{member.displayName}</strong>
            <span>{member.handle} · {member.email}</span>
          </span>
          <button
            type="button"
            onclick={() => inviteMember(member.handle)}
            disabled={invitingHandle !== null}
          >
            {invitingHandle === member.handle ? 'Adding...' : 'Add'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .team-member-invite {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 1rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 0.75rem;
  }
  .invite-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  h3 {
    margin: 0;
    color: var(--ink-strong);
    font-size: 0.95rem;
    font-weight: 850;
  }
  .refresh,
  li button {
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 800;
    padding: 0.35rem 0.75rem;
  }
  .refresh:disabled,
  li button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .muted,
  .success-message,
  .error-message {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.86rem;
    line-height: 1.4;
  }
  .success-message { color: var(--ok); }
  .error-message { color: var(--accent); }
  .team-member-list {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--bg);
  }
  .member-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
  }
  .member-copy strong {
    color: var(--ink-strong);
    font-size: 0.9rem;
  }
  .member-copy span {
    color: var(--ink-soft);
    font-size: 0.78rem;
    overflow-wrap: anywhere;
  }
</style>
