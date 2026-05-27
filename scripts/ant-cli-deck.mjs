/**
 * ant deck — single-deck filesystem ops (singular, vs the plural
 * `ant decks` which is DB-backed Stage presentation rows).
 *
 * Decks live OUTSIDE this repo. Configured via ANT_BUILT_DECKS_ROOTS
 * (delimiter-separated list of folders — `:` on macOS/Linux). JWPK
 * default: /Users/jamesking/New Model Dropbox/James King/ANTdecks
 *
 * Layout — pnpm workspace at the root, one workspace member per deck:
 *
 *   <ROOT>/
 *     package.json                          (workspace declaration)
 *     pnpm-workspace.yaml                   (members: ["*"])
 *     node_modules/                         (hoisted; shared by all decks)
 *     <slug>/                               (one deck)
 *       package.json                        (member, deps via workspace)
 *       src/slides/100/slide.svelte         (Animotion convention)
 *       vite.config.ts
 *       svelte.config.js
 *       dist/                               (build output; served at /d/<slug>)
 *
 * Verbs:
 *   ant deck root-init [--root R]    Idempotent. Sets up pnpm workspace + first install.
 *   ant deck create --slug X --title T [--root R]
 *                                    Scaffolds a new deck under root. Triggers root-init
 *                                    on first run if root is empty.
 *   ant deck build <slug> [--root R] Runs `pnpm --filter ./<slug> build`. Output to
 *                                    <root>/<slug>/dist/ — served at /d/<slug>.
 *   ant deck list [--root R]         Lists deck slugs in configured roots.
 *
 * The /d/<slug> route (src/routes/d/[slug]/+server.ts) serves the built
 * dist/index.html with asset path rewriting. `ant artefact add --kind
 * deck --ref-url /d/<slug>` adds the deck as a room artefact. Stage
 * presentations link via theme=animotion:<slug> (see ant decks plural).
 *
 * Safety: slug must match the same pattern the server route enforces —
 * [a-zA-Z0-9][a-zA-Z0-9_.-]* — to prevent path traversal. Validated
 * CLI-side BEFORE any filesystem op.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const BOOLEAN_FLAGS = new Set(['json']);

/**
 * Resolve the list of configured deck roots, in resolution order.
 * ANT_BUILT_DECKS_ROOTS wins; falls back to the v3 legacy locations
 * (matches the server's /d/<slug> resolver in src/routes/d/[slug]).
 */
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

/**
 * Pick the canonical root for a write op (create / root-init). Uses
 * the first explicit root if provided via --root, else the first
 * configured root, else the first fallback. Verbatim for spaces.
 */
export function pickWriteRoot(flagsRoot, env = process.env, home = homedir()) {
  if (typeof flagsRoot === 'string' && flagsRoot.length > 0) return flagsRoot;
  const roots = deckRootsFromEnv(env, home);
  return roots[0];
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
  runtime.writeOut('ant deck <root-init|create|build|list> [flags]');
  runtime.writeOut('  root-init [--root R]                One-time pnpm workspace setup + install. Idempotent.');
  runtime.writeOut('  create --slug X --title T [--root R] Scaffolds a new deck folder. Calls root-init implicitly if needed.');
  runtime.writeOut('  build <slug> [--root R]              Runs `pnpm --filter ./<slug> build`. Output → /d/<slug>.');
  runtime.writeOut('  list [--root R] [--json]             Lists deck slugs across all configured roots.');
}

/**
 * Idempotent root-init: writes pnpm-workspace.yaml + root package.json
 * + .npmrc if missing, then runs `pnpm install`. Safe to call repeatedly.
 */
async function runRootInit(flags, runtime, CliInputError) {
  const root = pickWriteRoot(flags.root, runtime.env ?? process.env, runtime.home ?? homedir());
  if (!root) throw new CliInputError('No deck root configured. Set ANT_BUILT_DECKS_ROOTS or pass --root <path>.');

  if (!existsSync(root)) mkdirSync(root, { recursive: true });

  const workspaceYaml = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceYaml)) {
    writeFileSync(workspaceYaml, 'packages:\n  - "*"\n', 'utf8');
    runtime.writeOut(`Wrote ${workspaceYaml}`);
  }

  const rootPackageJson = join(root, 'package.json');
  if (!existsSync(rootPackageJson)) {
    writeFileSync(rootPackageJson, JSON.stringify({
      name: 'ant-decks-root',
      private: true,
      version: '0.0.0',
      description: 'ANT decks workspace root (set up by `ant deck root-init`).'
    }, null, 2) + '\n', 'utf8');
    runtime.writeOut(`Wrote ${rootPackageJson}`);
  }

  const npmrc = join(root, '.npmrc');
  if (!existsSync(npmrc)) {
    // Hoist the deck deps so individual deck folders don't each get
    // their own node_modules. Same node_modules at root serves all.
    writeFileSync(npmrc, 'hoist-pattern[]=*\nshamefully-hoist=true\n', 'utf8');
    runtime.writeOut(`Wrote ${npmrc}`);
  }

  // First-time install. Skip if node_modules exists — caller will pick
  // it up on first deck build instead.
  const rootNodeModules = join(root, 'node_modules');
  if (!existsSync(rootNodeModules)) {
    runtime.writeOut(`Running pnpm install at ${root} ...`);
    const exit = await runProcess('pnpm', ['install'], root, runtime);
    if (exit !== 0) {
      runtime.writeErr(`pnpm install failed (exit ${exit}).`);
      return 1;
    }
  }
  runtime.writeOut('Deck root ready.');
  return 0;
}

/**
 * Scaffold a new deck under the chosen root. Writes minimum-viable
 * Animotion deck shape:
 *   <root>/<slug>/package.json (workspace member, depends on @animotion/core)
 *   <root>/<slug>/src/slides/100/slide.svelte (first slide stub)
 *   <root>/<slug>/svelte.config.js
 *   <root>/<slug>/vite.config.ts
 *   <root>/<slug>/index.html
 */
async function runCreate(flags, runtime, CliInputError) {
  const slug = flags.slug;
  const title = flags.title;
  if (!slug) throw new CliInputError('--slug is required.');
  if (!isSafeSlug(slug)) throw new CliInputError(`Invalid slug "${slug}". Must match [a-zA-Z0-9][a-zA-Z0-9_.-]*`);
  if (!title) throw new CliInputError('--title is required.');

  const root = pickWriteRoot(flags.root, runtime.env ?? process.env, runtime.home ?? homedir());
  if (!root) throw new CliInputError('No deck root configured. Set ANT_BUILT_DECKS_ROOTS or pass --root <path>.');

  // Implicit root-init when the root has no workspace declaration yet.
  if (!existsSync(join(root, 'pnpm-workspace.yaml'))) {
    runtime.writeOut(`Root ${root} not initialised — running root-init first ...`);
    const initExit = await runRootInit({ root }, runtime, CliInputError);
    if (initExit !== 0) return initExit;
  }

  const deckDir = join(root, slug);
  if (existsSync(deckDir)) {
    runtime.writeErr(`Deck already exists at ${deckDir}. Use a different --slug or delete the folder.`);
    return 1;
  }

  // Build the scaffold. Kept deliberately minimal — operator can
  // extend with the full Animotion `npm create @animotion@latest`
  // output if they want more bells. We just need the files that make
  // `pnpm --filter ./<slug> build` succeed.
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

  writeFileSync(join(deckDir, 'src', 'slides', '100', 'slide.svelte'),
    `<script lang="ts">\n  import { Slide } from '@animotion/core';\n</script>\n\n<Slide>\n  <h1>${escapeHtml(title)}</h1>\n  <p>Edit me at \`${slug}/src/slides/100/slide.svelte\`.</p>\n</Slide>\n`,
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
  runtime.writeOut(`Next: edit slides under ${deckDir}/src/slides/, then \`ant deck build ${slug}\`.`);
  return 0;
}

/**
 * Build a single deck. Uses pnpm --filter so deps are resolved from
 * the workspace's hoisted node_modules at the root.
 */
async function runBuild(flags, runtime, CliInputError) {
  const slug = flags._positionals?.[0];
  if (!slug) throw new CliInputError('build requires a slug: `ant deck build <slug>`');
  if (!isSafeSlug(slug)) throw new CliInputError(`Invalid slug "${slug}".`);

  const root = pickWriteRoot(flags.root, runtime.env ?? process.env, runtime.home ?? homedir());
  if (!root) throw new CliInputError('No deck root configured.');

  const deckDir = join(root, slug);
  if (!existsSync(deckDir)) {
    runtime.writeErr(`Deck not found at ${deckDir}.`);
    return 1;
  }

  runtime.writeOut(`Building ${slug} in ${root} ...`);
  const exit = await runProcess('pnpm', ['--filter', `./${slug}`, 'build'], root, runtime);
  if (exit !== 0) {
    runtime.writeErr(`Build failed (exit ${exit}).`);
    return 1;
  }
  runtime.writeOut(`Built: ${join(deckDir, 'dist', 'index.html')}`);
  runtime.writeOut(`Served at /d/${slug}`);
  return 0;
}

/**
 * Scan configured roots, return slugs that look like valid decks
 * (slug matches pattern + has a src/slides directory).
 */
function runList(flags, runtime) {
  const env = runtime.env ?? process.env;
  const home = runtime.home ?? homedir();
  const roots = flags.root ? [flags.root] : deckRootsFromEnv(env, home);
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries;
    try { entries = readdirSync(root); } catch { continue; }
    for (const entry of entries) {
      if (!isSafeSlug(entry)) continue;
      const entryPath = join(root, entry);
      let isDeck = false;
      try {
        isDeck = statSync(entryPath).isDirectory()
          && existsSync(join(entryPath, 'package.json'))
          && existsSync(join(entryPath, 'src', 'slides'));
      } catch { /* skip unreadable */ }
      if (isDeck) {
        const hasBuild = existsSync(join(entryPath, 'dist', 'index.html'));
        found.push({ slug: entry, root, built: hasBuild });
      }
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

/**
 * Spawn a child process, stream stdout/stderr to the runtime writers.
 * Returns the exit code.
 */
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

function escapeHtml(raw) {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function handleDeckVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'root-init': return runRootInit(flags, runtime, CliInputError);
    case 'create':    return runCreate(flags, runtime, CliInputError);
    case 'build':     return runBuild(flags, runtime, CliInputError);
    case 'list':      return runList(flags, runtime);
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
