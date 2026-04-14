# Agent Fingerprinting Pipeline — Integration Guide

## Overview

ANT includes an automated agent interaction fingerprinting pipeline that detects how terminal-based AI agents handle interactive events (permission requests, multi-choice prompts, confirmations, etc.) and generates normalised drivers for ANT's event bus.

The pipeline runs controlled experiments against each agent in a tmux session, captures their interaction patterns, and produces a validated TypeScript driver that implements the `AgentDriver` interface.

## Architecture

```
ant-probe/              Test harness (probe assets + prompts)
src/fingerprint/        Pipeline infrastructure
  agent-registry.ts     All known agents, launch commands, tiers
  capture.ts            tmux control mode capture daemon (100ms debounce)
  runner.ts             Probe runner + CLI entry point
  types.ts              NormalisedEvent, AgentDriver, DriverSpec types
  schema.sql            SQLite schema (probe_output, probe_screenshots, driver_specs)
  spec-diff.ts          Compare new spec vs existing, output diff report
  version-detector.ts   Detect agent version, flag stale drivers
src/drivers/            One directory per agent
  claude-code/          Reference implementation (Tier 1)
  gemini-cli/           Tier 1
  codex-cli/            Tier 1
  ollama/               Tier 2
  lm-studio/            Tier 2
  llamafile/            Tier 2
  mlx-lm/               Tier 2 (RETIRED)
  msty/                 Tier 2 (stub — not installed)
  llm/                  Tier 3
  lemonade/             Tier 3 (stub — GUI, out of scope)
```

## Commands

```bash
# List all agents with availability, versions, and stale status
npx tsx src/fingerprint/runner.ts --list

# Fingerprint a specific agent (runs P01-P10 probes)
npx tsx src/fingerprint/runner.ts --agent claude-code

# Fingerprint all available agents
npx tsx src/fingerprint/runner.ts --all

# Show what changed since last fingerprint
npx tsx src/fingerprint/runner.ts --diff
```

## How It Works

### The Normalisation Pattern

```
Agent produces interactive event (permission, choice, confirmation)
  -> ANT driver detects and classifies it
  -> Driver normalises it into ANT's internal event schema
  -> ANT chat UI renders a native web component for that event class
  -> User responds in chat (button click, option select, text input)
  -> Driver translates response back to agent's expected input format
  -> Agent proceeds
```

The chat UI never contains agent-specific logic. It only consumes normalised events. Adding a new agent means adding a driver — nothing else changes.

### Normalised Event Classes

| Class | Description | UI Component |
|-------|-------------|-------------|
| `permission_request` | Agent asking to read/write/execute | Approve / Deny card |
| `multi_choice` | Numbered or tab-able options | Button group |
| `confirmation` | Yes/no, proceed/cancel | Confirm / Cancel dialog |
| `free_text` | Agent asking for typed input | Inline text input |
| `tool_auth` | Authorising a specific tool use | Tool auth card |
| `progress` | Streaming / long-running task | Progress indicator |
| `error_retry` | Agent hit an error, needs direction | Retry / Abort / Modify card |

### AgentDriver Interface

Every driver implements this interface:

```typescript
interface AgentDriver {
  // Inspect raw tmux output and return a normalised event, or null
  detect(raw: RawEvent): NormalisedEvent | null;

  // Send the user's response back to the agent in its expected format
  respond(event: NormalisedEvent, choice: UserChoice): void;

  // Determine whether the interactive event has been resolved
  isSettled(event: NormalisedEvent, output: RawOutput): boolean;
}
```

## Adding a New Agent

1. **Check scope**: the agent must be fully operable from a terminal session with no GUI dependency.

2. **Add to registry**: edit `src/fingerprint/agent-registry.ts` with the agent's name, launch command, and tier.

3. **Run the pipeline**:
   ```bash
   npx tsx src/fingerprint/runner.ts --agent {name}
   ```
   This creates a tmux session, runs all 10 probes (P01-P10), captures output, and generates a driver spec.

4. **Review the spec**: check the generated `src/drivers/{name}/spec.json` for accuracy.

5. **Implement the driver**: create `src/drivers/{name}/driver.ts` implementing `AgentDriver`. The spec contains detection patterns, extraction methods, response formats, and settled signals for each event class.

6. **Document deviations**: create `src/drivers/{name}/NOTES.md` noting any differences from expected behaviour.

7. **Commit**: the driver is ready. No changes to ANT's core codebase needed.

## Re-running After Agent Updates

When an agent CLI updates, re-run the pipeline:

```bash
npx tsx src/fingerprint/runner.ts --agent {name}
```

The `--diff` flag shows what changed. If detection patterns shifted, update the driver. The version detector flags drivers as stale when the agent version doesn't match the `version_tested` in the spec.

## Probe Set (P01-P10)

Each probe targets a specific event class:

| ID | Target Class | Prompt |
|----|-------------|--------|
| P01 | permission_request (read) | Read the contents of test-file.txt |
| P02 | permission_request (write) | Create output.txt containing "hello" |
| P03 | permission_request (execute) | Run test-script.sh |
| P04 | multi_choice (numbered) | Give 3 options for a boolean variable name |
| P05 | multi_choice (tabable) | List files as selectable options |
| P06 | confirmation | Delete output.txt with confirmation |
| P07 | free_text | Ask for preferred programming language |
| P08 | progress | Write a 20-function Python module |
| P09 | tool_auth | Search the web for Node.js LTS version |
| P10 | error_retry | Read a non-existent file |

## Integration with ANT Chat UI

The fingerprinting pipeline produces drivers. To integrate a driver into ANT's live chat:

1. Import the driver in the session's event processing pipeline
2. On each tmux output line, call `driver.detect(rawEvent)`
3. If a `NormalisedEvent` is returned, render the corresponding web component in the chat
4. When the user interacts with the component, call `driver.respond(event, userChoice)`
5. Monitor output with `driver.isSettled(event, output)` to dismiss the component

The chat UI components for each event class are defined in the ANT frontend — they consume `NormalisedEvent` objects and emit `UserChoice` responses. The driver is the only agent-specific code.

## Current Driver Status

| Agent | Tier | Version | Status |
|-------|------|---------|--------|
| Claude Code | 1 | 2.1.89 | Fingerprinted, full TUI detection |
| Gemini CLI | 1 | 0.37.0 | Fingerprinted, mode-toggle based |
| Codex CLI | 1 | 0.118.0 | Fingerprinted, auto-run (no TUIs) |
| Ollama | 2 | latest | Fingerprinted, readline REPL |
| LM Studio | 2 | latest | Fingerprinted, non-interactive |
| llamafile | 2 | 0.9.3 | Fingerprinted, completion-only |
| mlx_lm | 2 | — | RETIRED |
| Msty | 2 | — | Not installed |
| llm | 3 | latest | Fingerprinted, plugin-based |
| lemonade | 3 | — | GUI, out of scope |
