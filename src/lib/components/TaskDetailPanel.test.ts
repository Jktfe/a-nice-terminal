import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import TaskDetailPanel from './TaskDetailPanel.svelte';
import type { Task } from '$lib/server/taskStore';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_validation_demo',
    subject: 'Validate claim_demo (@speedycodex)',
    description: [
      'Validate claim `claim_demo` using lens `jks-validation-rule`.',
      '',
      'Verifier kind: agent',
      'Requirement: 2 agents',
      'Artefact: /artefacts/art_demo',
      'Source pointer: artefact:art_demo#L1',
      '',
      'Claim:',
      '> The plan is safe.'
    ].join('\n'),
    status: 'completed',
    priority: null,
    planId: 'validation-art_demo',
    assignedAgent: '@speedycodex',
    blocks: [],
    blockedBy: [],
    evidence: [],
    notes: null,
    startedAtMs: null,
    endedAtMs: null,
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides
  };
}

describe('TaskDetailPanel validation verifier affordance', () => {
  it('renders pass/fail evidence controls for completed validation verifier tasks', () => {
    const { body } = render(TaskDetailPanel, {
      props: { task: task(), onClose: vi.fn() }
    });

    expect(body).toContain('Submit verifier evidence');
    expect(body).toContain('Mark pass');
    expect(body).toContain('Mark fail');
    expect(body).toContain('/api/tasks/task_validation_demo/validation-run');
  });

  it('does not render verifier evidence controls for unfinished validation tasks', () => {
    const { body } = render(TaskDetailPanel, {
      props: { task: task({ status: 'pending' }), onClose: vi.fn() }
    });

    expect(body).not.toContain('Submit verifier evidence');
  });
});
