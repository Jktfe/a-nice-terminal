import { createHash } from 'node:crypto';
import {
  createTask,
  getTask,
  type JwpkTask,
  type CreateJwpkTaskInput
} from './tasksStore';
import type { ValidationOrchestrationPlan } from './validationOrchestrator';
import type { ValidationVerifierKind } from './validationScoring';

export type ValidationWorkItem = {
  task: JwpkTask;
  claimId: string;
  claimText: string;
  sourcePointer: string;
  verifierKind: ValidationVerifierKind;
  reason: string;
  reused: boolean;
};

function stableTaskId(parts: string[]): string {
  const digest = createHash('sha1')
    .update(parts.join('\n'))
    .digest('hex')
    .slice(0, 14);
  return `task_validation_${digest}`;
}

function shortQuote(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= 140 ? compact : `${compact.slice(0, 137)}...`;
}

function workDescription(input: {
  artefactId: string;
  lensSlug: string;
  claimId: string;
  claimText: string;
  sourcePointer: string;
  verifierKind: ValidationVerifierKind;
  reason: string;
}): string {
  return [
    `Validate claim \`${input.claimId}\` using lens \`${input.lensSlug}\`.`,
    '',
    `Verifier kind: ${input.verifierKind}`,
    `Requirement: ${input.reason}`,
    `Artefact: /artefacts/${input.artefactId}`,
    `Source pointer: ${input.sourcePointer}`,
    '',
    'Claim:',
    `> ${shortQuote(input.claimText)}`
  ].join('\n');
}

function createOrReuseTask(input: CreateJwpkTaskInput): { task: JwpkTask; reused: boolean } {
  if (input.id) {
    const existing = getTask(input.id);
    if (existing) return { task: existing, reused: true };
  }
  return { task: createTask(input), reused: false };
}

export function createValidationWorkItems(input: {
  artefactId: string;
  roomId: string;
  lensSlug: string;
  orchestration: ValidationOrchestrationPlan;
  createdBy: string;
  maxItems?: number;
}): ValidationWorkItem[] {
  const maxItems = Math.max(0, Math.floor(input.maxItems ?? 100));
  const items: ValidationWorkItem[] = [];

  for (const claimPlan of input.orchestration.claimPlans) {
    const claim = claimPlan.claim;
    const claimText = shortQuote(claim.text);
    let order = 0;

    for (const missing of claimPlan.missing) {
      for (let index = 0; index < missing.count; index += 1) {
        if (items.length >= maxItems) return items;
        order += 1;
        const id = stableTaskId([
          input.artefactId,
          input.lensSlug,
          claim.id,
          missing.verifierKind,
          String(index + 1)
        ]);
        const { task, reused } = createOrReuseTask({
          id,
          title: `Validate ${claim.id} (${missing.verifierKind} ${index + 1}/${missing.count})`,
          description: workDescription({
            artefactId: input.artefactId,
            lensSlug: input.lensSlug,
            claimId: claim.id,
            claimText: claim.text,
            sourcePointer: claim.source.pointer,
            verifierKind: missing.verifierKind,
            reason: missing.reason
          }),
          status: 'todo',
          assignedTo: null,
          roomId: input.roomId,
          planId: `validation-${input.artefactId}`,
          createdBy: input.createdBy,
          orderIndex: items.length + order
        });
        items.push({
          task,
          claimId: claim.id,
          claimText,
          sourcePointer: claim.source.pointer,
          verifierKind: missing.verifierKind,
          reason: missing.reason,
          reused
        });
      }
    }
  }

  return items;
}
