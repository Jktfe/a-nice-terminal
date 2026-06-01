import { getPlan, type PlanLifecycleState, type PlanRecord } from './planStore';
import { listRoomsForPlan, type RoomForPlan } from './planRoomLinkStore';
import {
  listTasksForPlan,
  planCompletion,
  type Task
} from './taskStore';
import {
  projectPlanEvents,
  type EvidenceRef,
  type PlanEvent,
  type PlanStatus
} from './planModeStore';

export type PlanCockpitProgressMetric = {
  total: number;
  completed: number;
  pct: number;
};

export type PlanCockpitActivity = {
  kind: 'plan_event' | 'task' | 'evidence';
  refId: string;
  title: string;
  status: string | null;
  actor: string | null;
  atMs: number;
  evidence: EvidenceRef[];
};

export type PlanCockpitTest = {
  id: string;
  title: string;
  status: PlanStatus | null;
  evidence: EvidenceRef[];
};

export type PlanCockpitMilestone = {
  id: string;
  title: string;
  body: string | null;
  status: PlanStatus | null;
  owner: string | null;
  tests: PlanCockpitTest[];
  tasks: Task[];
  evidence: EvidenceRef[];
  comments: PlanCockpitActivity[];
};

export type PlanCockpitDecision = {
  id: string;
  title: string;
  body: string | null;
  status: PlanStatus | null;
  evidence: EvidenceRef[];
};

export type PlanCockpitPhase = {
  id: string;
  title: string;
  body: string | null;
  status: PlanStatus | null;
  milestones: PlanCockpitMilestone[];
  decisions: PlanCockpitDecision[];
};

export type PlanCockpit = {
  plan: {
    id: string;
    title: string | null;
    description: string | null;
    lifecycle: PlanLifecycleState;
  };
  progress: {
    tasks: PlanCockpitProgressMetric;
    phases: Array<PlanCockpitProgressMetric & { id: string; title: string }>;
    milestones: PlanCockpitProgressMetric;
  };
  phases: PlanCockpitPhase[];
  unphasedTasks: Task[];
  rooms: RoomForPlan[];
  recentActivity: PlanCockpitActivity[];
};

function lifecycleFor(plan: PlanRecord): PlanLifecycleState {
  if (plan.deletedAtMs !== null) return 'deleted';
  if (plan.archivedAtMs !== null) return 'archived';
  return 'active';
}

function isCompleteStatus(status: string | null | undefined): boolean {
  return status === 'done' || status === 'passing' || status === 'completed';
}

function metric(total: number, completed: number): PlanCockpitProgressMetric {
  return { total, completed, pct: total === 0 ? 0 : completed / total };
}

function eventActivity(event: PlanEvent): PlanCockpitActivity {
  return {
    kind: 'plan_event',
    refId: event.id,
    title: event.title,
    status: event.status ?? null,
    actor: event.author_handle,
    atMs: event.ts_millis,
    evidence: event.evidence
  };
}

function taskActivity(task: Task): PlanCockpitActivity {
  return {
    kind: 'task',
    refId: task.id,
    title: task.subject,
    status: task.status,
    actor: task.assignedAgent,
    atMs: task.updatedAtMs,
    evidence: task.evidence
  };
}

function evidenceActivity(task: Task, ev: EvidenceRef): PlanCockpitActivity {
  return {
    kind: 'evidence',
    refId: ev.ref,
    title: ev.label ?? ev.ref,
    status: task.status,
    actor: task.assignedAgent,
    atMs: task.updatedAtMs,
    evidence: [ev]
  };
}

function eventId(event: PlanEvent): string {
  if (event.kind === 'plan_milestone') return event.milestone_id ?? event.id;
  if (event.kind === 'plan_test') return event.id;
  if (event.kind === 'plan_acceptance') return event.acceptance_id ?? event.id;
  return event.id;
}

function parentSectionId(event: PlanEvent): string | null {
  return event.parent_id ?? null;
}

export function buildPlanCockpit(planId: string): PlanCockpit | null {
  const plan = getPlan(planId);
  const tasks = listTasksForPlan(planId);
  const events = projectPlanEvents(planId);
  if (!plan && tasks.length === 0 && events.length === 0) return null;

  const completion = planCompletion(planId);
  const sections = events.filter((event) => event.kind === 'plan_section');
  const milestones = events.filter((event) => event.kind === 'plan_milestone');
  const tests = events.filter((event) => event.kind === 'plan_test');
  const decisions = events.filter((event) => event.kind === 'plan_decision');

  const testsByMilestoneId = new Map<string, PlanCockpitTest[]>();
  for (const test of tests) {
    const key = test.milestone_id ?? test.parent_id ?? '';
    const list = testsByMilestoneId.get(key) ?? [];
    list.push({
      id: eventId(test),
      title: test.title,
      status: test.status ?? null,
      evidence: test.evidence
    });
    testsByMilestoneId.set(key, list);
  }

  const milestonesBySectionId = new Map<string, PlanCockpitMilestone[]>();
  for (const milestone of milestones) {
    const id = eventId(milestone);
    const list = milestonesBySectionId.get(parentSectionId(milestone) ?? '') ?? [];
    list.push({
      id,
      title: milestone.title,
      body: milestone.body ?? null,
      status: milestone.status ?? null,
      owner: milestone.owner ?? null,
      tests: testsByMilestoneId.get(id) ?? [],
      tasks: [],
      evidence: milestone.evidence,
      comments: []
    });
    milestonesBySectionId.set(parentSectionId(milestone) ?? '', list);
  }

  const decisionsBySectionId = new Map<string, PlanCockpitDecision[]>();
  for (const decision of decisions) {
    const list = decisionsBySectionId.get(parentSectionId(decision) ?? '') ?? [];
    list.push({
      id: eventId(decision),
      title: decision.title,
      body: decision.body ?? null,
      status: decision.status ?? null,
      evidence: decision.evidence
    });
    decisionsBySectionId.set(parentSectionId(decision) ?? '', list);
  }

  const phases: PlanCockpitPhase[] = sections.map((section) => ({
    id: section.id,
    title: section.title,
    body: section.body ?? null,
    status: section.status ?? null,
    milestones: milestonesBySectionId.get(section.id) ?? [],
    decisions: decisionsBySectionId.get(section.id) ?? []
  }));

  // Render fallback (2026-06-01): a milestone whose parent_id matches no section
  // (unparented, or parented to a stale id) was keyed under a bucket no phase
  // reads, so it COUNTED in the global total but rendered under NO phase — the
  // "phase shows 0% while work shipped" bug. Collect those into an explicit
  // Ungrouped phase so nothing counted is ever invisible. (Correct section
  // nesting for such milestones comes from re-posting with parent_id — the
  // write-time `--parent` path; this is the safety net that guarantees the
  // dashboard never silently drops a milestone. Order-based attachment was
  // rejected: real plans carry unparented milestones all at order 0, so there
  // is no reliable preceding-section sequence to walk.)
  const renderedSectionIds = new Set(sections.map((section) => section.id));
  const ungroupedMilestones = [...milestonesBySectionId.entries()]
    .filter(([sectionKey]) => !renderedSectionIds.has(sectionKey))
    .flatMap(([, list]) => list);
  const ungroupedDecisions = [...decisionsBySectionId.entries()]
    .filter(([sectionKey]) => !renderedSectionIds.has(sectionKey))
    .flatMap(([, list]) => list);
  if (ungroupedMilestones.length > 0 || ungroupedDecisions.length > 0) {
    phases.push({
      id: '__ungrouped__',
      title: 'Ungrouped',
      body: null,
      status: null,
      milestones: ungroupedMilestones,
      decisions: ungroupedDecisions
    });
  }

  const phaseProgress = phases.map((phase) => {
    const total = phase.milestones.length;
    const completed = phase.milestones.filter((milestone) =>
      isCompleteStatus(milestone.status)
    ).length;
    return { id: phase.id, title: phase.title, ...metric(total, completed) };
  });
  const milestoneMetric = metric(
    milestones.length,
    milestones.filter((milestone) => isCompleteStatus(milestone.status)).length
  );

  const evidenceEntries = tasks.flatMap((task) =>
    task.evidence.map((ev) => evidenceActivity(task, ev))
  );
  const recentActivity = [...events.map(eventActivity), ...tasks.map(taskActivity), ...evidenceEntries]
    .sort((left, right) => right.atMs - left.atMs)
    .slice(0, 25);

  return {
    plan: {
      id: planId,
      title: plan?.title ?? completion.title,
      description: plan?.description ?? null,
      lifecycle: plan ? lifecycleFor(plan) : 'active'
    },
    progress: {
      tasks: metric(completion.total, completion.completed),
      phases: phaseProgress,
      milestones: milestoneMetric
    },
    phases,
    unphasedTasks: tasks,
    rooms: listRoomsForPlan(planId),
    recentActivity
  };
}
