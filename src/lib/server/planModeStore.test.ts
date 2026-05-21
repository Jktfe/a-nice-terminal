import { afterEach, describe, expect, it } from 'vitest';
import {
  appendPlanEvent,
  identityKeyFor,
  listKnownPlanIds,
  projectPlanEvents,
  resetPlanModeStoreForTests,
  type PlanEvent
} from './planModeStore';

afterEach(() => {
  resetPlanModeStoreForTests();
});

function makeEvent(overrides: Partial<PlanEvent> & { plan_id: string; kind: PlanEvent['kind']; title: string }): PlanEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2, 8)}`,
    plan_id: overrides.plan_id,
    parent_id: overrides.parent_id,
    kind: overrides.kind,
    title: overrides.title,
    body: overrides.body,
    status: overrides.status,
    owner: overrides.owner,
    milestone_id: overrides.milestone_id,
    acceptance_id: overrides.acceptance_id,
    order: overrides.order ?? 0,
    author_handle: overrides.author_handle ?? '@claude2',
    author_kind: overrides.author_kind ?? 'agent',
    ts_millis: overrides.ts_millis ?? 1_000,
    evidence: overrides.evidence ?? [],
    provenance: overrides.provenance
  };
}

describe('planModeStore', () => {
  it('T1: empty store returns empty projection for any plan_id', () => {
    expect(projectPlanEvents('whatever-plan')).toEqual([]);
    expect(listKnownPlanIds()).toEqual([]);
  });

  it('T2: a single plan_section appears in the projection', () => {
    appendPlanEvent(makeEvent({
      plan_id: 'plan-a',
      kind: 'plan_section',
      title: 'Foundation',
      order: 1
    }));
    const projection = projectPlanEvents('plan-a');
    expect(projection).toHaveLength(1);
    expect(projection[0].title).toBe('Foundation');
    expect(listKnownPlanIds()).toEqual(['plan-a']);
  });

  it('T3: latest-wins by identity key — newer ts_millis replaces older for same milestone_id', () => {
    appendPlanEvent(makeEvent({
      plan_id: 'plan-a',
      kind: 'plan_milestone',
      milestone_id: 'pm-store',
      title: 'Foundation store',
      status: 'active',
      ts_millis: 100
    }));
    appendPlanEvent(makeEvent({
      plan_id: 'plan-a',
      kind: 'plan_milestone',
      milestone_id: 'pm-store',
      title: 'Foundation store',
      status: 'done',
      ts_millis: 200
    }));
    const projection = projectPlanEvents('plan-a');
    expect(projection).toHaveLength(1);
    expect(projection[0].status).toBe('done');
    expect(projection[0].ts_millis).toBe(200);
  });

  it('T4: cross-plan isolation — events under plan_a do not appear in plan_b projection', () => {
    appendPlanEvent(makeEvent({ plan_id: 'plan-a', kind: 'plan_section', title: 'A side' }));
    appendPlanEvent(makeEvent({ plan_id: 'plan-b', kind: 'plan_section', title: 'B side' }));
    expect(projectPlanEvents('plan-a').map((e) => e.title)).toEqual(['A side']);
    expect(projectPlanEvents('plan-b').map((e) => e.title)).toEqual(['B side']);
    expect(listKnownPlanIds()).toEqual(['plan-a', 'plan-b']);
  });

  it('T5: parent/order sort — projection returns events sorted by parent_id then order', () => {
    appendPlanEvent(makeEvent({ plan_id: 'plan-a', kind: 'plan_section', title: 'Foundation', order: 1 }));
    appendPlanEvent(makeEvent({
      plan_id: 'plan-a',
      kind: 'plan_milestone',
      milestone_id: 'pm-cli',
      title: 'CLI verbs',
      parent_id: 'section-cli',
      order: 2
    }));
    appendPlanEvent(makeEvent({
      plan_id: 'plan-a',
      kind: 'plan_milestone',
      milestone_id: 'pm-store',
      title: 'Store',
      parent_id: 'section-cli',
      order: 1
    }));
    const projection = projectPlanEvents('plan-a');
    expect(projection.map((e) => e.title)).toEqual(['Foundation', 'Store', 'CLI verbs']);
  });

  it('T6: status preservation — plan_milestone status flows through latest-wins', () => {
    appendPlanEvent(makeEvent({
      plan_id: 'plan-a',
      kind: 'plan_milestone',
      milestone_id: 'pm-store',
      title: 'Store',
      status: 'planned',
      ts_millis: 50
    }));
    appendPlanEvent(makeEvent({
      plan_id: 'plan-a',
      kind: 'plan_milestone',
      milestone_id: 'pm-store',
      title: 'Store',
      status: 'blocked',
      ts_millis: 75
    }));
    appendPlanEvent(makeEvent({
      plan_id: 'plan-a',
      kind: 'plan_milestone',
      milestone_id: 'pm-store',
      title: 'Store',
      status: 'passing',
      ts_millis: 100
    }));
    const projection = projectPlanEvents('plan-a');
    expect(projection[0].status).toBe('passing');
  });

  it('T7: evidence + provenance retention — arrays preserved across append + project roundtrip', () => {
    const evidenceList = [
      { kind: 'url' as const, ref: 'https://example.com/proof', label: 'smoke test' },
      { kind: 'chat_message' as const, ref: 'bvya-msg-123' }
    ];
    const provenanceRef = { chat_message_id: 'bvya-msg-456', author: '@claude2' };
    appendPlanEvent(makeEvent({
      plan_id: 'plan-a',
      kind: 'plan_test',
      title: 'pm-store-tests-green',
      milestone_id: 'pm-store',
      status: 'passing',
      evidence: evidenceList,
      provenance: provenanceRef
    }));
    const projection = projectPlanEvents('plan-a');
    expect(projection[0].evidence).toEqual(evidenceList);
    expect(projection[0].provenance).toEqual(provenanceRef);
  });

  it('extra: identityKeyFor derives expected keys per §2', () => {
    expect(identityKeyFor(makeEvent({ plan_id: 'p', kind: 'plan_section', title: 'Foundation' }))).toBe('section:p:foundation');
    expect(identityKeyFor(makeEvent({ plan_id: 'p', kind: 'plan_milestone', milestone_id: 'pm-store', title: 'X' }))).toBe('milestone:p:pm-store');
    expect(identityKeyFor(makeEvent({ plan_id: 'p', kind: 'plan_test', milestone_id: 'pm-store', title: 'Tests green' }))).toBe('test:p:pm-store:tests-green');
  });
});
