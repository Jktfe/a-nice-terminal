/**
 * deckSettingsStore — persistent storage for the user-editable list of
 * deck roots (ANT_BUILT_DECKS_ROOTS equivalent, editable from /settings).
 *
 * The /d/[slug] route still treats ANT_BUILT_DECKS_ROOTS as the
 * canonical source. This file is the read/write companion that lets
 * an operator edit the list from the in-app Settings panel without
 * touching their shell rc. Merge order in the resolver (see
 * deckRootsResolved below): env var FIRST, file entries SECOND, legacy
 * fallbacks LAST. Each layer is deduped against the previous.
 *
 * Lives in ~/.ant/deck-settings.json alongside the rest of the
 * personal-settings family. Created on first write; absent file is
 * NOT an error (treated as empty roots from the file layer).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type DeckSettings = {
  /**
   * Operator-curated list of absolute paths to deck root folders.
   * Each entry should exist on disk, but we don't validate at write
   * time — the resolver gracefully skips non-existent entries.
   */
  decksRoots: string[];
};

const EMPTY: DeckSettings = { decksRoots: [] };

function defaultSettingsPath(): string {
  return join(homedir(), '.ant', 'deck-settings.json');
}

function safeReadFile(path: string): DeckSettings {
  if (!existsSync(path)) return { ...EMPTY };
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DeckSettings>;
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
    const roots = Array.isArray(parsed.decksRoots)
      ? parsed.decksRoots.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : [];
    return { decksRoots: roots };
  } catch {
    // Malformed JSON is treated as empty rather than throwing — never
    // strand the operator on a corrupt file. Caller can re-write to fix.
    return { ...EMPTY };
  }
}

export function readDeckSettings(filePath: string = defaultSettingsPath()): DeckSettings {
  return safeReadFile(filePath);
}

export function writeDeckSettings(
  input: { decksRoots: unknown },
  filePath: string = defaultSettingsPath()
): DeckSettings {
  if (!Array.isArray(input.decksRoots)) {
    throw new Error('decksRoots must be an array of non-empty strings.');
  }
  const normalised = input.decksRoots
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const next: DeckSettings = { decksRoots: normalised };
  writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

/**
 * The canonical resolver used by /d/[slug]/+server.ts and the API.
 * Merges (in order):
 *   1. ANT_BUILT_DECKS_ROOTS env var (delimiter-split)
 *   2. deck-settings.json `decksRoots` array
 *   3. Legacy fallbacks (~/CascadeProjects/ANT-Decks, ANT-Open-Slide)
 * Deduped while preserving order.
 */
export function deckRootsResolved(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  filePath: string = defaultSettingsPath()
): string[] {
  const envRoots = (env.ANT_BUILT_DECKS_ROOTS ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const fileRoots = readDeckSettings(filePath).decksRoots;
  const fallbacks = [
    join(home, 'CascadeProjects', 'ANT-Decks'),
    join(home, 'CascadeProjects', 'ANT-Open-Slide')
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...envRoots, ...fileRoots, ...fallbacks]) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}
