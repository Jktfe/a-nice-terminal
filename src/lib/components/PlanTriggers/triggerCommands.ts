import type { PlanTrigger } from '$lib/server/planTriggerStore';

export type TriggerAddCommandOptions = {
  event: string;
  action: string;
  planId?: string | null;
  message?: string | null;
  url?: string | null;
  subject?: string | null;
  targetPlan?: string | null;
  priority?: string | null;
  createdBy?: string | null;
};

export function shellQuoteCliArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function pushFlag(parts: string[], flag: string, value: string | null | undefined): void {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0) return;
  parts.push(flag, shellQuoteCliArg(trimmed));
}

export function buildPlanTriggerAddCommand(options: TriggerAddCommandOptions): string {
  const parts = [
    'ant',
    'plan',
    'trigger',
    'add',
    shellQuoteCliArg(options.event),
    shellQuoteCliArg(options.action)
  ];
  pushFlag(parts, '--plan', options.planId);
  pushFlag(parts, '--message', options.message);
  pushFlag(parts, '--url', options.url);
  pushFlag(parts, '--subject', options.subject);
  pushFlag(parts, '--target-plan', options.targetPlan);
  if (options.priority?.trim().match(/^-?\d+$/)) pushFlag(parts, '--priority', options.priority);
  pushFlag(parts, '--by', options.createdBy);
  return parts.join(' ');
}

export function buildPlanTriggerFireCommand(trigger: Pick<PlanTrigger, 'id' | 'planId'>): string {
  const planId = trigger.planId ?? '<planId>';
  return [
    'ant',
    'plan',
    'trigger',
    'fire',
    shellQuoteCliArg(trigger.id),
    '--plan',
    shellQuoteCliArg(planId)
  ].join(' ');
}

export function buildPlanTriggerRemoveCommand(trigger: Pick<PlanTrigger, 'id'>): string {
  return ['ant', 'plan', 'trigger', 'remove', shellQuoteCliArg(trigger.id)].join(' ');
}
