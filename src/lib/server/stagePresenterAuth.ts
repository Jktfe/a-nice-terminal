import { error } from '@sveltejs/kit';
import {
  requireChatRoomMutationAuth,
  type ChatRoomMutationAuthResult
} from './chatRoomAuthGate';

export type StagePresenterAuthResult = ChatRoomMutationAuthResult & {
  isDeckPassword: boolean;
};

/**
 * Auth gate for Stage presenter actions.
 *
 * Stage is not general room mutation. A presenter who opened a deck through
 * its share password must be able to submit pause/feedback events for that
 * deck, while normal room/admin callers keep the stricter room mutation path.
 */
export function requireStagePresenterAuth(args: {
  roomId: string;
  deckAccessPassword: string | null;
  request: Request;
  url: URL;
  rawBody: unknown;
}): StagePresenterAuthResult {
  const providedPassword = args.url.searchParams.get('password');
  if (providedPassword !== null && providedPassword !== '') {
    if (args.deckAccessPassword !== null && providedPassword === args.deckAccessPassword) {
      return {
        handle: '@stage-presenter',
        isAdminBearer: false,
        isDeckPassword: true
      };
    }
    throw error(403, 'Incorrect deck password.');
  }

  const auth = requireChatRoomMutationAuth(args.roomId, args.request, args.rawBody);
  return { ...auth, isDeckPassword: false };
}
