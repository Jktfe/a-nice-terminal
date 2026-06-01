/**
 * Runtime lifecycle guards for the bundled stdio MCP server.
 *
 * The MCP SDK's StdioServerTransport listens for stdin data/errors, but not
 * stdin end/close. Some host clients can leave old child processes alive while
 * spawning a replacement server. These guards keep that failure bounded without
 * changing the tool protocol itself.
 */

import { execFile as nodeExecFile } from 'node:child_process';
import process from 'node:process';
import type { EventEmitter } from 'node:events';

const MCP_PROCESS_MARKER = 'mcp-server-ant';
const MCP_ENTRY_MARKER = 'dist/index.js';

export type ProcessRow = {
  pid: number;
  ppid: number;
  command: string;
};

type ExecFile = typeof nodeExecFile;

export function parsePsOutput(output: string): ProcessRow[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3]
      };
    })
    .filter((row): row is ProcessRow => row !== null && Number.isFinite(row.pid) && Number.isFinite(row.ppid));
}

export function staleSiblingMcpPids(rows: ProcessRow[], currentPid: number, currentPpid: number): number[] {
  if (currentPpid <= 1) return [];
  return rows
    .filter((row) => row.ppid === currentPpid)
    .filter((row) => row.pid !== currentPid)
    .filter((row) => row.command.includes(MCP_PROCESS_MARKER))
    .filter((row) => row.command.includes(MCP_ENTRY_MARKER))
    .map((row) => row.pid);
}

export type ReapOptions = {
  enabled?: boolean;
  currentPid?: number;
  currentPpid?: number;
  platform?: NodeJS.Platform;
  execFile?: ExecFile;
  kill?: (pid: number, signal: NodeJS.Signals) => boolean;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
};

export async function reapOlderSiblingMcpServers(options: ReapOptions = {}): Promise<number[]> {
  const enabled = options.enabled ?? process.env.ANT_MCP_REAP_SIBLINGS !== '0';
  if (!enabled) return [];

  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux') return [];

  const currentPid = options.currentPid ?? process.pid;
  const currentPpid = options.currentPpid ?? process.ppid;
  if (currentPpid <= 1) return [];

  const execFile = options.execFile ?? nodeExecFile;
  const output = await execPs(execFile);
  const pids = staleSiblingMcpPids(parsePsOutput(output), currentPid, currentPpid);
  const kill = options.kill ?? process.kill.bind(process);
  const killed: number[] = [];
  for (const pid of pids) {
    try {
      kill(pid, 'SIGTERM');
      killed.push(pid);
    } catch {
      // The sibling may have exited between ps and kill. Treat as already
      // cleaned up; this guard should never stop the MCP server from starting.
    }
  }
  if (killed.length > 0) {
    options.stderr?.write(
      `@jktfe/mcp-server-ant reaped ${killed.length} stale sibling process(es): ${killed.join(',')}\n`
    );
  }
  return killed;
}

function execPs(execFile: ExecFile): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      ['-axo', 'pid=,ppid=,command='],
      { timeout: 2000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

export type StdinExitGuardOptions = {
  stdin?: EventEmitter;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  exit?: (code: number) => void;
};

export function installStdinExitGuards(options: StdinExitGuardOptions = {}): () => void {
  const stdin = options.stdin ?? process.stdin;
  const stderr = options.stderr ?? process.stderr;
  const exit = options.exit ?? process.exit.bind(process);
  let didExit = false;

  const exitOnce = (reason: string) => {
    if (didExit) return;
    didExit = true;
    stderr.write(`@jktfe/mcp-server-ant stdio ${reason}; exiting\n`);
    exit(0);
  };

  const onEnd = () => exitOnce('ended');
  const onClose = () => exitOnce('closed');

  stdin.once('end', onEnd);
  stdin.once('close', onClose);

  return () => {
    stdin.off('end', onEnd);
    stdin.off('close', onClose);
  };
}
