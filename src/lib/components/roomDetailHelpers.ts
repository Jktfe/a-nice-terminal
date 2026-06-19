/*
 * roomDetailHelpers — small pure helpers + a focus-exit action used by the
 * rooms/[roomId] route + its RoomDetail* sub-components. Extracted from
 * +page.svelte so the route file stays under the 600-line component cap
 * with zero behaviour change.
 */
import { invalidateAll } from '$app/navigation';
import type { ChatRoom } from '$lib/server/chatRoomStore';
import type { FocusEntry } from '$lib/server/focusModeStore';

export function formatFocusWindow(entry: FocusEntry): string {
  if (entry.expiresAt === null) return 'Until pulled out';
  const expiryMs = new Date(entry.expiresAt).getTime();
  const remainingMinutes = Math.max(0, Math.ceil((expiryMs - Date.now()) / 60_000));
  if (remainingMinutes <= 1) return 'Ends in 1m';
  if (remainingMinutes < 60) return `Ends in ${remainingMinutes}m`;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes > 0 ? `Ends in ${hours}h ${minutes}m` : `Ends in ${hours}h`;
}

export function makeLabelForMember(room: ChatRoom): (handle: string) => string {
  return (handle: string) => {
    const member = room.members.find((candidate) => candidate.handle === handle);
    return member?.displayName ?? handle;
  };
}

export async function exitFocusForMember(roomId: string, memberHandle: string): Promise<boolean> {
  const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/focus-mode`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memberHandle })
  });
  if (response.ok) {
    await invalidateAll();
    return true;
  }
  const failure = await readFocusExitFailure(response);
  throw new Error(`Could not pull ${memberHandle} out of focus (HTTP ${response.status}): ${failure}`);
}

async function readFocusExitFailure(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.message === 'string' && body.message.trim().length > 0) {
      return body.message.trim();
    }
  } catch {
    /* fall through to statusText */
  }
  return response.statusText || 'Focus update failed.';
}

/**
 * D1.6-T1b reshape: invite is NESTED inside Participants section, which
 * lives inside the RoomMenuDropdown. Force-open all 3 levels before
 * scroll+focus so the input is in the layout tree.
 */
export function focusInviteForm(): void {
  const menuDetails = document.getElementById('room-menu') as HTMLDetailsElement | null;
  if (menuDetails) menuDetails.open = true;
  const participantsDetails = document.getElementById('participants') as HTMLDetailsElement | null;
  if (participantsDetails) participantsDetails.open = true;
  const inviteSection = document.getElementById('inviteAgentSection') as HTMLDetailsElement | null;
  if (inviteSection) inviteSection.open = true;
  inviteSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const handleField = document.getElementById('agentHandleField') as HTMLInputElement | null;
  setTimeout(() => handleField?.focus(), 300);
}

export const LEFT_PANE_KEY = 'ant.rooms.leftPaneCollapsed';
export const RIGHT_PANE_KEY = 'ant.rooms.rightPaneCollapsed';

/**
 * Per-device localStorage flag reader. Returns false on private-mode /
 * sandbox where localStorage throws.
 */
export function readPaneCollapsedFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function writePaneCollapsedFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private-mode safe */
  }
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}
