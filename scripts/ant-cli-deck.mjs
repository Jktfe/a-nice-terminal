/**
 * ant deck — normal built-deck filesystem ops.
 *
 * Singular `deck` is for normal deck artefacts served at `/d/:slug`.
 * Plural `decks` is for ANT Stage presentation rows served at `/decks/:id`.
 *
 * Deck folders live outside this repo under ANT_BUILT_DECKS_ROOTS, for example:
 * /Users/you/Dropbox/Decks/ANTdecks/state-of-play
 *
 * A build command runs inside the deck folder. It does not install dependencies
 * or scaffold source; deck authors can choose their own package manager and
 * project shape as long as `npm run build` produces `dist/index.html`.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const BOOLEAN_FLAGS = new Set(['json']);

export function deckRootsFromEnv(env = process.env, home = homedir()) {
  const configured = (env.ANT_BUILT_DECKS_ROOTS ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [
    ...configured,
    join(home, 'CascadeProjects', 'ANT-Decks'),
    join(home, 'CascadeProjects', 'ANT-Open-Slide')
  ];
}

export function isSafeSlug(value) {
  return typeof value === 'string'
    && SLUG_PATTERN.test(value)
    && value !== '.'
    && value !== '..';
}

function parseFlags(rawArgs, CliInputError) {
  const collected = {};
  const positionals = [];
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) {
      positionals.push(token);
      cursor += 1;
      continue;
    }
    const flagName = token.slice(2);
    if (BOOLEAN_FLAGS.has(flagName)) {
      collected[flagName] = 'true';
      cursor += 1;
      continue;
    }
    const flagValue = rawArgs[cursor + 1];
    if (flagValue === undefined || flagValue.startsWith('--')) {
      throw new CliInputError(`flag --${flagName} needs a value`);
    }
    collected[flagName] = flagValue;
    cursor += 2;
  }
  collected._positionals = positionals;
  return collected;
}

function writeUsage(runtime) {
  runtime.writeOut('ant deck <build|list|export> [flags]');
  runtime.writeOut('  build <slug> [--root R]                Runs npm run build in <root>/<slug>; output must be dist/index.html.');
  runtime.writeOut('  list [--root R] [--json]               Lists deck slugs across configured roots.');
  runtime.writeOut('  export <slug> --as pptx [--root R]     Best-effort .pptx export. Reads dist/index.html; writes <root>/<slug>/<slug>.pptx.');
  runtime.writeOut('Normal deck artefact: ant artefact add --room ROOM_ID --kind deck --title "..." --ref-url /d/SLUG');
}

function rootsForRead(flags, runtime) {
  if (flags.root) return [flags.root];
  return deckRootsFromEnv(runtime.env ?? process.env, runtime.home ?? homedir());
}

function findDeckDir(slug, flags, runtime) {
  for (const root of rootsForRead(flags, runtime)) {
    const deckDir = join(root, slug);
    if (existsSync(deckDir)) return { root, deckDir };
  }
  return null;
}

async function runBuild(flags, runtime, CliInputError) {
  const slug = flags._positionals?.[0];
  if (!slug) throw new CliInputError('build requires a slug: ant deck build <slug>');
  if (!isSafeSlug(slug)) throw new CliInputError(`Invalid slug "${slug}".`);

  const found = findDeckDir(slug, flags, runtime);
  if (!found) {
    runtime.writeErr(`Deck not found: ${slug}. Check ANT_BUILT_DECKS_ROOTS or pass --root <path>.`);
    return 1;
  }

  const packageJson = join(found.deckDir, 'package.json');
  if (!existsSync(packageJson)) {
    runtime.writeErr(`Deck has no package.json: ${found.deckDir}`);
    return 1;
  }

  runtime.writeOut(`Building ${slug} at ${found.deckDir} ...`);
  const exit = await runProcess('npm', ['run', 'build'], found.deckDir, runtime);
  if (exit !== 0) {
    runtime.writeErr(`Build failed (exit ${exit}). If dependencies are missing, initialise this deck folder once with its chosen package manager.`);
    return 1;
  }

  const builtIndex = join(found.deckDir, 'dist', 'index.html');
  if (!existsSync(builtIndex)) {
    runtime.writeErr(`Build completed but ${builtIndex} was not found.`);
    return 1;
  }

  runtime.writeOut(`Built: ${builtIndex}`);
  runtime.writeOut(`Served at /d/${slug}`);
  runtime.writeOut(`Add to room: ant artefact add --room ROOM_ID --kind deck --title "Deck title" --ref-url /d/${slug}`);
  return 0;
}

function runList(flags, runtime) {
  const found = [];
  for (const root of rootsForRead(flags, runtime)) {
    if (!existsSync(root)) continue;
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!isSafeSlug(entry)) continue;
      const deckDir = join(root, entry);
      try {
        if (!statSync(deckDir).isDirectory()) continue;
      } catch {
        continue;
      }
      if (!existsSync(join(deckDir, 'package.json'))) continue;
      found.push({
        slug: entry,
        root,
        built: existsSync(join(deckDir, 'dist', 'index.html'))
      });
    }
  }

  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(found));
    return 0;
  }
  if (found.length === 0) {
    runtime.writeOut('No decks found in configured roots.');
    return 0;
  }
  for (const deck of found) {
    runtime.writeOut(`${deck.slug}\t${deck.built ? 'built' : 'unbuilt'}\t${deck.root}`);
  }
  return 0;
}

function runProcess(command, args, cwd, runtime) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => runtime.writeOut(chunk.toString().trimEnd()));
    child.stderr.on('data', (chunk) => runtime.writeErr(chunk.toString().trimEnd()));
    child.on('error', (cause) => {
      runtime.writeErr(`spawn ${command}: ${cause.message}`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

async function runExport(flags, runtime, CliInputError) {
  const slug = flags._positionals?.[0];
  if (!slug) throw new CliInputError('export requires a slug: ant deck export <slug> --as pptx');
  if (!isSafeSlug(slug)) throw new CliInputError(`Invalid slug "${slug}".`);
  const format = flags.as;
  if (format !== 'pptx') {
    throw new CliInputError('export only supports --as pptx today.');
  }
  const found = findDeckDir(slug, flags, runtime);
  if (!found) {
    runtime.writeErr(`Deck not found: ${slug}. Check ANT_BUILT_DECKS_ROOTS or pass --root <path>.`);
    return 1;
  }
  // Lazy-import the helper so the CLI doesn't load pptxgenjs (~3MB)
  // for verbs that don't need it.
  const { exportDeckToPptx } = await import('./ant-cli-deck-export.mjs');
  try {
    const result = await exportDeckToPptx({ deckDir: found.deckDir, slug });
    runtime.writeOut(`Exported ${result.slideCount} slides to: ${result.outputPath}`);
    runtime.writeOut(`Add to room: ant artefact add --room ROOM_ID --kind other --title "${slug} (.pptx)" --ref-url file://${result.outputPath}`);
    return 0;
  } catch (cause) {
    runtime.writeErr(`Export failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 1;
  }
}

export async function handleDeckVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'build': return runBuild(flags, runtime, CliInputError);
    case 'list': return runList(flags, runtime);
    case 'export': return runExport(flags, runtime, CliInputError);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action === undefined ? 1 : 0;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown deck verb: ${action}`);
  }
}
