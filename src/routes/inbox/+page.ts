/**
 * /inbox loader — the global held-ask + owner-notification surface
 * (JWPK taste rulings, ANT sorted 2026-06-10: inbox not room-noise;
 * asks visible globally AND in their origin room; approve typeable in
 * chat — the page surfaces, the chat actuates).
 */

import type { PageLoad } from './$types';

export type HeldAskView = {
  requestId: string;
  requesterHandle: string;
  action: string;
  targetKind: string;
  targetId: string;
  createdAtMs: number;
  approvers: { handle: string; role: string; preferred: boolean }[];
  approveCommand: string;
};

export type OwnerNotificationView = {
  atMs: number;
  handle: string | null;
  reason: string | null;
  owners: string[];
  pane: string | null;
};

export const load: PageLoad = async ({ fetch }) => {
  const response = await fetch('/api/inbox').catch(() => null);
  if (!response || !response.ok) {
    return {
      heldAsks: [] as HeldAskView[],
      ownerNotifications: [] as OwnerNotificationView[],
      fetchFailed: true,
      unauthorised: response?.status === 401
    };
  }
  const body = (await response.json()) as {
    heldAsks: HeldAskView[];
    ownerNotifications: OwnerNotificationView[];
  };
  return {
    heldAsks: body.heldAsks ?? [],
    ownerNotifications: body.ownerNotifications ?? [],
    fetchFailed: false,
    unauthorised: false
  };
};
