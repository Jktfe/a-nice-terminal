#!/usr/bin/env node
/**
 * ANT preflight check — runs under any Node >= 16, no external deps.
 *
 * 1. Verifies Node >= 22.12.0 (required by node-pty native addon).
 * 2. Fixes the executable bit on node-pty's spawn-helper binaries.
 *    Handles pnpm nested store, npm/bun hoisted, and workspace layouts.
 * 3. Load-tests node-pty to catch build failures early.
 *    Soft warning during postinstall, hard exit during dev/start.
 */

import { readdirSync, statSync, chmodSync, existsSync } from "fs";
import { resolve, join } from "path";

// ── Node version check ────────────────────────────────────────────────────────

const [major, minor] = process.versions.node.split(".").map(Number);
const MIN_MAJOR = 22;
const MIN_MINOR = 12;

if (major < MIN_MAJOR || (major === MIN_MAJOR && minor < MIN_MINOR)) {
  const nvmrcPath = new URL("../.nvmrc", import.meta.url).pathname;
  const nvmHint = existsSync(nvmrcPath) ? `\n  Hint: run \`nvm use\` in this directory.` : "";
  console.error(
    `[preflight] Node ${process.versions.node} is too old.\n` +
      `  ANT requires Node >= ${MIN_MAJOR}.${MIN_MINOR}.0 (node-pty native addon).${nvmHint}`,
  );
  process.exit(1);
}

// ── spawn-helper chmod ────────────────────────────────────────────────────────

const rootDir = new URL("..", import.meta.url).pathname;

/**
 * Walk a directory tree looking for node-pty's spawn-helper binary and fix
 * the executable bit. Handles pnpm .pnpm store, npm/bun hoisting, and
 * workspace-level node_modules.
 */
function fixSpawnHelpers(searchRoot) {
  if (!existsSync(searchRoot)) return;

  const entries = readdirSync(searchRoot, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(searchRoot, entry.name);

    if (entry.isDirectory()) {
      // Recurse into node-pty directories and the pnpm virtual store
      if (
        entry.name === "node-pty" ||
        entry.name === ".pnpm" ||
        entry.name === "prebuilds"
      ) {
        fixSpawnHelpers(fullPath);
      }
    } else if (entry.isFile() && entry.name === "spawn-helper") {
      try {
        const st = statSync(fullPath);
        // Only chmod if not already executable
        if ((st.mode & 0o111) !== 0o111) {
          chmodSync(fullPath, 0o755);
          console.log(`[preflight] Fixed executable bit: ${fullPath}`);
        }
      } catch {
        // ignore — may be a broken symlink or race condition
      }
    }
  }
}

// Check root node_modules (npm/bun hoisted layout)
fixSpawnHelpers(resolve(rootDir, "node_modules"));

// Check packages/app node_modules (pnpm per-package layout)
fixSpawnHelpers(resolve(rootDir, "packages", "app", "node_modules"));

// ── node-pty load test ────────────────────────────────────────────────────────

const isPostinstall = process.env.npm_lifecycle_event === "postinstall";

try {
  await import("node-pty");
} catch (err) {
  const message =
    `[preflight] node-pty failed to load: ${err.message}\n` +
    `  Run \`pnpm install\` (or npm/bun install) to rebuild native addons.`;

  if (isPostinstall) {
    // Postinstall runs before the build is complete on a fresh clone — soft warn
    console.warn(`[preflight] Warning: ${message}`);
  } else {
    console.error(message);
    process.exit(1);
  }
}

console.log(`[preflight] OK — Node ${process.versions.node}`);
