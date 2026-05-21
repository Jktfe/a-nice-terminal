/**
 * Tiny fuzzy substring matcher for the Cmd-K command palette.
 *
 * "fuzzy" here = every character of `query` appears in `haystack` in
 * order, not necessarily contiguous. So "v4f" matches "v4-fresh-ant".
 * Lowercase normalisation is the caller's responsibility — this keeps
 * the function pure and hot-path-cheap.
 */
export function fuzzyMatch(query: string, haystack: string): boolean {
  if (query.length === 0) return true;
  let cursor = 0;
  for (let i = 0; i < haystack.length; i += 1) {
    if (haystack[i] === query[cursor]) cursor += 1;
    if (cursor === query.length) return true;
  }
  return false;
}
