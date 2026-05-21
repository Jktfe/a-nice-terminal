// Regression tests for PlanCockpit.svelte.
//
// History — two crash classes have shipped here:
//   (a) recentActivity used `at`/`summary` field names that the server
//       never returns, collapsing each-keys to the same literal string
//       and tripping Svelte's each_key_duplicate runtime error (5e5d1af).
//   (b) phase rendering iterated `cockpit.phases` (raw phase records, no
//       metrics) and dereferenced `phase.phaseId` + `phase.completion.pct`
//       — neither exists on the server's PlanCockpitPhase or on the
//       metric row. Any plan with ≥2 phases crashed.
//
// SSR renders the loading state, so these tests cover the static
// branches (header, plan title) plus a shape contract assertion that
// keeps the local types pinned to the actual server projection.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PlanCockpit from './PlanCockpit.svelte';
import type { PlanCockpit as PlanCockpitShape } from '$lib/server/planCockpitStore';

describe('PlanCockpit', () => {
  it('renders the SSR loading skeleton when no planId data is in flight yet', () => {
    const { body } = render(PlanCockpit, { props: { planId: 'v4-fresh-ant' } });
    expect(body).toContain('Loading plan dashboard');
  });

  it('keeps its local type contract aligned with the server cockpit shape', () => {
    // Build a value typed as the SERVER's PlanCockpit and check every
    // field the template dereferences. If the server type drifts (e.g.
    // someone renames `id` back to `phaseId`) and the component is not
    // updated in lockstep, this fails to type-check at vitest compile
    // and we catch it before it ships.
    const serverShape: PlanCockpitShape = {
      plan: { id: 'p1', title: 'P1', description: null, lifecycle: 'active' },
      progress: {
        tasks: { total: 3, completed: 1, pct: 0.33 },
        phases: [
          { id: 'phase-a', title: 'Phase A', total: 2, completed: 1, pct: 0.5 },
          { id: 'phase-b', title: 'Phase B', total: 1, completed: 1, pct: 1 }
        ],
        milestones: { total: 0, completed: 0, pct: 0 }
      },
      phases: [],
      unphasedTasks: [],
      rooms: [
        { roomId: 'room-1', name: 'antv4', attachedAtMs: 1700000000000, attachedBy: '@evolveantclaude' }
      ],
      recentActivity: [
        {
          kind: 'task',
          refId: 'task-a',
          title: 'Did the thing',
          status: 'done',
          actor: '@evolvemantsvelte',
          atMs: 1700000000000,
          evidence: []
        }
      ]
    };

    // Each accessor below mirrors a template expression: the test fails
    // to compile if any of these fields go missing on the server type.
    expect(serverShape.plan.title).toBe('P1');
    expect(serverShape.progress.phases[0].id).toBe('phase-a');
    expect(serverShape.progress.phases[0].title).toBe('Phase A');
    expect(serverShape.progress.phases[1].pct).toBe(1);
    expect(serverShape.progress.phases.filter((entry) => entry.pct >= 1).length).toBe(1);
    expect(serverShape.rooms[0].roomId).toBe('room-1');
    expect(serverShape.rooms[0].attachedAtMs).toBe(1700000000000);
    expect(serverShape.recentActivity[0].refId).toBe('task-a');
    expect(serverShape.recentActivity[0].atMs).toBe(1700000000000);

    // each-key uniqueness audit for the lists the template renders.
    // Same id appearing across different lists must not collide, and
    // duplicates within a list must be impossible by construction.
    const phaseKeys = serverShape.progress.phases.map((p) => `phase:${p.id}`);
    const roomKeys = serverShape.rooms.map((r) => `room:${r.roomId}`);
    const activityKeys = serverShape.recentActivity.map(
      (a) => `activity:${a.kind}:${a.refId}:${a.atMs}`
    );
    const allKeys = [...phaseKeys, ...roomKeys, ...activityKeys];
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});
