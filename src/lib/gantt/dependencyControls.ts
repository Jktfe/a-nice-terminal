export type DependencyControlTask = {
  id: string;
  subject: string;
  blockedBy: string[];
};

function blockersByTask(tasks: readonly DependencyControlTask[]): Map<string, string[]> {
  const byTask = new Map<string, string[]>();
  for (const task of tasks) {
    byTask.set(task.id, task.blockedBy.filter((id) => id.length > 0));
  }
  return byTask;
}

export function wouldCreateDependencyCycle(
  tasks: readonly DependencyControlTask[],
  taskId: string,
  blockerId: string
): boolean {
  if (taskId === blockerId) return true;
  const blockers = blockersByTask(tasks);
  const seen = new Set<string>();
  const stack = [blockerId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || seen.has(currentId)) continue;
    seen.add(currentId);
    for (const nextBlockerId of blockers.get(currentId) ?? []) {
      if (nextBlockerId === taskId) return true;
      stack.push(nextBlockerId);
    }
  }

  return false;
}

export function listAvailableBlockers(
  tasks: readonly DependencyControlTask[],
  taskId: string
): DependencyControlTask[] {
  const selected = tasks.find((task) => task.id === taskId);
  if (!selected) return [];
  const existingBlockers = new Set(selected.blockedBy);

  return tasks.filter((candidate) => {
    if (candidate.id === taskId) return false;
    if (existingBlockers.has(candidate.id)) return false;
    return !wouldCreateDependencyCycle(tasks, taskId, candidate.id);
  });
}
