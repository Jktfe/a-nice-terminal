// ANT — Agent Registry
// File: src/fingerprint/agent-registry.ts
//
// Central registry of all known agents across Tier 1–3.
// Call checkAvailability() at runtime to update the `available` field
// by probing `which` for each agent's launch binary.

import { execFileNoThrow } from '../utils/execFileNoThrow.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentEntry {
  name: string;
  tier: 1 | 2 | 3;
  /** The command (or command + args) used to launch the agent interactively. */
  launchCommand: string;
  /** The binary name to check with `which` at runtime. */
  binary: string;
  /** Populated by checkAvailability() — do not set manually. */
  available: boolean;
  /** Path to the driver source (relative to project root). */
  driverPath: string;
  /** Path to the machine-readable spec (relative to project root). Null if no spec yet. */
  specPath: string | null;
  /** Notes shown in `--list` output. */
  notes?: string;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const AGENTS: AgentEntry[] = [
  // Tier 1 — Agentic coding CLIs
  {
    name: 'claude-code',
    tier: 1,
    launchCommand: 'claude',
    binary: 'claude',
    available: false,
    driverPath: 'src/drivers/claude-code/driver.ts',
    specPath: 'src/drivers/claude-code/spec.json',
  },
  {
    name: 'gemini-cli',
    tier: 1,
    launchCommand: 'gemini --approval-mode default',
    binary: 'gemini',
    available: false,
    driverPath: 'src/drivers/gemini-cli/driver.ts',
    specPath: 'src/drivers/gemini-cli/spec.json',
  },
  {
    name: 'codex-cli',
    tier: 1,
    launchCommand: 'codex',
    binary: 'codex',
    available: false,
    driverPath: 'src/drivers/codex-cli/driver.ts',
    specPath: 'src/drivers/codex-cli/spec.json',
  },
  {
    name: 'copilot-cli',
    tier: 1,
    launchCommand: 'copilot --allow-all',
    binary: 'copilot',
    available: false,
    driverPath: 'src/drivers/copilot-cli/driver.ts',
    specPath: 'src/drivers/copilot-cli/spec.json',
    notes: 'GitHub Copilot CLI; --allow-all and --yolo both accepted locally',
  },
  {
    name: 'qwen-cli',
    tier: 1,
    launchCommand: 'qwen --model qwen3.6:latest --openai-base-url http://localhost:11434/v1 --openai-api-key ollama --auth-type openai --yolo',
    binary: 'qwen',
    available: false,
    driverPath: 'src/drivers/qwen-cli/driver.ts',
    specPath: 'src/drivers/qwen-cli/spec.json',
    notes: 'Qwen Code via Ollama local qwen3.6:latest; MMDqwen alias registered',
  },
  {
    name: 'pi',
    tier: 1,
    launchCommand: 'pi',
    binary: 'pi',
    available: false,
    driverPath: 'src/drivers/pi/driver.ts',
    specPath: null,
    notes: 'structured modes: --mode json and --mode rpc; spec pending',
  },
  {
    name: 'kimi-code',
    tier: 1,
    launchCommand: 'kimi',
    binary: 'kimi',
    available: false,
    driverPath: 'src/drivers/kimi-code/driver.ts',
    specPath: null,
    notes: 'Moonshot Kimi Code CLI; stream-json and ACP documented; not installed locally',
  },

  // Tier 2 — Local inference CLIs
  {
    name: 'ollama',
    tier: 2,
    launchCommand: 'ollama run gemma4:26b',
    binary: 'ollama',
    available: false,
    driverPath: 'src/drivers/ollama/driver.ts',
    specPath: null,
  },
  {
    name: 'lm-studio',
    tier: 2,
    launchCommand: 'lms chat openai/gpt-oss-20b',
    binary: 'lms',
    available: false,
    driverPath: 'src/drivers/lm-studio/driver.ts',
    specPath: null,
  },
  {
    name: 'llamafile',
    tier: 2,
    launchCommand: './granite-vision-3.3-2b.llamafile --cli',
    binary: 'llamafile',  // checked separately — see checkAvailability()
    available: false,
    driverPath: 'src/drivers/llamafile/driver.ts',
    specPath: null,
    notes: 'binary at ~/llamafiles/granite-vision-3.3-2b.llamafile',
  },
  {
    name: 'mlx-lm',
    tier: 2,
    launchCommand: 'mlx_lm.generate',
    binary: 'mlx_lm.generate',
    available: false,
    driverPath: 'src/drivers/mlx-lm/driver.ts',
    specPath: null,
    notes: 'RETIRED — Python module not installed',
  },
  {
    name: 'msty',
    tier: 2,
    launchCommand: 'msty',
    binary: 'msty',
    available: false,
    driverPath: 'src/drivers/msty/driver.ts',
    specPath: null,
    notes: 'not installed',
  },

  // Tier 3 — Lightweight CLI tools
  {
    name: 'llm',
    tier: 3,
    launchCommand: 'llm',
    binary: 'llm',
    available: false,
    driverPath: 'src/drivers/llm/driver.ts',
    specPath: null,
    notes: 'requires API key',
  },
  {
    name: 'lemonade',
    tier: 3,
    launchCommand: 'lemonade',
    binary: 'lemonade',
    available: false,
    driverPath: 'src/drivers/lemonade/driver.ts',
    specPath: null,
    notes: 'Electron GUI app — not a CLI agent',
  },
];

// ─── Runtime availability check ────────────────────────────────────────────

/**
 * Probe `which` for each agent's binary and update the `available` field in place.
 * Returns the same array (mutated) for chaining.
 */
export async function checkAvailability(agents: AgentEntry[] = AGENTS): Promise<AgentEntry[]> {
  await Promise.all(agents.map(async (agent) => {
    // Special case: llamafile is a standalone binary, not on PATH
    if (agent.name === 'llamafile') {
      const { status } = await execFileNoThrow('test', [
        '-f', `${process.env.HOME ?? '/tmp'}/llamafiles/granite-vision-3.3-2b.llamafile`,
      ]);
      agent.available = status === 'ok';
      return;
    }

    const result = await execFileNoThrow('which', [agent.binary]);
    agent.available = result.status === 'ok' && result.stdout.trim().length > 0;
  }));

  return agents;
}

/**
 * Return a single agent entry by name, or undefined.
 */
export function findAgent(name: string): AgentEntry | undefined {
  return AGENTS.find(a => a.name === name);
}
