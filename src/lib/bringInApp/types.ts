/**
 * Client-side type mirror of the server's `BringInTarget` + `RoomContextPayload`.
 *
 * Kept in `src/lib/bringInApp/` (client-shared) so SSR loaders + browser
 * components can import without pulling server modules. The canonical
 * shapes live at `src/lib/server/bringInAppStore.ts`; this file mirrors
 * them deliberately so client code doesn't reach into server modules.
 */

export type BringInTarget =
  | 'claude-desktop'
  | 'claude-mobile'
  | 'chatgpt'
  | 'codex-desktop'
  | 'gemini';

export type RoomContextPayload = {
  roomId: string;
  roomName: string;
  roomDescription: string | null;
  recentMessagesMarkdown: string;
  openAsksMarkdown: string | null;
  generatedAtMs: number;
};

export type BringInAppResponse = {
  launchId: string;
  target: BringInTarget;
  launchedAtMs: number;
  payload: RoomContextPayload;
};
