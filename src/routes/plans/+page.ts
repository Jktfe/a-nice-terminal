import type { PageLoad } from './$types';

// L1 plans-index feed.
//
// `?show=` toggle (URL-driven so it's shareable):
//   - default (no/active) → /api/plans/completions?active=1 — work-in-progress only
//   - ?show=archived       → /api/plans/completions?archived=1 — archived plans
//   - ?show=deleted        → /api/plans/completions?deleted=1 — soft-deleted plans
//
// /api/tasks (non-deleted) feeds the single "Unfiled" lane for standalone
// tasks (plan_id NULL); those are excluded from every plan donut by design
// and are NOT shown when the archived/deleted toggle is on (Unfiled is
// fundamentally an "active work" affordance).
export const load: PageLoad = async ({ url, fetch }) => {
  const show = url.searchParams.get('show');
  const showArchived = show === 'archived';
  const showDeleted = show === 'deleted';
  const completionsPath = showDeleted
    ? '/api/plans/completions?deleted=1'
    : showArchived
      ? '/api/plans/completions?archived=1'
      : '/api/plans/completions?active=1';
  const [compRes, taskRes] = await Promise.all([
    fetch(completionsPath),
    fetch('/api/tasks')
  ]);
  const plansFetchFailed = !compRes.ok;
  const taskFetchFailed = !taskRes.ok;
  const plans = compRes.ok
    ? ((await compRes.json()) as {
        plans: {
          planId: string;
          total: number;
          completed: number;
          pct: number;
          title?: string | null;
        }[];
      }).plans
    : [];
  const allTasks = taskRes.ok
    ? ((await taskRes.json()) as { tasks: { planId: string | null; status: string }[] }).tasks
    : [];
  const unfiled = allTasks.filter((t) => t.planId === null);
  return {
    plans,
    unfiled: (showArchived || showDeleted)
      ? { total: 0, completed: 0 } // hide Unfiled when browsing archived/deleted
      : {
          total: unfiled.length,
          completed: unfiled.filter((t) => t.status === 'completed').length
        },
    plansFetchFailed,
    taskFetchFailed,
    showArchived,
    showDeleted
  };
};
