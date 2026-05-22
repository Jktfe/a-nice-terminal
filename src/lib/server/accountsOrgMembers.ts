import { bearerTokenFromHeader } from './antchatAuthStore';
import { accountsBaseUrl } from './accountsProxy';
import { resolveAccountsBearerIdentity } from './accountsBearerIdentity';

export type AccountsOrgMember = {
  userId: string;
  email: string;
  displayName: string;
  handle: string;
  role: 'owner' | 'admin' | 'member';
  tier?: string;
};

const DEFAULT_ACCOUNTS_ORG_MEMBERS_TIMEOUT_MS = 1_500;

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function orgMembersTimeoutMs(): number {
  const parsed = Number(process.env.ANT_ACCOUNTS_ORG_MEMBERS_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_ACCOUNTS_ORG_MEMBERS_TIMEOUT_MS;
}

function parseMembers(payload: unknown): AccountsOrgMember[] {
  if (!payload || typeof payload !== 'object') return [];
  const rawMembers = (payload as { members?: unknown }).members;
  if (!Array.isArray(rawMembers)) return [];
  const members: AccountsOrgMember[] = [];
  for (const raw of rawMembers) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    if (
      typeof row.userId !== 'string' ||
      typeof row.email !== 'string' ||
      typeof row.displayName !== 'string' ||
      typeof row.handle !== 'string'
    ) continue;
    const role = row.role === 'owner' || row.role === 'admin' || row.role === 'member'
      ? row.role
      : 'member';
    members.push({
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      handle: normalizeHandle(row.handle),
      role,
      tier: typeof row.tier === 'string' ? row.tier : undefined
    });
  }
  return members;
}

export async function listAccountsOrgMembersForRequest(
  request: Request
): Promise<{ orgId: string; members: AccountsOrgMember[] } | null> {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) return null;

  const identity = await resolveAccountsBearerIdentity(token);
  if (!identity?.orgId) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), orgMembersTimeoutMs());
  let response: Response;
  try {
    response = await fetch(
      `${accountsBaseUrl()}/api/orgs/${encodeURIComponent(identity.orgId)}/members`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal
      }
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  return {
    orgId: identity.orgId,
    members: parseMembers(payload)
  };
}

export function findAccountsOrgMemberByHandle(
  members: AccountsOrgMember[],
  handle: string
): AccountsOrgMember | null {
  const target = normalizeHandle(handle).toLowerCase();
  return members.find((member) => member.handle.toLowerCase() === target) ?? null;
}
