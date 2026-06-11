import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  listSimpleCatalogue,
  addSimpleCatalogueEntry,
  removeSimpleCatalogueEntry,
  replaceSimpleCatalogue,
  seedDefaultCataloguesIfEmpty
} from './defaultCataloguesStore';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-simplecat-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('simple catalogues — account_types & model_families', () => {
  it('seeds both with their canonical defaults', () => {
    seedDefaultCataloguesIfEmpty();
    const accts = listSimpleCatalogue('account_types');
    const fams = listSimpleCatalogue('model_families');
    expect(accts).toContain('Claude Subscription');
    expect(accts).toContain('Local');
    expect(fams).toContain('Claude');
    expect(fams).toContain('Other-Local');
  });

  it('add appends, dedupes, and ignores blanks', () => {
    seedDefaultCataloguesIfEmpty();
    const before = listSimpleCatalogue('account_types').length;
    addSimpleCatalogueEntry('account_types', 'Bedrock');
    expect(listSimpleCatalogue('account_types')).toContain('Bedrock');
    addSimpleCatalogueEntry('account_types', 'Bedrock'); // dedupe
    addSimpleCatalogueEntry('account_types', '   ');      // blank ignored
    expect(listSimpleCatalogue('account_types').length).toBe(before + 1);
  });

  it('remove deletes a single entry', () => {
    seedDefaultCataloguesIfEmpty();
    removeSimpleCatalogueEntry('model_families', 'Kimi');
    expect(listSimpleCatalogue('model_families')).not.toContain('Kimi');
    expect(listSimpleCatalogue('model_families')).toContain('Claude');
  });

  it('replace sets the whole ordered list', () => {
    replaceSimpleCatalogue('model_families', ['Alpha', 'Beta', '', 'Gamma']);
    expect(listSimpleCatalogue('model_families')).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('the two catalogues are independent', () => {
    seedDefaultCataloguesIfEmpty();
    replaceSimpleCatalogue('account_types', ['Solo']);
    expect(listSimpleCatalogue('account_types')).toEqual(['Solo']);
    expect(listSimpleCatalogue('model_families').length).toBeGreaterThan(1);
  });
});
