/**
 * Port of v3 cli/lib/identity.ts processIdentityChain — pure functions.
 *
 * Walks the process ancestry from a starting PID up to PID 1, capturing
 * each PID's `lstart` opaque string (preserved verbatim, never parsed) so
 * the server can guard against PID reuse via the (pid, pid_start) tuple.
 *
 * Used by:
 *   - scripts/ant-cli-register.mjs (sends chain to /api/identity/register)
 *   - scripts/ant-cli-register.mjs (sends chain to /api/identity/resolve)
 *   - server-side as the chain-walk source-of-truth for lookups.
 *
 * Chain walk is DEFAULT-ON per PTY-INJECT-0 v2 doc Q8 — no --chain opt-in.
 *
 * Platform branches (Xeno windows-cli-auth-wedge-2026-05-22 diagnosis):
 *   - darwin / linux: `ps -o {lstart,ppid}= -p <pid>` — single-syscall, no shell
 *   - win32 / MSYS2 / git-bash: `powershell.exe -NoProfile -Command
 *     "Get-CimInstance Win32_Process -Filter 'ProcessId=N' | ForEach-Object {
 *     [PSCustomObject]@{ ProcessId=$_.ProcessId; ParentProcessId=$_.ParentProcessId;
 *     CreationDate=$_.CreationDate.ToString('o') } } | ConvertTo-Json -Compress"`.
 *     The `.ToString('o')` step is load-bearing: PowerShell's default
 *     ConvertTo-Json serialises System.DateTime as the legacy .NET
 *     DataContract form `/Date(unix-ms)/`, NOT ISO 8601 — that broke the
 *     server's (pid, pid_start) tuple-comparison on 0.1.6 (Xeno smoke
 *     2026-05-22 returned 10-deep chains with `/Date(MS)/` timestamps).
 *     `.ToString('o')` forces the .NET round-trip ISO 8601 format
 *     (sub-second precision + UTC offset) BEFORE JSON serialisation.
 *     Chose CIM over `wmic` because wmic is deprecated in Win 11
 *     (still ships, Microsoft can pull any quarter); per-call overhead
 *     is ~150-200ms cold but durable across Win versions.
 *
 * No shell, no arg interpolation; PIDs cast to String() before exec.
 */

import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

const MAX_CHAIN_DEPTH = 32;
const IS_WINDOWS = platform() === 'win32';

// ─── POSIX (darwin / linux / MSYS2-with-real-ps) ─────────────────────

function readProcessStartTimePosix(pid) {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function readParentPidPosix(pid) {
  try {
    const raw = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { stdio: 'pipe' })
      .toString()
      .trim();
    const parent = Number(raw);
    return Number.isFinite(parent) && parent > 0 ? parent : null;
  } catch {
    return null;
  }
}

// ─── Windows (CIM via PowerShell) ───────────────────────────────────

/** Cache one CIM lookup per (pid) so the chain walk's two helpers
 *  (start-time + ppid) don't pay 2× the ~150ms CIM cold cost per hop. */
const winCimCache = new Map();

function readWindowsProcessRecord(pid) {
  if (winCimCache.has(pid)) return winCimCache.get(pid);
  let record = null;
  try {
    const stdout = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}' | ForEach-Object { [PSCustomObject]@{ ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; CreationDate = $_.CreationDate.ToString('o') } } | ConvertTo-Json -Compress`
      ],
      { stdio: 'pipe', windowsHide: true }
    ).toString().trim();
    if (stdout.length > 0) {
      const parsed = JSON.parse(stdout);
      // CreationDate is now a clean ISO 8601 string via .ToString('o')
      // in the PS pipeline above — round-trips verbatim into the
      // server's (pid, pid_start) tuple. Object form retained as a
      // safety fallback in case a future PS edition wraps the string.
      record = {
        ppid: Number.isFinite(parsed?.ParentProcessId) ? parsed.ParentProcessId : null,
        startTime: parsed?.CreationDate ?? null
      };
    }
  } catch {
    record = null;
  }
  winCimCache.set(pid, record);
  return record;
}

function readProcessStartTimeWindows(pid) {
  const record = readWindowsProcessRecord(pid);
  if (!record) return null;
  if (typeof record.startTime === 'string') return record.startTime;
  // Some PowerShell builds emit { value: "ISO", DisplayHint: ... } when
  // serialising DateTime. Flatten if so.
  if (record.startTime && typeof record.startTime === 'object' && typeof record.startTime.value === 'string') {
    return record.startTime.value;
  }
  return null;
}

function readParentPidWindows(pid) {
  const record = readWindowsProcessRecord(pid);
  return record && Number.isFinite(record.ppid) && record.ppid > 0 ? record.ppid : null;
}

// ─── Public API (platform-switched) ─────────────────────────────────

function readProcessStartTime(pid) {
  return IS_WINDOWS ? readProcessStartTimeWindows(pid) : readProcessStartTimePosix(pid);
}

function readParentPid(pid) {
  return IS_WINDOWS ? readParentPidWindows(pid) : readParentPidPosix(pid);
}

export function pidStart(pid) {
  return readProcessStartTime(pid);
}

export function parentPid(pid) {
  return readParentPid(pid);
}

export function processIdentityChain(startPid, maxDepth) {
  const startingPid = startPid ?? process.pid;
  const cap = maxDepth ?? MAX_CHAIN_DEPTH;
  const chain = [];
  const visited = new Set();
  let cursor = startingPid;
  while (cursor && cursor > 1 && !visited.has(cursor) && chain.length < cap) {
    visited.add(cursor);
    chain.push({ pid: cursor, pid_start: readProcessStartTime(cursor) });
    cursor = readParentPid(cursor);
  }
  return chain;
}
