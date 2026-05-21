/**
 * Pure helpers for slash-command detection in the chat composer.
 *
 * Copied-from: src/lib/components/ChatComposer.svelte:38-47 (M12 break-context)
 * Verdict: KEEP
 * Simplification: lifted to a pure TS module so unit tests can drive the
 *   detection logic without needing a DOM or a Svelte component harness.
 *
 * Backs M03 slice 4 ChatComposer split-before-touch. Mention parsing lives
 * alongside in composerMentions when that lands.
 */

export function looksLikeBreakCommand(rawBody: string): boolean {
  const trimmed = rawBody.trim().toLowerCase();
  return trimmed === '/break' || trimmed.startsWith('/break ');
}

export function reasonFromBreakCommand(rawBody: string): string {
  const trimmed = rawBody.trim();
  const afterSlash = trimmed.slice('/break'.length).trim();
  return afterSlash;
}
