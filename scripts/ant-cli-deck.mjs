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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const BOOLEAN_FLAGS = new Set(['json', 'bare']);

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
  runtime.writeOut('ant deck <create|build|list|export|publish|root-set> [flags]');
  runtime.writeOut('  create <slug> --title T [--root R] [--room ROOM] [--bare]');
  runtime.writeOut('                                         Scaffolds <root>/<slug>/. With --room, picks the per-room override (set via root-set).');
  runtime.writeOut('                                         --bare: empty folder + deck-info.json only; default writes minimal Animotion stub.');
  runtime.writeOut('  build <slug> [--root R]                Runs npm run build in <root>/<slug>; output must be dist/index.html.');
  runtime.writeOut('  list [--root R] [--json]               Lists deck slugs across configured roots.');
  runtime.writeOut('  export <slug> --as pptx [--root R]     Best-effort .pptx export. Reads dist/index.html; writes <root>/<slug>/<slug>.pptx.');
  runtime.writeOut('  publish <slug> --to cloudflare [--project-name N] [--root R]');
  runtime.writeOut('                                         Deploys <root>/<slug>/dist via wrangler pages deploy. Prints the Cloudflare URL.');
  runtime.writeOut('  root-set --room ROOM --path P          Map a room to a specific deck root. `ant deck create --room R` uses it before falling back.');
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

/**
 * Read the room→root override from ~/.ant/deck-settings.json. The
 * map lives there as `roomOverrides: { [roomId]: rootPath }`. Reading
 * via fs (NOT the SvelteKit `$lib` server module) so the CLI works
 * without the dev/stable server running.
 */
function readRoomOverride(runtime, roomId) {
  if (!roomId) return null;
  const settingsPath = join(runtime.home ?? homedir(), '.ant', 'deck-settings.json');
  if (!existsSync(settingsPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const map = parsed?.roomOverrides;
    if (!map || typeof map !== 'object') return null;
    const value = map[roomId];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Decide which root to use for a write op (create / root-set).
 * Priority: explicit --root flag > per-room override (when --room given) > first
 * configured root from env+settings.
 */
function pickCreateRoot(flags, runtime) {
  if (typeof flags.root === 'string' && flags.root.length > 0) return flags.root;
  if (flags.room) {
    const override = readRoomOverride(runtime, flags.room);
    if (override) return override;
  }
  const roots = deckRootsFromEnv(runtime.env ?? process.env, runtime.home ?? homedir());
  return roots[0];
}

async function runCreate(flags, runtime, CliInputError) {
  const slug = flags._positionals?.[0];
  if (!slug) throw new CliInputError('create requires a slug: ant deck create <slug> --title T');
  if (!isSafeSlug(slug)) throw new CliInputError(`Invalid slug "${slug}".`);
  const title = flags.title;
  if (!title) throw new CliInputError('--title is required.');

  const root = pickCreateRoot(flags, runtime);
  if (!root) throw new CliInputError('No deck root configured. Set ANT_BUILT_DECKS_ROOTS or use /settings/system.');

  const deckDir = join(root, slug);
  if (existsSync(deckDir)) {
    runtime.writeErr(`Deck already exists at ${deckDir}. Use a different --slug or delete the folder.`);
    return 1;
  }

  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  mkdirSync(deckDir, { recursive: true });

  // deck-info.json is the ANT-side metadata trail. Operator's package
  // manager / scaffolder owns everything else.
  const nowMs = Date.now();
  writeFileSync(join(deckDir, 'deck-info.json'), JSON.stringify({
    slug,
    title,
    room: flags.room ?? null,
    createdAtMs: nowMs,
    createdBy: '@speedyclaude'
  }, null, 2) + '\n', 'utf8');

  if (flags.bare === 'true') {
    runtime.writeOut(`Created bare deck folder at ${deckDir}.`);
    runtime.writeOut(`Next: cd into it + run your scaffolder (e.g. \`npm create @animotion@latest .\`), then \`ant deck build ${slug}\`.`);
    return 0;
  }

  // Minimal Animotion-shaped scaffold so `npm install && ant deck
  // build <slug>` works out of the box. Operator can extend or replace
  // wholesale.
  mkdirSync(join(deckDir, 'src', 'slides', '100'), { recursive: true });
  writeFileSync(join(deckDir, 'package.json'), JSON.stringify({
    name: `ant-deck-${slug}`,
    private: true,
    version: '0.0.0',
    description: title,
    type: 'module',
    scripts: { build: 'vite build', dev: 'vite dev', preview: 'vite preview' },
    dependencies: { '@animotion/core': '^1.7.0', svelte: '^5.0.0' },
    devDependencies: {
      '@sveltejs/adapter-static': '^3.0.0',
      '@sveltejs/kit': '^2.0.0',
      '@sveltejs/vite-plugin-svelte': '^4.0.0',
      vite: '^6.0.0'
    }
  }, null, 2) + '\n', 'utf8');
  const titleEscaped = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  writeFileSync(join(deckDir, 'src', 'slides', '100', 'slide.svelte'),
    `<script lang="ts">\n  import { Slide } from '@animotion/core';\n</script>\n\n<Slide>\n  <h1>${titleEscaped}</h1>\n  <p>Edit me at \`${slug}/src/slides/100/slide.svelte\`.</p>\n</Slide>\n`,
    'utf8');
  writeFileSync(join(deckDir, 'svelte.config.js'),
    `import adapter from '@sveltejs/adapter-static';\nimport { vitePreprocess } from '@sveltejs/vite-plugin-svelte';\n\nexport default {\n  preprocess: vitePreprocess(),\n  kit: { adapter: adapter({ pages: 'dist', assets: 'dist', fallback: undefined, precompress: false, strict: true }) }\n};\n`,
    'utf8');
  writeFileSync(join(deckDir, 'vite.config.ts'),
    `import { sveltekit } from '@sveltejs/kit/vite';\nimport { defineConfig } from 'vite';\n\nexport default defineConfig({ plugins: [sveltekit()] });\n`,
    'utf8');
  writeFileSync(join(deckDir, '.gitignore'),
    `node_modules\n.svelte-kit\ndist\nbuild\n`,
    'utf8');

  runtime.writeOut(`Created deck "${title}" at ${deckDir}.`);
  runtime.writeOut(`Next: cd ${deckDir} && npm install && ant deck build ${slug}`);
  if (flags.room) {
    runtime.writeOut(`Then: ant artefact add --room ${flags.room} --kind deck --title "${title}" --ref-url /d/${slug}`);
  } else {
    runtime.writeOut(`Then: ant artefact add --room ROOM_ID --kind deck --title "${title}" --ref-url /d/${slug}`);
  }
  return 0;
}

/**
 * Map a room to a specific deck root. Persists in ~/.ant/deck-settings.json
 * under `roomOverrides`. Idempotent.
 */
async function runRootSet(flags, runtime, CliInputError) {
  const roomId = flags.room;
  const path = flags.path;
  if (!roomId) throw new CliInputError('root-set requires --room ROOM');
  if (!path) throw new CliInputError('root-set requires --path P (absolute folder path)');
  const settingsDir = join(runtime.home ?? homedir(), '.ant');
  const settingsPath = join(settingsDir, 'deck-settings.json');
  if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });
  let parsed = {};
  if (existsSync(settingsPath)) {
    try { parsed = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { parsed = {}; }
  }
  const map = (parsed && typeof parsed.roomOverrides === 'object' && parsed.roomOverrides !== null)
    ? parsed.roomOverrides
    : {};
  map[roomId] = path;
  parsed.roomOverrides = map;
  if (!Array.isArray(parsed.decksRoots)) parsed.decksRoots = [];
  writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  runtime.writeOut(`Room ${roomId} → ${path}`);
  return 0;
}

/**
 * Publish a built deck via wrangler. Requires wrangler installed +
 * authed locally (one-time `wrangler login`). Operator's responsibility;
 * ANT just orchestrates.
 */
async function runPublish(flags, runtime, CliInputError) {
  const slug = flags._positionals?.[0];
  if (!slug) throw new CliInputError('publish requires a slug: ant deck publish <slug> --to cloudflare');
  if (!isSafeSlug(slug)) throw new CliInputError(`Invalid slug "${slug}".`);
  const target = flags.to;
  if (target !== 'cloudflare') {
    throw new CliInputError('publish only supports --to cloudflare today.');
  }
  const found = findDeckDir(slug, flags, runtime);
  if (!found) {
    runtime.writeErr(`Deck not found: ${slug}.`);
    return 1;
  }
  const distDir = join(found.deckDir, 'dist');
  if (!existsSync(distDir)) {
    runtime.writeErr(`No build output at ${distDir}. Run \`ant deck build ${slug}\` first.`);
    return 1;
  }
  const projectName = flags['project-name'] ?? slug;
  const lines = [];
  runtime.writeOut(`Publishing ${slug} to Cloudflare Pages (project: ${projectName}) ...`);
  const exit = await runProcessCapture('npx', ['wrangler', 'pages', 'deploy', distDir, '--project-name', projectName], found.deckDir, runtime, lines);
  if (exit !== 0) {
    runtime.writeErr(`Publish failed (exit ${exit}). Have you run \`npx wrangler login\`?`);
    return 1;
  }
  // Wrangler prints lines like "✨ Deployment complete! Take a peek over at https://xxx.pages.dev"
  const urlMatch = lines.join('\n').match(/https:\/\/[a-z0-9.-]+\.pages\.dev[a-z0-9.\-\/]*/i);
  if (urlMatch) {
    const url = urlMatch[0];
    runtime.writeOut(`Deployed: ${url}`);
    runtime.writeOut(`Add to room: ant artefact add --room ROOM_ID --kind deck --title "${slug}" --ref-url "${url}"`);
  } else {
    runtime.writeOut('Deployed. Check the wrangler output above for the URL.');
  }
  return 0;
}

/**
 * Like runProcess but also captures stdout into `linesOut` (for URL
 * extraction). Stderr still streams to the runtime writer.
 */
function runProcessCapture(command, args, cwd, runtime, linesOut) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      linesOut.push(text);
      runtime.writeOut(text.trimEnd());
    });
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
    case 'create': return runCreate(flags, runtime, CliInputError);
    case 'build': return runBuild(flags, runtime, CliInputError);
    case 'list': return runList(flags, runtime);
    case 'export': return runExport(flags, runtime, CliInputError);
    case 'publish': return runPublish(flags, runtime, CliInputError);
    case 'root-set': return runRootSet(flags, runtime, CliInputError);
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
