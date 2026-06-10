/** Human-friendly token counts for usage lines: 950 → "950",
 *  12_345 → "12.3K", 4_200_000 → "4.2M". Kept tiny + dependency-free
 *  so both local providers can share it. JWPK 2026-06-10. */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0';
  if (count < 1_000) return String(Math.trunc(count));
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
