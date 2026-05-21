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
 * Implementation note: uses execFileSync from node:child_process for ps
 * subprocess calls. ps reads /proc-like data on macOS; no shell, no
 * arguments interpolated, no injection surface.
 */

import { execFileSync } from 'node:child_process';

const MAX_CHAIN_DEPTH = 32;

function readProcessStartTime(pid) {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function readParentPid(pid) {
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
