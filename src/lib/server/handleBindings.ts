/**
 * Reads the caller's bindings.json file (when present) for the
 * `GET /api/me/mentions` endpoint.
 *
 * Schema is fixed by `CONTRACT.md` in jktfe/ant-accounts
 * (commit 6fa322b, plan_ant_accounts_phase1_design_2026_05_20):
 *
 *   {
 *     "deviceId":   "dev_xxx",
 *     "accountId":  "acct_yyy",
 *     "bindings":   [ { "handle": "@james", "target": "..." } ],
 *     "updatedAtMs": 1716206400000
 *   }
 *
 * Location:
 *   ~/.ant/account/<acct_id>/devices/<dev_id>/bindings.json
 *
 * The Lane-A S3 work that mints these files isn't merged yet, so
 * the file is OPTIONAL — callers fall back to "all chat_room_members
 * handles for this caller". The fallback keeps the mentions endpoint
 * useful pre-S3 and prevents the MCP bridge from being load-bearing
 * on the still-in-flight ant-accounts work.
 *
 * Override the base directory via `ANT_ACCOUNT_DIR` (used by tests so
 * we don't have to write to the user's real $HOME).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Binding = {
  handle: string;
  target?: string;
};

export type BindingsFile = {
  deviceId: string;
  accountId: string;
  bindings: Binding[];
  updatedAtMs: number;
};

/** Resolve the base `~/.ant/account` directory (or the test override). */
function accountBaseDir(): string {
  const override = process.env.ANT_ACCOUNT_DIR?.trim();
  if (override && override.length > 0) return override;
  return join(homedir(), '.ant', 'account');
}

/**
 * Walk `~/.ant/account/*\/devices/*\/bindings.json` and return the
 * first file that successfully parses to the BindingsFile shape.
 *
 * v1 chooses the most recently modified file by mtime — multi-account
 * disambiguation will land alongside the ant-accounts repo cutover.
 * Returns null if no bindings file exists or none parsed cleanly.
 */
export function readBindingsForCurrentUser(): BindingsFile | null {
  const base = accountBaseDir();
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return null;
  }
  let best: { file: BindingsFile; mtimeMs: number } | null = null;
  for (const accountEntry of entries) {
    const accountDir = join(base, accountEntry, 'devices');
    let deviceDirs: string[];
    try {
      deviceDirs = readdirSync(accountDir);
    } catch {
      continue;
    }
    for (const deviceEntry of deviceDirs) {
      const candidate = join(accountDir, deviceEntry, 'bindings.json');
      try {
        const stat = statSync(candidate);
        if (!stat.isFile()) continue;
        const text = readFileSync(candidate, 'utf8');
        const parsed = JSON.parse(text) as unknown;
        if (!isBindingsFile(parsed)) continue;
        if (!best || stat.mtimeMs > best.mtimeMs) {
          best = { file: parsed, mtimeMs: stat.mtimeMs };
        }
      } catch {
        // Missing / unreadable / malformed — skip silently and try the
        // next directory. Caller treats "no readable bindings" as
        // "fall back to chat_room_members".
        continue;
      }
    }
  }
  return best?.file ?? null;
}

function isBindingsFile(value: unknown): value is BindingsFile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.deviceId !== 'string') return false;
  if (typeof v.accountId !== 'string') return false;
  if (!Array.isArray(v.bindings)) return false;
  if (typeof v.updatedAtMs !== 'number') return false;
  for (const candidate of v.bindings) {
    if (!candidate || typeof candidate !== 'object') return false;
    const b = candidate as Record<string, unknown>;
    if (typeof b.handle !== 'string') return false;
    // target is optional in v1 — Lane-A S3 may bind to email / device /
    // session targets; we accept any string or absent.
    if (b.target !== undefined && typeof b.target !== 'string') return false;
  }
  return true;
}

/**
 * Return the lowercased, deduplicated list of handles bound for the
 * current device, or null if no bindings file is readable. Used by the
 * mentions endpoint to gate which `@x` tokens in message bodies count
 * as a mention of the caller.
 */
export function listBoundHandles(): string[] | null {
  const file = readBindingsForCurrentUser();
  if (!file) return null;
  const seen = new Set<string>();
  for (const binding of file.bindings) {
    const normalised = normaliseHandle(binding.handle);
    if (normalised) seen.add(normalised);
  }
  return Array.from(seen);
}

function normaliseHandle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}
