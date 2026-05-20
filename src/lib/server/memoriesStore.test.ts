/**
 * memoriesStore tests — MEMORY-CRUD (2026-05-16).
 *
 * Covers: upsert semantics, audit trail per action, prefix listing with
 * LIKE-escape, scope filtering (incl. NULL-stored global rows), audit
 * key/limit filtering, slash-in-key behaviour.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteMemory,
  getMemory,
  listMemoriesByPrefix,
  listMemoriesForScope,
  listMemoryAudit,
  putMemory,
  resetMemoriesStoreForTests
} from './memoriesStore';

beforeEach(resetMemoriesStoreForTests);
afterEach(resetMemoriesStoreForTests);

describe('memoriesStore', () => {
  it('putMemory inserts a new row and reports created=true', () => {
    const result = putMemory({ key: 'agents/r/role', value: 'design' });
    expect(result.created).toBe(true);
    expect(result.memory.key).toBe('agents/r/role');
    expect(result.memory.value).toBe('design');
    expect(result.memory.scope).toBe('global');
    expect(result.memory.scopeTarget).toBe(null);
  });

  it('putMemory upserts an existing row with created=false on update', () => {
    putMemory({ key: 'k1', value: 'v1', byHandle: '@a' });
    const second = putMemory({ key: 'k1', value: 'v2', byHandle: '@b' });
    expect(second.created).toBe(false);
    expect(second.memory.value).toBe('v2');
    expect(second.memory.lastUpdatedBy).toBe('@b');
    // Original creator is preserved across updates.
    expect(second.memory.createdBy).toBe('@a');
  });

  it('audit trail records put then update with prev_value carried forward', () => {
    putMemory({ key: 'k1', value: 'v1', byHandle: '@a' });
    putMemory({ key: 'k1', value: 'v2', byHandle: '@b' });
    const rows = listMemoryAudit('k1');
    // Newest first.
    expect(rows.map((r) => r.action)).toEqual(['update', 'put']);
    expect(rows[0].prevValue).toBe('v1');
    expect(rows[0].newValue).toBe('v2');
    expect(rows[1].prevValue).toBe(null);
    expect(rows[1].newValue).toBe('v1');
  });

  it('deleteMemory removes the row, records audit with prior value, idempotent', () => {
    putMemory({ key: 'k1', value: 'before' });
    expect(deleteMemory('k1', '@reaper')).toBe(true);
    expect(getMemory('k1')).toBeUndefined();
    expect(deleteMemory('k1')).toBe(false);
    const audit = listMemoryAudit('k1');
    const deleteRow = audit.find((r) => r.action === 'delete');
    expect(deleteRow).toBeDefined();
    expect(deleteRow?.prevValue).toBe('before');
    expect(deleteRow?.byHandle).toBe('@reaper');
  });

  it('blank or non-string key/value are rejected', () => {
    expect(() => putMemory({ key: '   ', value: 'x' })).toThrow(/blank/);
    // @ts-expect-error — verifying runtime guard.
    expect(() => putMemory({ key: 'k', value: 42 })).toThrow(/string/);
  });

  it('listMemoriesByPrefix matches only the supplied prefix', () => {
    putMemory({ key: 'agents/a', value: 'A' });
    putMemory({ key: 'agents/b', value: 'B' });
    putMemory({ key: 'tasks/1', value: 'T1' });
    const agentRows = listMemoriesByPrefix('agents/').map((r) => r.key);
    expect(agentRows.sort()).toEqual(['agents/a', 'agents/b']);
    const allRows = listMemoriesByPrefix('').map((r) => r.key);
    expect(allRows.sort()).toEqual(['agents/a', 'agents/b', 'tasks/1']);
  });

  it('listMemoriesByPrefix escapes LIKE wildcards in user input', () => {
    putMemory({ key: 'docs/with%token', value: 'literal' });
    putMemory({ key: 'docs/anything', value: 'other' });
    // Without escaping, "%t" would match "anything" via the wildcard.
    const literalOnly = listMemoriesByPrefix('docs/with%').map((r) => r.key);
    expect(literalOnly).toEqual(['docs/with%token']);
  });

  it('listMemoriesForScope returns rows for the named scope/target', () => {
    putMemory({ key: 'a', value: '1', scope: 'terminal', scopeTarget: 't_1' });
    putMemory({ key: 'b', value: '2', scope: 'terminal', scopeTarget: 't_2' });
    putMemory({ key: 'c', value: '3', scope: 'room', scopeTarget: 'r_x' });
    putMemory({ key: 'g', value: 'g' });
    const t1 = listMemoriesForScope('terminal', 't_1').map((r) => r.key);
    expect(t1).toEqual(['a']);
    const rx = listMemoriesForScope('room', 'r_x').map((r) => r.key);
    expect(rx).toEqual(['c']);
    const globalRows = listMemoriesForScope('global', null).map((r) => r.key);
    expect(globalRows).toEqual(['g']);
  });

  it('listMemoryAudit honours limit and key filter', () => {
    putMemory({ key: 'k1', value: 'a' });
    putMemory({ key: 'k1', value: 'b' });
    putMemory({ key: 'k2', value: 'c' });
    const limited = listMemoryAudit(null, 2);
    expect(limited).toHaveLength(2);
    const onlyK1 = listMemoryAudit('k1');
    expect(onlyK1.every((r) => r.memoryKey === 'k1')).toBe(true);
    expect(onlyK1.length).toBe(2);
  });

  it('listMemoryAudit clamps absurd limits to a sane upper bound', () => {
    for (let i = 0; i < 5; i += 1) putMemory({ key: `k${i}`, value: 'v' });
    const tooBig = listMemoryAudit(null, 999999);
    // sanity bound is 1000; we have only 5 rows so all come back.
    expect(tooBig.length).toBe(5);
    const zero = listMemoryAudit(null, 0);
    // 0 is clamped up to 1 by the floor — at least one row returned.
    expect(zero.length).toBe(1);
  });

  it('slash-delimited keys round-trip through get/list/delete', () => {
    putMemory({ key: 'agents/researchant/role', value: 'design' });
    const got = getMemory('agents/researchant/role');
    expect(got?.value).toBe('design');
    expect(listMemoriesByPrefix('agents/').length).toBe(1);
    expect(deleteMemory('agents/researchant/role')).toBe(true);
  });

  it('scope NULL-stored global rows are listed by listMemoriesForScope(global)', () => {
    // scope NULL is the internal storage shape; scope='global' is the API.
    putMemory({ key: 'g1', value: '1' });
    putMemory({ key: 'g2', value: '2', scope: 'global' });
    const rows = listMemoriesForScope('global', null).map((r) => r.key).sort();
    expect(rows).toEqual(['g1', 'g2']);
  });
});
