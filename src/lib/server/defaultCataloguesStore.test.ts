/**
 * defaultCataloguesStore tests — exercise the model + agent-kind catalogue
 * CRUD against an in-memory SQLite DB (injected via the optional `db` arg,
 * so no global identity-DB state is touched).
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  seedDefaultCataloguesIfEmpty,
  listDefaultModels,
  listDefaultAgentKinds,
  addDefaultModel,
  addDefaultAgentKind,
  removeDefaultModel,
  removeDefaultAgentKind,
  replaceDefaultModels,
  replaceDefaultAgentKinds,
  DEFAULT_MODEL_NAMES,
  DEFAULT_AGENT_KIND_NAMES
} from './defaultCataloguesStore';

function freshDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Database(':memory:') as any;
}

describe('defaultCataloguesStore', () => {
  it('seeds the canonical defaults when empty, idempotently', () => {
    const db = freshDb();
    seedDefaultCataloguesIfEmpty(db);
    const models = listDefaultModels(db);
    const kinds = listDefaultAgentKinds(db);
    expect(models.map((m) => m.name)).toEqual([...DEFAULT_MODEL_NAMES]);
    expect(kinds.map((k) => k.name)).toEqual([...DEFAULT_AGENT_KIND_NAMES]);
    // re-seed is a no-op (table non-empty)
    seedDefaultCataloguesIfEmpty(db);
    expect(listDefaultModels(db)).toHaveLength(DEFAULT_MODEL_NAMES.length);
  });

  it('carries provider + runs_where + logo from the canonical seed', () => {
    const db = freshDb();
    seedDefaultCataloguesIfEmpty(db);
    const gemma = listDefaultModels(db).find((m) => m.name === 'gemma');
    expect(gemma).toMatchObject({ provider: 'Google', runs_where: 'local', logo_slug: 'gemma-icon.svg' });
    const pi = listDefaultAgentKinds(db).find((k) => k.name === 'pi');
    expect(pi).toMatchObject({ provider: 'Pi Coding Agent', logo_slug: 'pi-coding-agent-icon.svg' });
  });

  it('adds a new model at the end, ignoring duplicates', () => {
    const db = freshDb();
    seedDefaultCataloguesIfEmpty(db);
    const after = addDefaultModel('my-local-llm', db);
    expect(after.at(-1)?.name).toBe('my-local-llm');
    const dup = addDefaultModel('my-local-llm', db);
    expect(dup.filter((m) => m.name === 'my-local-llm')).toHaveLength(1);
  });

  it('enriches a re-added canonical name with its provider/logo', () => {
    const db = freshDb();
    seedDefaultCataloguesIfEmpty(db);
    removeDefaultModel('kimi', db);
    expect(listDefaultModels(db).some((m) => m.name === 'kimi')).toBe(false);
    const after = addDefaultModel('kimi', db);
    expect(after.find((m) => m.name === 'kimi')).toMatchObject({ provider: 'Moonshot', logo_slug: 'kimi-icon.svg' });
  });

  it('removes a single agent kind', () => {
    const db = freshDb();
    seedDefaultCataloguesIfEmpty(db);
    const after = removeDefaultAgentKind('antigravity', db);
    expect(after.some((k) => k.name === 'antigravity')).toBe(false);
    expect(addDefaultAgentKind('antigravity', db).some((k) => k.name === 'antigravity')).toBe(true);
  });

  it('replaces the whole set in order (reset / reorder)', () => {
    const db = freshDb();
    seedDefaultCataloguesIfEmpty(db);
    const order = ['claude', 'codex', 'kimi'];
    const after = replaceDefaultModels(order, db);
    expect(after.map((m) => m.name)).toEqual(order);
    expect(after[0]).toMatchObject({ name: 'claude', provider: 'Anthropic' });
    // reset agent kinds to canonical
    const reset = replaceDefaultAgentKinds([...DEFAULT_AGENT_KIND_NAMES], db);
    expect(reset.map((k) => k.name)).toEqual([...DEFAULT_AGENT_KIND_NAMES]);
  });
});
