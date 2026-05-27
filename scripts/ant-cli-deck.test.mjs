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

describe('ant deck create', () => {
  function tmpHome() {
    return mkdtempSync(join(tmpdir(), 'ant-deck-home-'));
  }

  it('scaffolds a minimal Animotion-shaped deck (default mode)', async () => {
    const { runtime, captured } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir }, tmpHome());
    const code = await handleDeckVerb('create',
      ['demo', '--title', 'Demo Deck'],
      runtime, { CliInputError });
    expect(code).toBe(0);
    const deckDir = join(scratchDir, 'demo');
    expect(existsSync(join(deckDir, 'package.json'))).toBe(true);
    expect(existsSync(join(deckDir, 'src', 'slides', '100', 'slide.svelte'))).toBe(true);
    expect(existsSync(join(deckDir, 'svelte.config.js'))).toBe(true);
    expect(existsSync(join(deckDir, 'vite.config.ts'))).toBe(true);
    expect(existsSync(join(deckDir, 'deck-info.json'))).toBe(true);
    const info = JSON.parse(readFileSync(join(deckDir, 'deck-info.json'), 'utf8'));
    expect(info.slug).toBe('demo');
    expect(info.title).toBe('Demo Deck');
    expect(captured.stdout.join('\n')).toContain('npm install && ant deck build demo');
  });

  it('bare mode skips the stub and writes only deck-info.json', async () => {
    const { runtime, captured } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir }, tmpHome());
    const code = await handleDeckVerb('create',
      ['bare-deck', '--title', 'Bare', '--bare'],
      runtime, { CliInputError });
    expect(code).toBe(0);
    const deckDir = join(scratchDir, 'bare-deck');
    expect(existsSync(join(deckDir, 'deck-info.json'))).toBe(true);
    expect(existsSync(join(deckDir, 'package.json'))).toBe(false);
    expect(existsSync(join(deckDir, 'src'))).toBe(false);
    expect(captured.stdout.join('\n')).toContain('bare deck folder');
  });

  it('refuses to overwrite an existing deck folder', async () => {
    const { runtime, captured } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir }, tmpHome());
    mkdirSync(join(scratchDir, 'taken'), { recursive: true });
    const code = await handleDeckVerb('create',
      ['taken', '--title', 'X'], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('already exists');
  });

  it('rejects unsafe slug before any filesystem write', async () => {
    const { runtime } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir }, tmpHome());
    let thrown = null;
    try {
      await handleDeckVerb('create',
        ['../escape', '--title', 'x'], runtime, { CliInputError });
    } catch (failure) { thrown = failure; }
    expect(thrown).toBeInstanceOf(CliInputError);
    expect(thrown.message).toContain('Invalid slug');
  });

  it('requires --title', async () => {
    const { runtime } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir }, tmpHome());
    let thrown = null;
    try {
      await handleDeckVerb('create', ['demo'], runtime, { CliInputError });
    } catch (failure) { thrown = failure; }
    expect(thrown).toBeInstanceOf(CliInputError);
    expect(thrown.message).toContain('--title is required');
  });

  it('HTML-escapes a hostile title in the seed slide', async () => {
    const { runtime } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir }, tmpHome());
    await handleDeckVerb('create',
      ['safe', '--title', '<script>alert(1)</script>'],
      runtime, { CliInputError });
    const slide = readFileSync(join(scratchDir, 'safe', 'src', 'slides', '100', 'slide.svelte'), 'utf8');
    expect(slide).not.toContain('<script>alert(1)</script>');
    expect(slide).toContain('&lt;script&gt;');
  });

  it('with --room R, picks the per-room override if set', async () => {
    const home = tmpHome();
    const overrideRoot = mkdtempSync(join(tmpdir(), 'ant-deck-override-'));
    try {
      mkdirSync(join(home, '.ant'), { recursive: true });
      writeFileSync(join(home, '.ant', 'deck-settings.json'), JSON.stringify({
        decksRoots: [],
        roomOverrides: { 'room-special': overrideRoot }
      }), 'utf8');
      const { runtime } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir }, home);
      const code = await handleDeckVerb('create',
        ['room-deck', '--title', 'Room Deck', '--room', 'room-special'],
        runtime, { CliInputError });
      expect(code).toBe(0);
      expect(existsSync(join(overrideRoot, 'room-deck', 'deck-info.json'))).toBe(true);
      expect(existsSync(join(scratchDir, 'room-deck'))).toBe(false);
    } finally {
      rmSync(overrideRoot, { recursive: true, force: true });
    }
  });

  it('with --room R but no override, falls back to first configured root', async () => {
    const { runtime } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir }, tmpHome());
    const code = await handleDeckVerb('create',
      ['fallback', '--title', 'Fallback', '--room', 'no-override-set'],
      runtime, { CliInputError });
    expect(code).toBe(0);
    expect(existsSync(join(scratchDir, 'fallback', 'deck-info.json'))).toBe(true);
  });
});

describe('ant deck root-set', () => {
  function tmpHome() {
    return mkdtempSync(join(tmpdir(), 'ant-deck-home-'));
  }

  it('writes a room→root mapping into ~/.ant/deck-settings.json', async () => {
    const home = tmpHome();
    const { runtime, captured } = makeRuntime({}, home);
    const code = await handleDeckVerb('root-set',
      ['--room', 'r1', '--path', '/path/to/r1'],
      runtime, { CliInputError });
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(join(home, '.ant', 'deck-settings.json'), 'utf8'));
    expect(written.roomOverrides['r1']).toBe('/path/to/r1');
    expect(captured.stdout.join('\n')).toContain('r1 → /path/to/r1');
  });

  it('preserves existing roomOverrides when adding a second mapping', async () => {
    const home = tmpHome();
    const { runtime } = makeRuntime({}, home);
    await handleDeckVerb('root-set', ['--room', 'r1', '--path', '/p1'], runtime, { CliInputError });
    await handleDeckVerb('root-set', ['--room', 'r2', '--path', '/p2'], runtime, { CliInputError });
    const written = JSON.parse(readFileSync(join(home, '.ant', 'deck-settings.json'), 'utf8'));
    expect(written.roomOverrides).toEqual({ 'r1': '/p1', 'r2': '/p2' });
  });

  it('preserves existing decksRoots array on first root-set call', async () => {
    const home = tmpHome();
    mkdirSync(join(home, '.ant'), { recursive: true });
    writeFileSync(join(home, '.ant', 'deck-settings.json'), JSON.stringify({
      decksRoots: ['/existing/root']
    }), 'utf8');
    const { runtime } = makeRuntime({}, home);
    await handleDeckVerb('root-set', ['--room', 'r', '--path', '/p'], runtime, { CliInputError });
    const written = JSON.parse(readFileSync(join(home, '.ant', 'deck-settings.json'), 'utf8'));
    expect(written.decksRoots).toEqual(['/existing/root']);
    expect(written.roomOverrides).toEqual({ 'r': '/p' });
  });

  it('requires both --room and --path', async () => {
    const { runtime } = makeRuntime({}, tmpHome());
    let thrown = null;
    try {
      await handleDeckVerb('root-set', ['--room', 'r1'], runtime, { CliInputError });
    } catch (failure) { thrown = failure; }
    expect(thrown).toBeInstanceOf(CliInputError);
    expect(thrown.message).toContain('--path');
  });
});

describe('ant deck publish', () => {
  it('rejects --to other than cloudflare', async () => {
    const { runtime } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir });
    let thrown = null;
    try {
      await handleDeckVerb('publish', ['demo', '--to', 's3'], runtime, { CliInputError });
    } catch (failure) { thrown = failure; }
    expect(thrown).toBeInstanceOf(CliInputError);
    expect(thrown.message).toContain('only supports --to cloudflare');
  });

  it('rejects when no slug given', async () => {
    const { runtime } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir });
    let thrown = null;
    try {
      await handleDeckVerb('publish', ['--to', 'cloudflare'], runtime, { CliInputError });
    } catch (failure) { thrown = failure; }
    expect(thrown).toBeInstanceOf(CliInputError);
    expect(thrown.message).toContain('requires a slug');
  });

  it('refuses to publish when dist/ is missing', async () => {
    const { runtime, captured } = makeRuntime({ ANT_BUILT_DECKS_ROOTS: scratchDir });
    mkdirSync(join(scratchDir, 'no-dist'), { recursive: true });
    writeFileSync(join(scratchDir, 'no-dist', 'package.json'), '{}');
    const code = await handleDeckVerb('publish',
      ['no-dist', '--to', 'cloudflare'], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('No build output');
  });
});

describe('ant deck help', () => {
  it('prints singular deck usage and points normal decks at artefacts', async () => {
    const { runtime, captured } = makeRuntime();

    const code = await handleDeckVerb('--help', [], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(captured.stdout.join('\n')).toContain('ant deck <create|build|list|export|publish|root-set>');
    expect(captured.stdout.join('\n')).toContain('ant artefact add');
  });

  it('throws on unknown subverbs', async () => {
    const { runtime } = makeRuntime();
    let thrown = null;

    try {
      await handleDeckVerb('eat-my-shorts', [], runtime, { CliInputError });
    } catch (failure) {
      thrown = failure;
    }

    expect(thrown).toBeInstanceOf(CliInputError);
    expect(thrown.message).toContain('unknown deck verb');
  });
});
