import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// L2 per-plan feed. Returns:
//   - tasks         (server priority-ordered, non-deleted; carry full
//                    entity so L3 detail panel needs no round-trip)
//   - completion    (planCompletion incl. S1.2 title)
//   - rooms         (M:N junction; chip strip)
//   - plan          (lifecycle entity; null if no explicit plans row yet
//                    — the retrospective + lifecycle banner gate on this)
// Tasks endpoint is the load-bearing fetch; the others are best-effort
// (soft-fail to empty/null) so the page still renders if any single one
// trips.
export const load: PageLoad = async ({ params, fetch }) => {
  const [tasksRes, roomsRes, planRes] = await Promise.all([
    fetch(`/api/plans/${encodeURIComponent(params.planId)}/tasks`),
    fetch(`/api/plans/${encodeURIComponent(params.planId)}/rooms`),
    fetch(`/api/plans/${encodeURIComponent(params.planId)}`)
  ]);
  if (!tasksRes.ok) throw error(tasksRes.status, 'Could not load plan tasks.');
  const body = (await tasksRes.json()) as {
    planId: string;
    completion: {
      planId: string;
      title: string | null;
      total: number;
      completed: number;
      pct: number;
    };
    tasks: import('$lib/server/taskStore').Task[];
  };
  const rooms = roomsRes.ok
    ? ((await roomsRes.json()) as {
        rooms: { roomId: string; name: string; attachedAtMs: number; attachedBy: string | null }[];
      }).rooms
    : [];
  const plan = planRes.ok
    ? ((await planRes.json()) as {
        plan: {
          id: string;
          title: string | null;
          description: string | null;
          createdBy: string | null;
          createdAtMs: number;
          updatedAtMs: number;
          archivedAtMs: number | null;
          deletedAtMs: number | null;
        };
      }).plan
    : null;
  return {
    planId: params.planId,
    completion: body.completion,
    tasks: body.tasks,
    rooms,
    plan
  };
};
