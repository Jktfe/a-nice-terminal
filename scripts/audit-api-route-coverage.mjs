#!/usr/bin/env node
/**
 * Read-only API route coverage inventory.
 *
 * This is not a build gate. Some API handlers are intentionally covered
 * through store-level or cross-route tests, so the output is an audit queue
 * rather than a pass/fail signal.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT = resolve(__dirname, '..');

/**
 * @typedef {{
 *   root?: string;
 *   routesRoot?: string;
 * }} CoverageInventoryInput
 *
 * @typedef {{
 *   root: string;
 *   routesRoot: string;
 *   routeHandlers: string[];
 *   routeLocalTests: string[];
 *   missingDirectTests: string[];
 *   counts: {
 *     routeHandlers: number;
 *     routeLocalTests: number;
 *     missingDirectTests: number;
 *   };
 * }} CoverageInventory
 */

/** @param {string} root */
function walkFiles(root) {
  /** @type {string[]} */
  const files = [];
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const info = statSync(fullPath);
    if (info.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (info.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/** @param {string} path */
function normalizePath(path) {
  return path.split('\\').join('/');
}

/**
 * @param {CoverageInventoryInput} [input]
 * @returns {CoverageInventory}
 */
export function collectApiRouteCoverage(input = {}) {
  const root = resolve(input.root ?? DEFAULT_ROOT);
  const routesRoot = resolve(root, input.routesRoot ?? 'src/routes/api');
  const files = walkFiles(routesRoot);
  const routeHandlers = files
    .filter((file) => file.endsWith('+server.ts'))
    .map((file) => normalizePath(relative(root, file)))
    .sort();
  const routeLocalTests = files
    .filter((file) => /(?:^|\/)[^/]+\.test\.(?:ts|js|mjs)$/.test(normalizePath(file)))
    .map((file) => normalizePath(relative(root, file)))
    .sort();
  const testDirs = new Set(routeLocalTests.map((file) => dirname(file)));
  const missingDirectTests = routeHandlers
    .filter((handler) => !testDirs.has(dirname(handler)))
    .sort();

  return {
    root,
    routesRoot: normalizePath(relative(root, routesRoot)),
    routeHandlers,
    routeLocalTests,
    missingDirectTests,
    counts: {
      routeHandlers: routeHandlers.length,
      routeLocalTests: routeLocalTests.length,
      missingDirectTests: missingDirectTests.length
    }
  };
}

/** @param {CoverageInventory} inventory */
export function formatApiRouteCoverage(inventory) {
  const lines = [
    'API route coverage inventory',
    `root: ${inventory.root}`,
    `routesRoot: ${inventory.routesRoot}`,
    `routeHandlers: ${inventory.counts.routeHandlers}`,
    `routeLocalTests: ${inventory.counts.routeLocalTests}`,
    `missingDirectTests: ${inventory.counts.missingDirectTests}`
  ];
  if (inventory.missingDirectTests.length > 0) {
    lines.push('', 'Handlers without route-local tests:');
    for (const handler of inventory.missingDirectTests) lines.push(`- ${handler}`);
  }
  return lines.join('\n');
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, json: false };
  for (let i = 0; i < argv.length;) {
    const arg = argv[i];
    if (arg === '--json') { opts.json = true; i += 1; continue; }
    if (arg === '--root') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--root needs a path');
      opts.root = value;
      i += 2;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/audit-api-route-coverage.mjs [--root PATH] [--json]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const inventory = collectApiRouteCoverage({ root: opts.root });
    console.log(opts.json ? JSON.stringify(inventory, null, 2) : formatApiRouteCoverage(inventory));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
