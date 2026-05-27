import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deckRootsFromEnv,
  handleDeckVerb,
  isSafeSlug
} from './ant-cli-deck.mjs';

class CliInputError extends Error {}

function makeRuntime(env = {}, home = '/Users/tester') {
  const captured = { stdout: [], stderr: [] };
  const runtime = {
    env,
    home,
    writeOut: (line) => captured.stdout.push(String(line)),
    writeErr: (line) => captured.stderr.push(String(line))
  };
  return { runtime, captured };
}

let scratchDir = '';

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'ant-deck-test-'));
});

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

function writeDeck(slug, buildScript = 'node build.mjs') {
  const deckDir = join(scratchDir, slug);
  mkdirSync(deckDir, { recursive: true });
  writeFileSync(
    join(deckDir, 'package.json'),
    JSON.stringify({ private: true, scripts: { build: buildScript } }, null, 2)
  );
  writeFileSync(
    join(deckDir, 'build.mjs'),
    "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/index.html', '<h1>deck</h1>');\n"
  );
  return deckDir;
}

describe('isSafeSlug', () => {
  it('accepts normal deck slugs', () => {
    expect(isSafeSlug('state-of-play')).toBe(true);
    expect(isSafeSlug('deck.1')).toBe(true);
    expect(isSafeSlug('deck_1')).toBe(true);
  });

  it('rejects traversal and special leading characters', () => {
    expect(isSafeSlug('../etc')).toBe(false);
    expect(isSafeSlug('a/b')).toBe(false);
    expect(isSafeSlug('.')).toBe(false);
    expect(isSafeSlug('..')).toBe(false);
    expect(isSafeSlug('-leading')).toBe(false);
    expect(isSafeSlug('.hidden')).toBe(false);
    expect(isSafeSlug('with space')).toBe(false);
  });
});

describe('deckRootsFromEnv', () => {
  it('returns configured roots first and preserves Dropbox paths with spaces', () => {
    const dropbox = '/Users/jamesking/New Model Dropbox/James King/ANTdecks';
    const roots = deckRootsFromEnv({ ANT_BUILT_DECKS_ROOTS: `${dropbox}:/tmp/other` }, '/Users/jamesking');
    expect(roots[0]).toBe(dropbox);
    expect(roots[1]).toBe('/tmp/other');
    expect(roots[2]).toBe('/Users/jamesking/CascadeProjects/ANT-Decks');
  });
});

describe('ant deck build', () => {
  it('runs npm run build in the deck folder and verifies dist/index.html', async () => {
    writeDeck('demo-deck');
    const { runtime, captured } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir });

    const code = await handleDeckVerb('build', ['demo-deck'], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(existsSync(join(scratchDir, 'demo-deck', 'dist', 'index.html'))).toBe(true);
    expect(captured.stdout.join('\n')).toContain('Served at /d/demo-deck');
    expect(captured.stdout.join('\n')).toContain('ant artefact add --room ROOM_ID --kind deck');
  });

  it('can build a deck from an explicit --root', async () => {
    writeDeck('rooted');
    const { runtime } = makeRuntime({});

    const code = await handleDeckVerb('build', ['rooted', '--root', scratchDir], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(existsSync(join(scratchDir, 'rooted', 'dist', 'index.html'))).toBe(true);
  });

  it('fails clearly when the deck is missing', async () => {
    const { runtime, captured } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir });

    const code = await handleDeckVerb('build', ['missing'], runtime, { CliInputError });

    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('Deck not found');
  });

  it('rejects unsafe slugs before filesystem access', async () => {
    const { runtime } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir });
    let thrown = null;

    try {
      await handleDeckVerb('build', ['../escape'], runtime, { CliInputError });
    } catch (failure) {
      thrown = failure;
    }

    expect(thrown).toBeInstanceOf(CliInputError);
    expect(thrown.message).toContain('Invalid slug');
  });

  it('fails if build exits 0 but no dist/index.html exists', async () => {
    writeDeck('bad-output', 'node -e "console.log(\\"no dist\\")"');
    const { runtime, captured } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir });

    const code = await handleDeckVerb('build', ['bad-output'], runtime, { CliInputError });

    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('dist/index.html');
  });
});

describe('ant deck list', () => {
  it('lists package-backed deck folders and marks built state', async () => {
    writeDeck('built');
    mkdirSync(join(scratchDir, 'built', 'dist'), { recursive: true });
    writeFileSync(join(scratchDir, 'built', 'dist', 'index.html'), '<html></html>');
    writeDeck('unbuilt');
    mkdirSync(join(scratchDir, 'not-a-deck'), { recursive: true });

    const { runtime, captured } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir });
    const code = await handleDeckVerb('list', ['--json'], runtime, { CliInputError });

    expect(code).toBe(0);
    const rows = JSON.parse(captured.stdout[0]);
    expect(rows.map((row) => row.slug).sort()).toEqual(['built', 'unbuilt']);
    expect(rows.find((row) => row.slug === 'built').built).toBe(true);
    expect(rows.find((row) => row.slug === 'unbuilt').built).toBe(false);
  });
});

describe('ant deck help', () => {
  it('prints singular deck usage and points normal decks at artefacts', async () => {
    const { runtime, captured } = makeRuntime();

    const code = await handleDeckVerb('--help', [], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(captured.stdout.join('\n')).toContain('ant deck <build|list|export>');
    expect(captured.stdout.join('\n')).toContain('ant artefact add');
  });

  it('throws on unknown subverbs', async () => {
    const { runtime } = makeRuntime();
    let thrown = null;

    try {
      await handleDeckVerb('create', [], runtime, { CliInputError });
    } catch (failure) {
      thrown = failure;
    }

    expect(thrown).toBeInstanceOf(CliInputError);
    expect(thrown.message).toContain('unknown deck verb');
  });
});
