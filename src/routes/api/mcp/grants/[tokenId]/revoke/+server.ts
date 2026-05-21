import { error, json } from '@sveltejs/kit';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { revokeMcpGrant } from '$lib/server/mcpGrantStore';

export const POST = async ({
  params,
  request
}: {
  params: { tokenId?: string };
  request: Request;
}) => {
  requireAdminAuth(request);
  const tokenId = params.tokenId ?? '';
  if (tokenId.length === 0) throw error(400, 'tokenId required');
  const result = revokeMcpGrant(tokenId);
  if (!result.revoked) throw error(404, 'grant not found');
  return json({
    token_id: tokenId,
    revoked: true,
    grant: result.grant
  });
};
