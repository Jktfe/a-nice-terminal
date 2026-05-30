/**
 * Typed shape of the open-usage daemon payload from
 * `GET http://127.0.0.1:6736/v1/usage`.
 *
 * JWPK msg_300r0u8dlx + msg_4rbn05cztw antV4 2026-05-28: surface this
 * shape on /terminals (top strip + per-card badge) AND snapshot every
 * 12 h for trend history.
 *
 * Lives under src/lib/usage so both server (proxy + snapshot store)
 * and client (UsageStrip / UsageBadge) can import without crossing
 * the $lib/server boundary.
 */

/** Progress-style line: a 0..limit value with a format hint and an
 *  optional reset clock. Used for session/weekly quotas + credit
 *  counts where a bar makes sense. */
export type UsageProgressLine = {
  type: 'progress';
  label: string;
  used: number;
  limit: number;
  format: { kind: 'percent' } | { kind: 'count'; suffix?: string };
  /** ISO-8601 reset timestamp, or null when the meter does not reset. */
  resetsAt: string | null;
  /** Window length in ms — useful for inferring whether a "Weekly"
   *  label is actually weekly. Null when not applicable. */
  periodDurationMs: number | null;
  color: string | null;
};

/** Text-style line: a pre-formatted human value (e.g. "$303.83 · 410M
 *  tokens"). No structured used/limit, just a label + value pair. */
export type UsageTextLine = {
  type: 'text';
  label: string;
  value: string;
  color: string | null;
  subtitle: string | null;
};

export type UsageLine = UsageProgressLine | UsageTextLine;

/** One provider's slice of the payload. providerId is the join key
 *  against TerminalRecord.agentKind ("claude", "codex", "copilot",
 *  "antigravity", "perplexity", …). plan / lines / fetchedAt all
 *  come straight from the open-usage daemon. */
export type UsageProvider = {
  providerId: string;
  displayName: string;
  plan: string | null;
  lines: UsageLine[];
  /** ISO-8601 timestamp the open-usage daemon last fetched from the
   *  upstream provider — distinct from the time WE fetched the proxy. */
  fetchedAt: string;
};

/** Full daemon payload. The daemon returns a bare array; we wrap it
 *  in an object so the proxy can attach metadata (proxyFetchedAt,
 *  daemonReachable) without changing the line/provider shapes. */
export type UsagePayload = {
  providers: UsageProvider[];
  /** ISO-8601 timestamp the ANT server last successfully fetched the
   *  daemon. null when the daemon has never been reachable. */
  proxyFetchedAt: string | null;
  /** True when the most recent fetch succeeded. When false, providers
   *  may still contain stale data from the in-memory cache. */
  daemonReachable: boolean;
};

/** Type guard for the progress-line shape — used when the strip wants
 *  to render bars only from progress lines. */
export function isProgressLine(line: UsageLine): line is UsageProgressLine {
  return line.type === 'progress';
}

/** Type guard for the text-line shape. */
export function isTextLine(line: UsageLine): line is UsageTextLine {
  return line.type === 'text';
}

/** Heuristic: find the "Session" progress line on a provider. The
 *  open-usage daemon labels it "Session" on every provider that has
 *  one, but we match case-insensitively to survive future label
 *  drift (e.g. "session quota"). Returns null when no session-style
 *  line exists (e.g. perplexity returns only text lines). */
export function findSessionLine(provider: UsageProvider): UsageProgressLine | null {
  for (const line of provider.lines) {
    if (isProgressLine(line) && /session/i.test(line.label)) return line;
  }
  return null;
}

/** Heuristic: find the "Today" text line — present on claude + codex
 *  + others that report daily spend. Returns null when absent. */
export function findTodayLine(provider: UsageProvider): UsageTextLine | null {
  for (const line of provider.lines) {
    if (isTextLine(line) && /today/i.test(line.label)) return line;
  }
  return null;
}

/** Map an ANT terminal's agentKind to an open-usage providerId.
 *  The match is permissive: case-insensitive substring against
 *  known providers so "claude-code" / "codex-cli" / "Copilot" all
 *  resolve. Returns null when no provider matches (so callers can
 *  hide the badge cleanly). */
export function agentKindToProviderId(
  agentKind: string | null | undefined,
  providers: readonly UsageProvider[]
): string | null {
  if (!agentKind) return null;
  const needle = agentKind.toLowerCase();
  for (const provider of providers) {
    if (needle.includes(provider.providerId.toLowerCase())) return provider.providerId;
  }
  return null;
}
