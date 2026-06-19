import { describe, expect, it } from 'vitest';
import {
  buildPlanTriggerAddCommand,
  buildPlanTriggerFireCommand,
  buildPlanTriggerRemoveCommand,
  shellQuoteCliArg
} from './triggerCommands';

describe('plan trigger copied commands', () => {
  it('uses POSIX single-quote escaping for shell-evaluable text', () => {
    expect(shellQuoteCliArg("Plan $(date) $HOME `whoami` Bob's")).toBe(
      "'Plan $(date) $HOME `whoami` Bob'\\''s'"
    );
  });

  it('builds add commands with every interpolated value quoted safely', () => {
    const command = buildPlanTriggerAddCommand({
      event: 'plan.completed',
      action: 'room.message',
      planId: 'plan-a',
      message: "Plan $(date) $HOME `whoami` Bob's",
      createdBy: '@codex'
    });

    expect(command).toBe(
      "ant plan trigger add 'plan.completed' 'room.message' --plan 'plan-a' --message 'Plan $(date) $HOME `whoami` Bob'\\''s' --by '@codex'"
    );
    expect(command).not.toContain('"Plan');
  });

  it('builds fire commands with an explicit plan placeholder for wildcard triggers', () => {
    expect(buildPlanTriggerFireCommand({ id: 'trig_abc', planId: null })).toBe(
      "ant plan trigger fire 'trig_abc' --plan '<planId>'"
    );
  });

  it('builds scoped fire and remove commands with quoted trigger ids', () => {
    expect(buildPlanTriggerFireCommand({ id: 'trig_abc', planId: 'plan-a' })).toBe(
      "ant plan trigger fire 'trig_abc' --plan 'plan-a'"
    );
    expect(buildPlanTriggerRemoveCommand({ id: 'trig_abc' })).toBe(
      "ant plan trigger remove 'trig_abc'"
    );
  });
});
