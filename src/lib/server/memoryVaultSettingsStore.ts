/**
 * memoryVaultSettingsStore — per-server config for the memory pack vault
 * path. Lives at `~/.ant/memory-vault.json` alongside the rest of the
 * personal-settings family (see also `deckSettingsStore`).
 *
 * Resolution order at read time:
 *   1. `process.env.ANT_MEMORY_VAULT_PATH` — env var wins (operator
 *      can override per-process without touching the settings file).
 *   2. `~/.ant/memory-vault.json` — file-backed config (set via
 *      `ant memory vault set --path <PATH>` once that CLI verb ships).
 *   3. `null` — no path configured; downstream consumers (e.g. the
 *      room-join preamble) must handle the unset case gracefully.
 *
 * NOTHING is hardcoded in the repo. JWPK orsz msg_szk0m5cwqn 2026-05-28:
 * "PULL that for them, saves a round trip; just make sure it isn't
 * hardcoded in the repo". The path that ends up in the room-join
 * preamble is resolved at emission time from this store; the repo
 * itself has no committed vault path.
 *
 * Single-user assumption today: vault path is server-global, not
 * per-user. Multi-user evolves to a user-scoped config table when
 * the substrate lands. The single-user shape is fine for JWPK's
 * current setup.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type MemoryVaultSettings = {
  /**
   * Absolute path to the user's memory-pack vault. When unset, the
   * downstream resolver returns null and consumers handle it (the
   * room-join preamble shows an instruction to set the path).
   */
  vaultPath: string | null;
};

const EMPTY: MemoryVaultSettings = { vaultPath: null };

// Lazy-resolved so tests can re-route HOME between cases. Reading the path
// each call is cheap and avoids module-load-time coupling to a single
// HOME value.
function settingsFilePath(): string {
  return join(homedir(), '.ant', 'memory-vault.json');
}

function readSettingsFile(): MemoryVaultSettings {
  const path = settingsFilePath();
  if (!existsSync(path)) return EMPTY;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const candidate = (parsed as Record<string, unknown>).vaultPath;
      const vaultPath =
        typeof candidate === 'string' && candidate.trim().length > 0
          ? candidate.trim()
          : null;
      return { vaultPath };
    }
  } catch {
    // Malformed file shouldn't crash callers — treat as empty.
  }
  return EMPTY;
}

/**
 * Resolve the memory-vault path with env-var precedence over the
 * settings file. Returns null when neither source has a value, so
 * downstream callers can branch on the unset case.
 */
export function resolveMemoryVaultPath(): string | null {
  const envCandidate = process.env.ANT_MEMORY_VAULT_PATH;
  if (typeof envCandidate === 'string' && envCandidate.trim().length > 0) {
    return envCandidate.trim();
  }
  return readSettingsFile().vaultPath;
}

/**
 * Write the vault path to the settings file. Creates `~/.ant/` if
 * needed. Pass `null` (or an empty string) to clear the path; the
 * env var still wins on read if set.
 */
export function writeMemoryVaultPath(path: string | null): void {
  const filePath = settingsFilePath();
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const trimmed =
    typeof path === 'string' && path.trim().length > 0 ? path.trim() : null;
  const settings: MemoryVaultSettings = { vaultPath: trimmed };
  writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/**
 * Read the raw settings file content (env var ignored). Used by
 * `ant memory vault get` to show what's persisted vs what env-override
 * is in play.
 */
export function readMemoryVaultSettings(): MemoryVaultSettings {
  return readSettingsFile();
}
