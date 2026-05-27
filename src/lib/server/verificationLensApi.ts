import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { slugifyPolicyName } from './policyStore';
import { resolvePolicyActor, type ResolvedPolicyActor } from './policyActor';
import { tryAdminBearer } from './chatRoomAuthGate';
import {
  getValidationSchema,
  type ValidationSchema,
  type ValidationSchemaScope,
  type ValidationSchemaVisibility
} from './validationLensStore';
import { parseLensRulesJson, type LensRules } from './lensRulesBridge';

const LENS_KINDS = ['poc', 'fca', 'investment_memo', 'scientific_claim', 'marketing_copy', 'custom'] as const;
const SCOPES = ['public', 'user', 'org'] as const;
const MODES = ['all', 'any', 'none'] as const;
const REQUIREMENT_KINDS = ['agent', 'person', 'source', 'file', 'filesystem', 'website', 'context_summary'] as const;

export function resolveLensActor(request: Request, body: unknown): ResolvedPolicyActor | null {
  if (tryAdminBearer(request)) return { handle: '@admin', kind: 'human' };
  return resolvePolicyActor(request, body);
}

export function visibilityForActor(actor: ResolvedPolicyActor | null): ValidationSchemaVisibility {
  if (!actor) return { isAdmin: false, handles: [] };
  if (actor.handle === '@admin') return { isAdmin: true };
  return { isAdmin: false, handles: [actor.handle] };
}

export function normalizeLensId(name: string): string {
  const slug = slugifyPolicyName(name) || 'lens';
  return `lens-${slug}-${randomUUID().slice(0, 8)}`;
}

export function parseLensKind(value: unknown): ValidationSchema['lensKind'] {
  return typeof value === 'string' && (LENS_KINDS as readonly string[]).includes(value)
    ? value as ValidationSchema['lensKind']
    : 'custom';
}

export function parseScope(value: unknown): ValidationSchemaScope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value)
    ? value as ValidationSchemaScope
    : 'user';
}

export function scopeIdFor(scope: ValidationSchemaScope, actor: ResolvedPolicyActor, rawScopeId: unknown): string {
  if (scope === 'public') return 'global';
  if (scope === 'user') return actor.handle;
  if (typeof rawScopeId === 'string' && rawScopeId.trim().length > 0) return rawScopeId.trim();
  throw error(400, 'scopeId is required for org-scoped lenses.');
}

export function stringifyStrictLensRules(value: unknown): string {
  assertStrictLensRules(value);
  const raw = JSON.stringify(value ?? {});
  if (parseLensRulesJson(raw) === null) throw error(400, 'Invalid lens rules: malformed JSON.');
  return raw;
}

export function lensResponse(schema: ValidationSchema) {
  const rules = parseLensRulesJson(schema.rulesJson) ?? {};
  return {
    id: schema.id,
    name: schema.name,
    description: schema.description,
    lensKind: schema.lensKind,
    scope: schema.scope,
    scopeId: schema.scopeId,
    rules,
    createdBy: schema.createdBy,
    createdAtMs: schema.createdAtMs,
    updatedAtMs: schema.updatedAtMs,
    archivedAtMs: schema.archivedAtMs
  };
}

export function requireReadableLens(id: string, actor: ResolvedPolicyActor | null): ValidationSchema {
  const schema = getValidationSchema(id);
  if (!schema || schema.archivedAtMs !== null) throw error(404, 'Lens not found.');
  if (actor?.handle === '@admin') return schema;
  if (schema.scope === 'public') return schema;
  if (schema.scope === 'user' && actor && schema.scopeId === actor.handle) return schema;
  throw error(403, 'Lens is not visible to this caller.');
}

export function requireWritableLens(id: string, actor: ResolvedPolicyActor): ValidationSchema {
  const schema = requireReadableLens(id, actor);
  if (actor.handle === '@admin') return schema;
  if (schema.scope === 'user' && schema.scopeId === actor.handle) return schema;
  throw error(403, 'Only the lens owner can edit this lens.');
}

export function requireAuditReadableLens(id: string, actor: ResolvedPolicyActor | null): ValidationSchema {
  const schema = getValidationSchema(id);
  if (!schema) throw error(404, 'Lens not found.');
  if (actor?.handle === '@admin') return schema;
  if (schema.scope === 'public' && schema.archivedAtMs === null) return schema;
  if (schema.scope === 'user' && actor && schema.scopeId === actor.handle) return schema;
  throw error(schema.archivedAtMs === null ? 403 : 404, 'Lens audit is not visible to this caller.');
}

function assertStrictLensRules(value: unknown): asserts value is LensRules {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw error(400, 'Invalid lens rules: rules must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== undefined && record.version !== 2) {
    throw error(400, 'Invalid lens rules: version must be 2 when supplied.');
  }
  if (record.blocks !== undefined) {
    if (!record.blocks || typeof record.blocks !== 'object' || Array.isArray(record.blocks)) {
      throw error(400, 'Invalid lens rules: blocks must be an object.');
    }
    for (const [blockKind, block] of Object.entries(record.blocks as Record<string, unknown>)) {
      assertStrictBlock(block, `blocks.${blockKind}`);
    }
  }
  if (record.fallback !== undefined) assertStrictBlock(record.fallback, 'fallback');
}

function assertStrictBlock(value: unknown, path: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw error(400, `Invalid lens rules: ${path} must be an object.`);
  }
  const block = value as Record<string, unknown>;
  if (typeof block.mode !== 'string' || !(MODES as readonly string[]).includes(block.mode)) {
    throw error(400, `Invalid lens rules: ${path}.mode must be all, any, or none.`);
  }
  if (block.mode === 'none') return;
  if (!Array.isArray(block.requirements) || block.requirements.length === 0) {
    throw error(400, `Invalid lens rules: ${path}.requirements must contain at least one row.`);
  }
  block.requirements.forEach((requirement, index) => assertStrictRequirement(requirement, `${path}.requirements.${index}`));
}

function assertStrictRequirement(value: unknown, path: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw error(400, `Invalid lens rules: ${path} must be an object.`);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.kind !== 'string' || !(REQUIREMENT_KINDS as readonly string[]).includes(row.kind)) {
    throw error(400, `Invalid lens rules: ${path}.kind is not supported.`);
  }
  if (typeof row.count !== 'number' || !Number.isInteger(row.count) || row.count <= 0) {
    throw error(400, `Invalid lens rules: ${path}.count must be a positive integer.`);
  }
  for (const field of ['specific', 'allowedSources', 'specificFiles', 'allowedDomains'] as const) {
    if (row[field] !== undefined && !isStringArray(row[field])) {
      throw error(400, `Invalid lens rules: ${path}.${field} must be an array of strings.`);
    }
  }
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}
