import { describe, expect, it } from 'vitest';
import { listAvailableBlockers, wouldCreateDependencyCycle } from './dependencyControls';

const tasks = [
  { id: 'design', subject: 'Design', blockedBy: [] },
  { id: 'build', subject: 'Build', blockedBy: ['design'] },
  { id: 'review', subject: 'Review', blockedBy: ['build'] },
  { id: 'ship', subject: 'Ship', blockedBy: [] }
];

describe('Gantt dependency controls', () => {
  it('detects transitive cycles before adding a blocker', () => {
    expect(wouldCreateDependencyCycle(tasks, 'design', 'review')).toBe(true);
    expect(wouldCreateDependencyCycle(tasks, 'ship', 'review')).toBe(false);
  });

  it('lists only blockers that can be safely added to the selected task', () => {
    expect(listAvailableBlockers(tasks, 'design').map((task) => task.id)).toEqual(['ship']);
    expect(listAvailableBlockers(tasks, 'ship').map((task) => task.id)).toEqual([
      'design',
      'build',
      'review'
    ]);
  });
});
