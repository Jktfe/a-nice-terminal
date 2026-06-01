import {
  createInvite,
  exchangePasswordForToken,
  mintTokenSecret,
  revokeInvite
} from './chatInviteStore';

type StoredMcpGrant = {
  token_id: string;
  invite_id: string;
  room_id: string;
  handle: string;
  label: string;
  created_by: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type McpGrantSummary = StoredMcpGrant;

export type CreateMcpGrantInput = {
  roomId: string;
  handle: string;
  label?: string | null;
  createdBy?: string | null;
};

export type CreateMcpGrantResult = {
  grant: McpGrantSummary;
  tokenSecret: string;
};

export type ListMcpGrantOptions = {
  includeRevoked?: boolean;
};

export type RevokeMcpGrantResult = {
  revoked: boolean;
  grant?: McpGrantSummary;
};

const grantByTokenId = new Map<string, StoredMcpGrant>();

function normaliseHandle(handle: string): string {
  const trimmed = handle.trim();
  if (trimmed.length === 0) throw new Error('handle is required');
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function copyGrant(grant: StoredMcpGrant): McpGrantSummary {
  return { ...grant };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createMcpGrant(input: CreateMcpGrantInput): CreateMcpGrantResult {
  const roomId = input.roomId.trim();
  if (roomId.length === 0) throw new Error('roomId is required');
  const handle = normaliseHandle(input.handle);
  const label = input.label?.trim() || handle;
  const password = mintTokenSecret();
  const invite = createInvite({
    roomId,
    label: `mcp:${label}`,
    password,
    kinds: ['mcp'],
    createdBy: input.createdBy ?? null,
    hidden: true
  });
  const token = exchangePasswordForToken({
    inviteId: invite.id,
    password,
    kind: 'mcp',
    handle
  });
  const grant: StoredMcpGrant = {
    token_id: token.tokenId,
    invite_id: invite.id,
    room_id: roomId,
    handle,
    label,
    created_by: input.createdBy ?? null,
    created_at: invite.created_at,
    last_seen_at: null,
    revoked_at: null
  };
  grantByTokenId.set(grant.token_id, grant);
  return { grant: copyGrant(grant), tokenSecret: token.tokenSecret };
}

export function listMcpGrantsForRoom(
  roomId: string,
  options: ListMcpGrantOptions = {}
): McpGrantSummary[] {
  const includeRevoked = options.includeRevoked === true;
  return [...grantByTokenId.values()]
    .filter((grant) => grant.room_id === roomId && (includeRevoked || grant.revoked_at === null))
    .map(copyGrant);
}

export function revokeMcpGrant(tokenId: string): RevokeMcpGrantResult {
  const grant = grantByTokenId.get(tokenId);
  if (!grant) return { revoked: false };
  if (grant.revoked_at === null) {
    grant.revoked_at = nowIso();
    revokeInvite(grant.invite_id);
  }
  return { revoked: true, grant: copyGrant(grant) };
}

export function resetMcpGrantStoreForTests(): void {
  grantByTokenId.clear();
}
