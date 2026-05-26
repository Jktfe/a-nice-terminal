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
  const withoutQuotes = body.replace(/"[^"]*"/g, '""');
  return BARE_EVERYONE_PATTERN.test(withoutQuotes);
}

export function listBareMentionHandles(body: string): string[] {
  // Strip content inside double quotes so @mentions inside quoted
  // text are not treated as routing directives (JWPK msg_5xglxgebc6).
  const withoutQuotes = body.replace(/"[^"]*"/g, '""');
  const handles: string[] = [];
  for (const match of withoutQuotes.matchAll(BARE_HANDLE_PATTERN)) {
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
