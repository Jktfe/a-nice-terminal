/**
 * defaultCataloguesStore — server-side canonical lists for the model +
 * agent-kind chips (JWPK 2026-05-31).
 *
 * Replaces the browser-only localStorage stores
 * (src/lib/stores/{agentKinds,modelKinds}.svelte.ts) so the defaults are
 * durable, shared across devices, and part of the substrate. The client
 * stores now hydrate from /api/default-models and /api/default-agent-kinds
 * (which call into this module) and fall back to a localStorage cache only
 * when the server is unreachable.
 *
 * Tables (see db.ts V02_SCHEMA_DDL_STATEMENTS — "Catalogue Layer"):
 *   default_models(name PK, provider, runs_where, default_on, sort_order,
 *                  logo_slug, created_at_ms, updated_at_ms)
 *   default_agent_kinds(name PK, provider, default_on, sort_order,
 *                  logo_slug, created_at_ms, updated_at_ms)
 *
 * Seeding: the canonical defaults below mirror scripts/seed-default-
 * catalogues.mjs (kept in sync deliberately — the .mjs runs against an
 * existing live DB without a server rebuild; this runs on bootstrap). Both
 * use INSERT OR IGNORE so they never clobber a row the user has edited.
 *
 * logo_slug references src/lib/icons/llmLogoCatalogue.ts.
 */

import { getIdentityDb } from './db';

export type DefaultModelRow = {
  name: string;
  provider: string | null;
  runs_where: 'cloud' | 'local' | null;
  default_on: number;
  sort_order: number;
  logo_slug: string | null;
};

export type DefaultAgentKindRow = {
  name: string;
  provider: string | null;
  default_on: number;
  sort_order: number;
  logo_slug: string | null;
};

// [name, provider, runs_where, logo_slug]
const MODEL_DEFAULTS: ReadonlyArray<[string, string, 'cloud' | 'local', string]> = [
  ['kimi', 'Moonshot', 'cloud', 'kimi-icon.svg'],
  ['codex', 'OpenAI', 'cloud', 'codex-icon.svg'],
  ['gpt-5', 'OpenAI', 'cloud', 'openai-icon.svg'],
  ['qwen', 'Alibaba', 'cloud', 'qwen-icon.svg'],
  ['claude', 'Anthropic', 'cloud', 'claude-icon.svg'],
  ['gemini', 'Google', 'cloud', 'gemini-icon.svg'],
  ['gemma', 'Google', 'local', 'gemma-icon.svg'],
  ['qwen-cloud', 'Alibaba', 'cloud', 'qwen-icon.svg'],
  ['gemma4-local', 'Google', 'local', 'gemma-icon.svg'],
  ['gpt-oss', 'OpenAI', 'local', 'openai-icon.svg'],
  ['Ollama-other-cloud', 'Ollama', 'cloud', 'ollama-icon.svg'],
  ['Other-local', 'generic', 'local', 'lmstudio-icon.svg']
];

// [name, provider, logo_slug]
const AGENT_KIND_DEFAULTS: ReadonlyArray<[string, string, string]> = [
  ['pi', 'Pi Coding Agent', 'pi-coding-agent-icon.svg'],
  ['qwen', 'Qwen', 'qwen-icon.svg'],
  ['copilot', 'GitHub Copilot', 'copilot-icon.svg'],
  ['codex', 'OpenAI Codex', 'codex-icon.svg'],
  ['claude', 'Claude Code', 'claudecode-icon.svg'],
  ['perspective', 'Perspective Intelligence', 'perspective-intelligence-icon.svg'],
  ['antigravity', 'Antigravity (Google)', 'antigravity-icon.svg']
];

export const DEFAULT_MODEL_NAMES: readonly string[] = MODEL_DEFAULTS.map((r) => r[0]);
export const DEFAULT_AGENT_KIND_NAMES: readonly string[] = AGENT_KIND_DEFAULTS.map((r) => r[0]);

const MODEL_META = new Map(MODEL_DEFAULTS.map(([name, provider, runs, logo]) => [name, { provider, runs, logo }]));
const KIND_META = new Map(AGENT_KIND_DEFAULTS.map(([name, provider, logo]) => [name, { provider, logo }]));

// Terminals v3 (JWPK msg_om51nvohx5 + msg_mc8rejzopg 2026-06-11): account
// types and model families are user-editable, settings-persisted lists — same
// shape as the kinds/models catalogues, but name-only (no provider/logo). The
// table name is a fixed constant, never caller input, so the dynamic-name
// queries below carry no injection surface.
const SIMPLE_CATALOGUES = {
  account_types: [
    'Claude Subscription', 'Codex Subscription', 'Ollama Subscription',
    'Gemini Subscription', 'Qwen Subscription', 'Quiver Subscription',
    'Copilot Subscription', 'Local', 'External'
  ],
  model_families: [
    'Claude', 'Codex', 'MiniMax', 'Kimi', 'Qwen', 'glm', 'Gemini', 'Quiver',
    'Gemma', 'GPT-OSS', 'AFM', 'Other-Ollama-Cloud', 'Other-Cloud', 'Other-Local'
  ]
} as const;
export type SimpleCatalogue = keyof typeof SIMPLE_CATALOGUES;
const SIMPLE_TABLE: Record<SimpleCatalogue, string> = {
  account_types: 'default_account_types',
  model_families: 'default_model_families'
};

function ensureTables(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS default_models (
      name TEXT PRIMARY KEY, provider TEXT,
      runs_where TEXT CHECK (runs_where IS NULL OR runs_where IN ('cloud','local')),
      default_on INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL,
      logo_slug TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS default_agent_kinds (
      name TEXT PRIMARY KEY, provider TEXT,
      default_on INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL,
      logo_slug TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS default_account_types (
      name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS default_model_families (
      name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
    );
  `);
}

export function listSimpleCatalogue(cat: SimpleCatalogue, db = getIdentityDb()): string[] {
  ensureTables(db);
  const t = SIMPLE_TABLE[cat];
  return (db.prepare(`SELECT name FROM ${t} ORDER BY sort_order, name`).all() as { name: string }[])
    .map((r) => r.name);
}

export function addSimpleCatalogueEntry(cat: SimpleCatalogue, name: string, db = getIdentityDb()): string[] {
  ensureTables(db);
  const trimmed = name.trim();
  if (trimmed.length === 0) return listSimpleCatalogue(cat, db);
  const t = SIMPLE_TABLE[cat];
  const now = Date.now();
  const next = (db.prepare(`SELECT COALESCE(MAX(sort_order),0)+1 n FROM ${t}`).get() as { n: number }).n;
  db.prepare(`INSERT OR IGNORE INTO ${t} (name, sort_order, created_at_ms, updated_at_ms) VALUES (?,?,?,?)`)
    .run(trimmed, next, now, now);
  return listSimpleCatalogue(cat, db);
}

export function removeSimpleCatalogueEntry(cat: SimpleCatalogue, name: string, db = getIdentityDb()): string[] {
  ensureTables(db);
  db.prepare(`DELETE FROM ${SIMPLE_TABLE[cat]} WHERE name = ?`).run(name);
  return listSimpleCatalogue(cat, db);
}

export function replaceSimpleCatalogue(cat: SimpleCatalogue, names: string[], db = getIdentityDb()): string[] {
  ensureTables(db);
  const t = SIMPLE_TABLE[cat];
  const now = Date.now();
  const ins = db.prepare(`INSERT OR IGNORE INTO ${t} (name, sort_order, created_at_ms, updated_at_ms) VALUES (?,?,?,?)`);
  db.transaction(() => {
    db.prepare(`DELETE FROM ${t}`).run();
    names.map((n) => n.trim()).filter((n) => n.length > 0).forEach((n, i) => ins.run(n, i + 1, now, now));
  })();
  return listSimpleCatalogue(cat, db);
}

/** Seed the canonical defaults if (and only if) a table is empty. Safe to
 *  call on every bootstrap — never overwrites or re-adds user-removed rows
 *  once the table is non-empty. */
export function seedDefaultCataloguesIfEmpty(db = getIdentityDb()): void {
  ensureTables(db);
  const now = Date.now();
  const modelCount = (db.prepare('SELECT COUNT(*) c FROM default_models').get() as { c: number }).c;
  if (modelCount === 0) {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO default_models
         (name, provider, runs_where, default_on, sort_order, logo_slug, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
    );
    const tx = db.transaction(() => {
      MODEL_DEFAULTS.forEach(([name, provider, runs, logo], i) => ins.run(name, provider, runs, i + 1, logo, now, now));
    });
    tx();
  }
  const kindCount = (db.prepare('SELECT COUNT(*) c FROM default_agent_kinds').get() as { c: number }).c;
  if (kindCount === 0) {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO default_agent_kinds
         (name, provider, default_on, sort_order, logo_slug, created_at_ms, updated_at_ms)
       VALUES (?, ?, 1, ?, ?, ?, ?)`
    );
    const tx = db.transaction(() => {
      AGENT_KIND_DEFAULTS.forEach(([name, provider, logo], i) => ins.run(name, provider, i + 1, logo, now, now));
    });
    tx();
  }
  for (const cat of Object.keys(SIMPLE_CATALOGUES) as SimpleCatalogue[]) {
    const t = SIMPLE_TABLE[cat];
    if ((db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c > 0) continue;
    const ins = db.prepare(`INSERT OR IGNORE INTO ${t} (name, sort_order, created_at_ms, updated_at_ms) VALUES (?,?,?,?)`);
    db.transaction(() => {
      SIMPLE_CATALOGUES[cat].forEach((name, i) => ins.run(name, i + 1, now, now));
    })();
  }
}

export function listDefaultModels(db = getIdentityDb()): DefaultModelRow[] {
  ensureTables(db);
  return db
    .prepare(
      `SELECT name, provider, runs_where, default_on, sort_order, logo_slug
         FROM default_models ORDER BY sort_order, name`
    )
    .all() as DefaultModelRow[];
}

export function listDefaultAgentKinds(db = getIdentityDb()): DefaultAgentKindRow[] {
  ensureTables(db);
  return db
    .prepare(
      `SELECT name, provider, default_on, sort_order, logo_slug
         FROM default_agent_kinds ORDER BY sort_order, name`
    )
    .all() as DefaultAgentKindRow[];
}

function nextSortOrder(db: ReturnType<typeof getIdentityDb>, table: string): number {
  const row = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) m FROM ${table}`).get() as { m: number };
  return row.m + 1;
}

export function addDefaultModel(name: string, db = getIdentityDb()): DefaultModelRow[] {
  ensureTables(db);
  const trimmed = name.trim();
  if (!trimmed) return listDefaultModels(db);
  const meta = MODEL_META.get(trimmed);
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO default_models
       (name, provider, runs_where, default_on, sort_order, logo_slug, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(trimmed, meta?.provider ?? null, meta?.runs ?? null, nextSortOrder(db, 'default_models'), meta?.logo ?? null, now, now);
  return listDefaultModels(db);
}

export function addDefaultAgentKind(name: string, db = getIdentityDb()): DefaultAgentKindRow[] {
  ensureTables(db);
  const trimmed = name.trim();
  if (!trimmed) return listDefaultAgentKinds(db);
  const meta = KIND_META.get(trimmed);
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO default_agent_kinds
       (name, provider, default_on, sort_order, logo_slug, created_at_ms, updated_at_ms)
     VALUES (?, ?, 1, ?, ?, ?, ?)`
  ).run(trimmed, meta?.provider ?? null, nextSortOrder(db, 'default_agent_kinds'), meta?.logo ?? null, now, now);
  return listDefaultAgentKinds(db);
}

export function removeDefaultModel(name: string, db = getIdentityDb()): DefaultModelRow[] {
  ensureTables(db);
  db.prepare('DELETE FROM default_models WHERE name = ?').run(name);
  return listDefaultModels(db);
}

export function removeDefaultAgentKind(name: string, db = getIdentityDb()): DefaultAgentKindRow[] {
  ensureTables(db);
  db.prepare('DELETE FROM default_agent_kinds WHERE name = ?').run(name);
  return listDefaultAgentKinds(db);
}

/** Replace the whole set, in the given order. Used by "Reset to defaults"
 *  and (future) drag-reorder. Unknown names get provider/logo enriched from
 *  the canonical defaults where possible, else null. */
export function replaceDefaultModels(names: string[], db = getIdentityDb()): DefaultModelRow[] {
  ensureTables(db);
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM default_models').run();
    const ins = db.prepare(
      `INSERT OR IGNORE INTO default_models
         (name, provider, runs_where, default_on, sort_order, logo_slug, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
    );
    names.map((n) => n.trim()).filter(Boolean).forEach((n, i) => {
      const meta = MODEL_META.get(n);
      ins.run(n, meta?.provider ?? null, meta?.runs ?? null, i + 1, meta?.logo ?? null, now, now);
    });
  });
  tx();
  return listDefaultModels(db);
}

export function replaceDefaultAgentKinds(names: string[], db = getIdentityDb()): DefaultAgentKindRow[] {
  ensureTables(db);
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM default_agent_kinds').run();
    const ins = db.prepare(
      `INSERT OR IGNORE INTO default_agent_kinds
         (name, provider, default_on, sort_order, logo_slug, created_at_ms, updated_at_ms)
       VALUES (?, ?, 1, ?, ?, ?, ?)`
    );
    names.map((n) => n.trim()).filter(Boolean).forEach((n, i) => {
      const meta = KIND_META.get(n);
      ins.run(n, meta?.provider ?? null, i + 1, meta?.logo ?? null, now, now);
    });
  });
  tx();
  return listDefaultAgentKinds(db);
}

export const CANONICAL_MODEL_DEFAULTS = MODEL_DEFAULTS;
export const CANONICAL_AGENT_KIND_DEFAULTS = AGENT_KIND_DEFAULTS;
