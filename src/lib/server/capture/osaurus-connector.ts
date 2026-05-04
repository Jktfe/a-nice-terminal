import { randomBytes } from 'crypto';
import { createInvite, exchangePassword, publicOrigin } from '../room-invites.js';
import { queries } from '../db.js';

export interface OsaurusConnectorResult {
  ok: boolean;
  reason?: string;
  room_id?: string;
  handle?: string | null;
  endpoint?: string;
  token_id?: string;
  invite_id?: string;
  tools?: string[];
  mcp_config?: {
    mcpServers: Record<string, {
      url: string;
    }>;
  };
  note?: string;
}

function connectorPassword(): string {
  return randomBytes(18).toString('base64url');
}

export function createOsaurusConnector(sessionId: string, url: URL): OsaurusConnectorResult {
  const session = queries.getSession(sessionId) as any;
  if (!session) return { ok: false, reason: 'session not found' };

  const password = connectorPassword();
  const invite = createInvite({
    roomId: sessionId,
    label: 'Osaurus MCP connector',
    password,
    kinds: ['mcp'],
    createdBy: 'ant-plugin:osaurus',
  });

  const token = exchangePassword({
    inviteId: invite.id,
    password,
    kind: 'mcp',
    handle: '@osaurus',
    meta: {
      client: 'osaurus',
      plugin: 'ant-osaurus',
      session_id: sessionId,
    },
  });

  if (!token) return { ok: false, reason: 'failed to mint scoped MCP token', invite_id: invite.id };

  const origin = publicOrigin({ url });
  const endpoint = `${origin}/mcp/room/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token.token)}`;
  const serverName = `ant-room-${sessionId.slice(0, 8)}`;

  return {
    ok: true,
    room_id: sessionId,
    handle: token.handle,
    endpoint,
    token_id: token.tokenId,
    invite_id: invite.id,
    tools: ['whoami', 'list_messages', 'post_message', 'list_participants'],
    mcp_config: {
      mcpServers: {
        [serverName]: {
          url: endpoint,
        },
      },
    },
    note: 'Scoped room MCP connector for Osaurus. Each export mints a fresh token because plaintext bearer tokens are not recoverable after creation. Revoke generated invites/tokens from the room share panel to remove access.',
  };
}
