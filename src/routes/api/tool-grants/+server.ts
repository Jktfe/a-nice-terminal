/**
 * /api/tool-grants — PR-D per-agent tool-grant endpoint
 * (plan milestone pr-d-tools-catalog of ant-substrate-v0.2-2026-05-29).
 *
 * POST   /api/tool-grants  (admin) → grant a tool to an agent.
 * DELETE /api/tool-grants  (admin) → soft-revoke matching grants.
 *
 * Body shape mirrors grants_shim's structure but the table is
 * tool_grants_v02 (catalog-FK rather than free-form action string).
 *
 * Auth (Stage A): admin-bearer only. Org-admin attestation lands with
 * the trust_pubkey substrate-wide lift queued in the plan.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  grantTool,
  revokeToolGrant,
  findToolById,
  type ToolGrantScopeKind
} from '$lib/server/toolsCatalogStore';

const VALID_SCOPE_KINDS: ReadonlyArray<ToolGrantScopeKind> = [
  'global',
  'org',
  'room',
  'session'
];

function adminCallerHandle(): string {
  // Admin-bearer auth has already been verified by the caller; resolved
  // identity is '@admin' (matches the grants_shim pattern).
  return '@admin';
}

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body !== 'object') {
    throw error(400, 'JSON body required.');
  }
  const granteeHandle = body.granteeHandle;
  if (typeof granteeHandle !== 'string' || granteeHandle.trim().length === 0) {
    throw error(400, 'granteeHandle (non-empty string) required');
  }
  const toolId = body.toolId;
  if (typeof toolId !== 'string' || toolId.trim().length === 0) {
    throw error(400, 'toolId (non-empty string) required');
  }
  const scopeKind = body.scopeKind;
  if (
    typeof scopeKind !== 'string' ||
    !VALID_SCOPE_KINDS.includes(scopeKind as ToolGrantScopeKind)
  ) {
    throw error(400, `scopeKind must be one of: ${VALID_SCOPE_KINDS.join(', ')}`);
  }
  // Catch missing-tool here so we 404 cleanly instead of letting the
  // store throw a generic Error.
  const tool = findToolById(toolId);
  if (!tool) throw error(404, 'tool not found');
  if (tool.retiredAtMs !== null) {
    throw error(400, 'cannot grant a retired tool');
  }
  const scopeId =
    typeof body.scopeId === 'string' && body.scopeId.length > 0
      ? body.scopeId
      : undefined;
  const expiresAtMs =
    typeof body.expiresAtMs === 'number' && body.expiresAtMs > 0
      ? body.expiresAtMs
      : undefined;
  const reason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason
      : undefined;
  const grant = grantTool({
    granteeHandle: granteeHandle.trim(),
    toolId,
    scopeKind: scopeKind as ToolGrantScopeKind,
    scopeId,
    grantedByHandle: adminCallerHandle(),
    expiresAtMs,
    reason
  });
  return json({ grant }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body !== 'object') {
    throw error(400, 'JSON body required.');
  }
  const granteeHandle = body.granteeHandle;
  if (typeof granteeHandle !== 'string' || granteeHandle.trim().length === 0) {
    throw error(400, 'granteeHandle (non-empty string) required');
  }
  const toolId = body.toolId;
  if (typeof toolId !== 'string' || toolId.trim().length === 0) {
    throw error(400, 'toolId (non-empty string) required');
  }
  const scopeKind = body.scopeKind;
  if (
    typeof scopeKind !== 'string' ||
    !VALID_SCOPE_KINDS.includes(scopeKind as ToolGrantScopeKind)
  ) {
    throw error(400, `scopeKind must be one of: ${VALID_SCOPE_KINDS.join(', ')}`);
  }
  const scopeId =
    typeof body.scopeId === 'string' && body.scopeId.length > 0
      ? body.scopeId
      : undefined;
  const revokedCount = revokeToolGrant({
    granteeHandle: granteeHandle.trim(),
    toolId,
    scopeKind: scopeKind as ToolGrantScopeKind,
    scopeId
  });
  return json({ revokedCount });
};
