/**
 * Server-side mention-routing helpers.
 *
 * Bracketed mentions (`[@handle]`) are informational. Bare mentions
 * (`@handle`) are active routing directives.
 */

const BARE_EVERYONE_PATTERN = /(^|\s)@everyone(?=$|\s|[.,!?;:)\]])/i;
const BARE_HANDLE_PATTERN = /(^|\s)@([A-Za-z0-9_-]+)(?=$|\s|[.,!?;:)\]])/g;
const BRACKETED_HANDLE_PATTERN = /\[@[A-Za-z0-9_-]+\]/;

export function hasBareEveryoneMention(body: string): boolean {
  return BARE_EVERYONE_PATTERN.test(body);
}

export function listBareMentionHandles(body: string): string[] {
  const handles: string[] = [];
  for (const match of body.matchAll(BARE_HANDLE_PATTERN)) {
    const handleBody = match[2];
    if (!handleBody) continue;
    const handle = `@${handleBody}`;
    if (!handles.includes(handle)) handles.push(handle);
  }
  return handles;
}

export function hasBracketedMention(body: string): boolean {
  return BRACKETED_HANDLE_PATTERN.test(body);
}
