import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { slugifyPolicyName } from './policyStore';
import { resolvePolicyActor, type ResolvedPolicyActor } from './policyActor';
import { tryAdminBearer, ADMIN_BEARER_HANDLE } from './chatRoomAuthGate';
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

/**
 * Sec-iter3 Fix (2026-05-30): typed admin-bearer discriminator for the
 * verification lens API surface. Mirrors the iter-2 reshape on
 * permissionCallerIdentity (AuthoritativeCallerIdentity.isAdminBearer).
 *
 * Pre-iter3 the lens authority checks short-circuited via
 * `actor.handle === '@admin'`. The reviewer's iter-4 trace confirmed
 * that surface was NOT exploitable today — the only path that can land
 * '@admin' into `actor.handle` is `tryAdminBearer` (constant-time
 * ANT_ADMIN_TOKEN match), and iter-1 + iter-2 closed the writers that
 * could plant '@admin' as a victim handle on browser_sessions or
 * terminal_records.handle. But the SHAPE of the check (string-eq vs a
 * typed flag) is the same class of bug iter-2 closed elsewhere — so a
 * future writer that opens a new path to '@admin' as a caller-handle
 * value would immediately re-open this surface.
 *
 * The fix: route the admin signal through a dedicated boolean
 * (`isAdminBearer`) derived SOLELY from `tryAdminBearer`. The `handle`
 * field is purely display / audit — `@admin` appears in audit rows for
 * admin-bearer mutations, but `actor.handle === '@admin'` is now
 * forbidden as an authority signal. Callers must read
 * `actor.isAdminBearer` for short-circuits.
 */
export type ResolvedLensActor = ResolvedPolicyActor & {
  /** TRUE iff the request carried a valid ANT_ADMIN_TOKEN Bearer header.
   *  This is the ONLY signal that may bypass scope/owner checks in the
   *  lens API. String-comparing `handle` to the admin sentinel is the
   *  iter-3 bypass surface and is now forbidden. */
  isAdminBearer: boolean;
};

export function resolveLensActor(request: Request, body: unknown): ResolvedLensActor | null {
  if (tryAdminBearer(request)) {
    return { handle: ADMIN_BEARER_HANDLE, kind: 'human', isAdminBearer: true };
  }
  const actor = resolvePolicyActor(request, body);
  if (!actor) return null;
  return { ...actor, isAdminBearer: false };
}

export function visibilityForActor(actor: ResolvedLensActor | null): ValidationSchemaVisibility {
  if (!actor) return { isAdmin: false, handles: [] };
  if (actor.isAdminBearer) return { isAdmin: true };
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

export function scopeIdFor(scope: ValidationSchemaScope, actor: ResolvedLensActor, rawScopeId: unknown): string {
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

export function requireReadableLens(id: string, actor: ResolvedLensActor | null): ValidationSchema {
  const schema = getValidationSchema(id);
  if (!schema || schema.archivedAtMs !== null) throw error(404, 'Lens not found.');
  if (actor?.isAdminBearer === true) return schema;
  if (schema.scope === 'public') return schema;
  if (schema.scope === 'user' && actor && schema.scopeId === actor.handle) return schema;
  throw error(403, 'Lens is not visible to this caller.');
}

export function requireWritableLens(id: string, actor: ResolvedLensActor): ValidationSchema {
  const schema = requireReadableLens(id, actor);
  if (actor.isAdminBearer === true) return schema;
  if (schema.scope === 'user' && schema.scopeId === actor.handle) return schema;
  throw error(403, 'Only the lens owner can edit this lens.');
}

export function requireAuditReadableLens(id: string, actor: ResolvedLensActor | null): ValidationSchema {
  const schema = getValidationSchema(id);
  if (!schema) throw error(404, 'Lens not found.');
  if (actor?.isAdminBearer === true) return schema;
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
