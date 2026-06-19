const SAFE_FRAGMENT_CHAR = /^[A-Za-z0-9_-]$/;

function fragmentSafeToken(value: string): string {
  let output = '';
  for (const char of value) {
    if (SAFE_FRAGMENT_CHAR.test(char)) {
      output += char;
      continue;
    }
    const codePoint = char.codePointAt(0);
    output += codePoint === undefined ? '_' : `_${codePoint.toString(16)}_`;
  }
  return output || 'unknown';
}

export function terminalAnchorId(sessionId: string): string {
  return `term-${fragmentSafeToken(sessionId)}`;
}

export function terminalHref(sessionId: string): string {
  return `/terminals#${terminalAnchorId(sessionId)}`;
}
