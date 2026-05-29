/**
 * pidStartNormaliser — shared helper that converts every flavour of
 * pid_start (process start-time) value into ISO 8601 form before the
 * server writes it to / compares against `terminals.pid_start`.
 *
 * BACKGROUND (2026-05-29):
 *
 *   - On macOS / Linux the CLI reads `ps -o lstart= -p <pid>`, whose
 *     output is a LOCALE-FORMATTED string with no stable ordering of
 *     weekday / month / day across systems. Two boxes whose clocks agree
 *     to the millisecond can emit:
 *
 *         "Fri 29 May 11:11:24 2026"     (LC_TIME=en_GB.UTF-8)
 *         "Thu May 29 11:11:24 2026"     (LC_TIME=en_US.UTF-8)
 *         "Fri 29 May 11:11:24 2026"     (Apple default, GB-leaning)
 *
 *     The READ-side of the identity store does `WHERE pid_start = ?`
 *     exact-string-equality, so the same wall-clock moment recorded under
 *     different locales / OSes / shells produces DIFFERENT keys and
 *     pidChain lookup silently fails. This caused the 2026-05-29 4-hour
 *     silence forensic across 19 agents.
 *
 *   - On Windows the CLI already calls PowerShell with
 *     `$_.CreationDate.ToString('o')` which is .NET's ISO 8601 round-trip
 *     format. Those values arrive containing a literal 'T' and need no
 *     conversion (re-parsing strips sub-second precision + timezone
 *     offset, which we want to preserve verbatim).
 *
 * CONTRACT:
 *
 *   - null / empty / non-string input → null (callers must tolerate this:
 *     `lookupTerminalByPidChain` already treats null pid_start as a
 *     wildcard and `upsertTerminal` accepts null).
 *   - input already containing 'T' (Windows-style ISO 8601) → trimmed
 *     input verbatim (no re-parse — preserves sub-second + offset).
 *   - otherwise: `new Date(raw).toISOString()` (UTC 'Z' form). Garbage
 *     that the Date constructor can't parse returns null (never throws).
 *
 * INVARIANT: write-side AND read-side AND CLI-client-side all run through
 * this function. That way the DB only ever stores ISO 8601 and the
 * comparison value is ISO 8601 too. Belt-and-braces — the CLI also
 * normalises before sending the chain over the wire (see
 * `scripts/ant-cli-identity-chain.mjs`).
 */
// ISO 8601 has the shape YYYY-MM-DDT... — a digit-digit-digit-digit-dash
// prefix followed by 'T' some chars in. Matches:
//   "2026-05-29T11:11:24.000Z"
//   "2026-05-29T11:11:24.1234567+01:00"
// Does NOT match "Thu May 29 11:11:24 2026" (locale strings have a
// weekday word at the start). This is the safe discriminator — a
// substring search for 'T' wrongly matched "Thu" in our first pass.
const ISO_8601_PREFIX = /^\d{4}-\d{2}-\d{2}T/;

export function normalisePidStartToIso8601(
  raw: string | null | undefined
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Windows already-ISO branch — preserves sub-second precision and any
  // explicit timezone offset that the Date round-trip would discard.
  if (ISO_8601_PREFIX.test(trimmed)) return trimmed;
  // POSIX locale-string branch — Date constructor accepts both
  // "Fri 29 May 11:11:24 2026" and "Thu May 29 11:11:24 2026".
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
