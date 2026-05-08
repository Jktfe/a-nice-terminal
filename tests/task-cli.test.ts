import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { task } from '../cli/commands/task.js';
import { api } from '../cli/lib/api.js';

describe('ant task CLI provenance and plan flags', () => {
  const originalDisablePid = process.env.ANT_DISABLE_PID_IDENTITY;
  let postSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.ANT_DISABLE_PID_IDENTITY = '1';
    postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      task: {
        id: 'task-12345678',
        plan_id: 'cli-task-lifecycle-2026-05-08',
        milestone_id: 'm2-task-plan-link',
      },
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    postSpy.mockRestore();
    logSpy.mockRestore();
    if (originalDisablePid === undefined) delete process.env.ANT_DISABLE_PID_IDENTITY;
    else process.env.ANT_DISABLE_PID_IDENTITY = originalDisablePid;
  });

  it('sends the resolved actor separately from cli transport and plan metadata', async () => {
    await task(
      ['room-a', 'create', 'Link task to plan'],
      {
        from: '@evolveantcodex',
        plan: 'cli-task-lifecycle-2026-05-08',
        milestone: 'm2-task-plan-link',
        acceptance: 'a2-cli-flags',
      },
      { serverUrl: 'https://ant.test', apiKey: 'test-key', json: false },
    );

    expect(postSpy).toHaveBeenCalledWith(
      expect.anything(),
      '/api/sessions/room-a/tasks',
      expect.objectContaining({
        title: 'Link task to plan',
        created_by: '@evolveantcodex',
        created_source: 'cli',
        plan_id: 'cli-task-lifecycle-2026-05-08',
        milestone_id: 'm2-task-plan-link',
        acceptance_id: 'a2-cli-flags',
      }),
    );
  });
});
