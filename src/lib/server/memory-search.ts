const MAX_FTS_TERMS = 16;

function quoteFtsTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

export function toSafeMemoryFtsQuery(raw: string): string | null {
  const terms = raw
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((term) => term.trim())
    .filter(Boolean)
    .slice(0, MAX_FTS_TERMS) ?? [];

  if (terms.length === 0) return null;
  return terms.map(quoteFtsTerm).join(' ');
}
