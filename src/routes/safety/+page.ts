import type { PageLoad } from './$types';

export type RecoveryRoom = {
  id: string;
  name: string;
  archivedAtMs: number | null;
  deletedAtMs: number | null;
  restorable: boolean;
  deleteBoundary?: string;
};

export type RecoveryPlan = {
  planId: string;
  title?: string | null;
  total: number;
  completed: number;
};

export const load: PageLoad = async ({ fetch }) => {
  const [roomsResponse, archivedPlansResponse, deletedPlansResponse] = await Promise.all([
    fetch('/api/chat-rooms/recovery').catch(() => null),
    fetch('/api/plans/completions?archived=1').catch(() => null),
    fetch('/api/plans/completions?deleted=1').catch(() => null)
  ]);
  const rooms = roomsResponse?.ok
    ? ((await roomsResponse.json()) as { archivedRooms: RecoveryRoom[]; deletedRooms: RecoveryRoom[] })
    : { archivedRooms: [] as RecoveryRoom[], deletedRooms: [] as RecoveryRoom[] };
  const archivedPlans = archivedPlansResponse?.ok
    ? ((await archivedPlansResponse.json()) as { plans: RecoveryPlan[] }).plans ?? []
    : [];
  const deletedPlans = deletedPlansResponse?.ok
    ? ((await deletedPlansResponse.json()) as { plans: RecoveryPlan[] }).plans ?? []
    : [];
  return {
    archivedRooms: rooms.archivedRooms ?? [],
    deletedRooms: rooms.deletedRooms ?? [],
    archivedPlans,
    deletedPlans,
    recoveryFetchFailed: !roomsResponse?.ok
  };
};
