// ANT — Version Detector
// File: src/fingerprint/version-detector.ts
//
// Detects the installed version of each known agent by running its
// --version flag or parsing its startup banner.
// Returns null if the version cannot be determined.

import { execFileNoThrow } from '../utils/execFileNoThrow.js';
import type { AgentEntry } from './agent-registry.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VersionResult {
  agent: string;
  detected: string | null;
  specVersion: string | null;
  stale: boolean;
  raw: string;
}

// ─── Per-agent version strategies ────────────────────────────────────────────

type VersionStrategy = (agent: AgentEntry) => Promise<string | null>;

const STRATEGIES: Record<string, VersionStrategy> = {
  'claude-code': async () => {
    const r = await execFileNoThrow('claude', ['--version']);
    // Output: "2.1.89" or "Claude Code 2.1.89"
    return r.stdout.trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  },

  'gemini-cli': async () => {
    const r = await execFileNoThrow('gemini', ['--version']);
    return r.stdout.trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  },

  'codex-cli': async () => {
    // codex --version or parse startup banner "(v0.118.0)"
    const r = await execFileNoThrow('codex', ['--version']);
    const fromFlag = r.stdout.trim().match(/(\d+\.\d+\.\d+)/)?.[1];
    if (fromFlag) return fromFlag;
    // Fallback: parse help output which includes version in banner
    const h = await execFileNoThrow('codex', ['--help']);
    return h.stdout.match(/v(\d+\.\d+\.\d+)/)?.[1] ?? null;
  },

  'copilot-cli': async () => {
    const r = await execFileNoThrow('copilot', ['--version']);
    return `${r.stdout}\n${r.stderr}`.trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  },

  'qwen-cli': async () => {
    const r = await execFileNoThrow('qwen', ['--version']);
    return `${r.stdout}\n${r.stderr}`.trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  },

  'pi': async () => {
    const r = await execFileNoThrow('pi', ['--version']);
    return `${r.stdout}\n${r.stderr}`.trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  },

  'kimi-code': async () => {
    const r = await execFileNoThrow('kimi', ['--version']);
    return `${r.stdout}\n${r.stderr}`.trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  },

  'ollama': async () => {
    const r = await execFileNoThrow('ollama', ['--version']);
    return r.stdout.trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  },

  'lm-studio': async () => {
    const r = await execFileNoThrow('lms', ['--version']);
    return r.stdout.trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  },

  'llamafile': async () => {
    const bin = `${process.env.HOME ?? '/tmp'}/llamafiles/granite-vision-3.3-2b.llamafile`;
    const r = await execFileNoThrow(bin, ['--version']);
    return r.stdout.trim().match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? null;
  },

  'llm': async () => {
    const r = await execFileNoThrow('llm', ['--version']);
    return r.stdout.trim().match(/(\d+\.\d+\.?\d*)/)?.[1] ?? null;
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the installed version of an agent and compare against spec.
 */
export async function detectVersion(
  agent: AgentEntry,
  specPath: string | null,
): Promise<VersionResult> {
  const strategy = STRATEGIES[agent.name];
  let detected: string | null = null;
  let raw = '';

  if (strategy && agent.available) {
    try {
      detected = await strategy(agent);
      raw = detected ?? '';
    } catch {
      raw = '(error)';
    }
  }

  // Load version_tested from spec.json if available
  let specVersion: string | null = null;
  if (specPath) {
    try {
      const { readFileSync } = await import('fs');
      const { join } = await import('path');
      const spec = JSON.parse(readFileSync(join(process.cwd(), specPath), 'utf8'));
      specVersion = spec.version_tested ?? null;
    } catch {
      // spec not found or unparseable
    }
  }

  const stale = detected !== null && specVersion !== null && detected !== specVersion;

  return { agent: agent.name, detected, specVersion, stale, raw };
}

/**
 * Detect versions for multiple agents and return results.
 */
export async function detectVersions(
  agents: AgentEntry[],
): Promise<VersionResult[]> {
  return Promise.all(
    agents.map(a => detectVersion(a, a.specPath)),
  );
}
