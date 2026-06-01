#!/usr/bin/env node
/**
 * seed-default-catalogues.mjs — create + seed the server-side default
 * model / agent-kind catalogue tables.
 *
 * JWPK 2026-05-31: the model + agent-kind chip lists used to live only in
 * browser localStorage (see src/lib/stores/agentKinds.svelte.ts). That made
 * them per-browser and invisible to the substrate. This moves the canonical
 * defaults into two server-side tables so they survive, are shared, and can
 * be edited centrally.
 *
 * Idempotent + additive:
 *   - CREATE TABLE IF NOT EXISTS (never drops / rewrites existing data)
 *   - INSERT OR IGNORE per row (re-runs add only missing rows; never clobbers
 *     edits to rows that already exist)
 *
 * Usage:  node scripts/seed-default-catalogues.mjs [dbPath]
 *   dbPath defaults to ~/.ant/fresh-ant.db
 *
 * Logo slugs reference src/lib/icons/llmLogoCatalogue.ts (files under
 * /static/llm-icons/). `gemma-icon.svg` is added alongside this change.
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dbPath = process.argv[2] || join(homedir(), '.ant', 'fresh-ant.db');

// [name, provider, runs_where, logo_slug] — order is the array index + 1
const DEFAULT_MODELS = [
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
const DEFAULT_AGENT_KINDS = [
  ['pi', 'Pi Coding Agent', 'pi-coding-agent-icon.svg'],
  ['qwen', 'Qwen', 'qwen-icon.svg'],
  ['copilot', 'GitHub Copilot', 'copilot-icon.svg'],
  ['codex', 'OpenAI Codex', 'codex-icon.svg'],
  ['claude', 'Claude Code', 'claudecode-icon.svg'],
  ['perspective', 'Perspective Intelligence', 'perspective-intelligence-icon.svg'],
  ['antigravity', 'Antigravity (Google)', 'antigravity-icon.svg']
];

export function ensureDefaultCatalogues(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS default_models (
      name TEXT PRIMARY KEY,
      provider TEXT,
      runs_where TEXT,
      default_on INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL,
      logo_slug TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS default_agent_kinds (
      name TEXT PRIMARY KEY,
      provider TEXT,
      default_on INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL,
      logo_slug TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);

  const now = Date.now();
  const insModel = db.prepare(
    `INSERT OR IGNORE INTO default_models
       (name, provider, runs_where, default_on, sort_order, logo_slug, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
  );
  const insKind = db.prepare(
    `INSERT OR IGNORE INTO default_agent_kinds
       (name, provider, default_on, sort_order, logo_slug, created_at_ms, updated_at_ms)
     VALUES (?, ?, 1, ?, ?, ?, ?)`
  );

  const seed = db.transaction(() => {
    DEFAULT_MODELS.forEach(([name, provider, runs, logo], i) =>
      insModel.run(name, provider, runs, i + 1, logo, now, now)
    );
    DEFAULT_AGENT_KINDS.forEach(([name, provider, logo], i) =>
      insKind.run(name, provider, i + 1, logo, now, now)
    );
  });
  seed();
}

// Run directly (not when imported).
const isEntry = process.argv[1] && process.argv[1].endsWith('seed-default-catalogues.mjs');
if (isEntry) {
  const db = new Database(dbPath);
  ensureDefaultCatalogues(db);
  const models = db.prepare('SELECT COUNT(*) c FROM default_models').get().c;
  const kinds = db.prepare('SELECT COUNT(*) c FROM default_agent_kinds').get().c;
  console.log(`[seed] ${dbPath}`);
  console.log(`[seed] default_models rows: ${models}`);
  console.log(`[seed] default_agent_kinds rows: ${kinds}`);
  db.close();
}
