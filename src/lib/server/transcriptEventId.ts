/**
 * transcriptEventId — V4-BLOCKER-B idempotency key helper.
 *
 * Each transcript-tail mapper emits 0+ events per JSONL line. The native
 * per-line id (claude uuid / qwen uuid / gemini id / copilot id / pi id)
 * makes restart re-reads idempotent via the partial UNIQUE index. Codex
 * rollout lines have NO native id, so we fall back to a stable content
 * hash of the raw line. Per-event suffix `#<index>` disambiguates the
 * multiple events a single line can produce (thinking + text + tool_call).
 */

// djb2 — small, deterministic, good enough for collision-resistance of
// distinct JSONL lines within one terminal. Hex-encoded.
function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

/**
 * Build the per-event idempotency key.
 *   nativeId present → `<nativeId>#<index>`
 *   nativeId absent  → `h<hash-of-rawLine>#<index>`
 */
export function transcriptEventKey(
  nativeId: string | null | undefined,
  rawLine: string,
  index: number
): string {
  const base = nativeId && nativeId.length > 0 ? nativeId : `h${djb2(rawLine)}`;
  return `${base}#${index}`;
}
