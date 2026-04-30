import { execFileSync } from 'child_process';
import { config } from './config.js';
import { api } from './api.js';

export type IdentitySource =
  | 'override-from'
  | 'override-session'
  | 'override-handle'
  | 'native-session'
  | 'native-pid-tree'
  | 'registered-pid'
  | 'configured-handle'
  | 'configured-handle-external'
  | 'fallback'
  | 'fallback-external';

export interface NativeSessionIdentity {
  isNative: boolean;
  sessionId: string | null;
}

export interface IdentityResolution {
  senderId: string;
  source: IdentitySource;
  native: NativeSessionIdentity;
  configuredHandle: string | null;
  configuredSessionId: string | null;
  handle?: string | null;
  displayName?: string | null;
  pid?: number | null;
  pidStart?: string | null;
}

export interface IdentityOverrides {
  from?: string | null;
  sessionId?: string | null;
  handle?: string | null;
}

export function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function safeExec(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

export interface ProcessIdentityEntry {
  pid: number;
  pid_start?: string | null;
}

export function pidStart(pid: number): string | null {
  return safeExec('ps', ['-o', 'lstart=', '-p', String(pid)]);
}

function parentPid(pid: number): number | null {
  const raw = safeExec('ps', ['-o', 'ppid=', '-p', String(pid)]);
  if (!raw) return null;
  const parent = Number(raw.trim());
  return Number.isFinite(parent) && parent > 0 ? parent : null;
}

export function processIdentityChain(startPid = process.pid, maxDepth = 32): ProcessIdentityEntry[] {
  const chain: ProcessIdentityEntry[] = [];
  const seen = new Set<number>();
  let pid: number | null = startPid;

  while (pid && pid > 1 && !seen.has(pid) && chain.length < maxDepth) {
    seen.add(pid);
    chain.push({ pid, pid_start: pidStart(pid) });
    pid = parentPid(pid);
  }

  return chain;
}

function detectTmuxSessionFromProcessTree(): NativeSessionIdentity {
  if (process.env.ANT_DISABLE_PID_IDENTITY === '1') {
    return { isNative: false, sessionId: null };
  }

  const chain = processIdentityChain();
  const pids = new Set(chain.map((entry) => entry.pid));
  const panes = safeExec('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_pid}']);
  if (!panes) return { isNative: false, sessionId: null };

  for (const line of panes.split('\n')) {
    const [sessionName, panePidRaw] = line.split('\t');
    const panePid = Number(panePidRaw);
    if (sessionName && Number.isFinite(panePid) && pids.has(panePid)) {
      return { isNative: true, sessionId: sessionName };
    }
  }

  return { isNative: false, sessionId: null };
}

/** Detect whether we're inside an ANT-managed tmux session. */
export function detectNativeSession(): NativeSessionIdentity {
  if (process.env.ANT_SESSION_ID) {
    return { isNative: true, sessionId: process.env.ANT_SESSION_ID };
  }

  if (process.env.TMUX) {
    const pane = process.env.TMUX_PANE;
    const tmuxArgs = pane
      ? ['display-message', '-p', '-t', pane, '#{session_name}']
      : ['display-message', '-p', '#{session_name}'];
    const name = safeExec('tmux', tmuxArgs);
    if (name) return { isNative: true, sessionId: name };
  }

  return detectTmuxSessionFromProcessTree();
}

/**
 * Resolve sender identity for chat messages.
 *
 * Native sessions use the ANT terminal session id so the server can resolve the
 * real handle/display name. External shells use the configured handle.
 */
export function resolveIdentityDetails(external = false, overrides: IdentityOverrides = {}): IdentityResolution {
  const configuredHandle = config.get('handle') || null;
  const configuredSessionId = config.get('sessionId') || null;
  const native = external ? { isNative: false, sessionId: null } : detectNativeSession();

  if (overrides.from?.trim()) {
    return {
      senderId: overrides.from.trim(),
      source: 'override-from',
      native,
      configuredHandle,
      configuredSessionId,
    };
  }

  if (overrides.sessionId?.trim()) {
    return {
      senderId: overrides.sessionId.trim(),
      source: 'override-session',
      native,
      configuredHandle,
      configuredSessionId,
    };
  }

  if (overrides.handle?.trim()) {
    return {
      senderId: normalizeHandle(overrides.handle),
      source: 'override-handle',
      native,
      configuredHandle,
      configuredSessionId,
    };
  }

  if (!external && native.isNative && native.sessionId) {
    return {
      senderId: native.sessionId,
      source: 'native-session',
      native,
      configuredHandle,
      configuredSessionId,
    };
  }

  if (configuredHandle) {
    return {
      senderId: configuredHandle,
      source: external ? 'configured-handle-external' : 'configured-handle',
      native,
      configuredHandle,
      configuredSessionId,
    };
  }

  return {
    senderId: external ? 'cli-external' : 'cli',
    source: external ? 'fallback-external' : 'fallback',
    native,
    configuredHandle,
    configuredSessionId,
  };
}

interface IdentityResolveCtx {
  serverUrl: string;
  apiKey: string;
  json: boolean;
}

export async function resolveIdentityDetailsAsync(
  ctx: IdentityResolveCtx,
  external = false,
  overrides: IdentityOverrides = {},
): Promise<IdentityResolution> {
  const explicit = resolveIdentityDetails(external, overrides);
  async function enrichSession(details: IdentityResolution): Promise<IdentityResolution> {
    if (!details.senderId || details.senderId.startsWith('@')) return details;
    try {
      const session = await api.get(ctx, `/api/sessions/${encodeURIComponent(details.senderId)}`);
      return {
        ...details,
        handle: session?.handle ?? null,
        displayName: session?.display_name ?? session?.name ?? null,
      };
    } catch {
      return details;
    }
  }

  if (
    explicit.source === 'override-from' ||
    explicit.source === 'override-session' ||
    explicit.source === 'override-handle' ||
    explicit.source === 'native-session' ||
    explicit.source === 'native-pid-tree'
  ) {
    return enrichSession(explicit);
  }

  if (!external && process.env.ANT_DISABLE_PID_IDENTITY !== '1') {
    try {
      const result = await api.post(ctx, '/api/identity/resolve', {
        pids: processIdentityChain(),
      });
      const identity = result?.identity;
      if (identity?.sender_id) {
        return {
          ...explicit,
          senderId: identity.sender_id,
          source: 'registered-pid',
          handle: identity.handle ?? null,
          displayName: identity.display_name ?? null,
          pid: identity.pid ?? null,
          pidStart: identity.pid_start ?? null,
        };
      }
    } catch {
      // Registry resolution is advisory; fall back to config/default identity.
    }
  }

  return explicit;
}

export function resolveIdentity(external = false, overrides: IdentityOverrides = {}): string {
  return resolveIdentityDetails(external, overrides).senderId;
}

export function identitySourceLabel(source: IdentitySource): string {
  switch (source) {
    case 'override-from': return 'explicit --from';
    case 'override-session': return 'explicit --session';
    case 'override-handle': return 'explicit --handle';
    case 'native-session': return 'ANT tmux session';
    case 'native-pid-tree': return 'ANT tmux process tree';
    case 'registered-pid': return 'registered process tree';
    case 'configured-handle': return 'configured handle';
    case 'configured-handle-external': return 'configured handle (--external)';
    case 'fallback-external': return 'fallback external identity';
    case 'fallback': return 'fallback identity';
  }
}

export function messageSenderLabel(message: any): string {
  if (message?.sender_id) return String(message.sender_id);
  if (message?.role === 'assistant') return 'ANT';
  if (message?.role === 'system') return 'system';
  return 'web';
}
