import { execFileSync } from "node:child_process";

const MAX_CHAIN_DEPTH = 32;

function readProcessField(pid: number, field: "lstart" | "ppid"): string | null {
  try {
    return execFileSync("ps", ["-o", `${field}=`, "-p", String(pid)], { stdio: "pipe" }).toString().trim();
  } catch {
    return null;
  }
}

function normalisePidStart(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function processIdentityChain(startPid = process.pid, maxDepth = MAX_CHAIN_DEPTH) {
  const chain: Array<{ pid: number; pid_start: string | null }> = [];
  const visited = new Set<number>();
  let cursor: number | null = startPid;
  while (cursor && cursor > 1 && !visited.has(cursor) && chain.length < maxDepth) {
    visited.add(cursor);
    chain.push({ pid: cursor, pid_start: normalisePidStart(readProcessField(cursor, "lstart")) });
    const parent = Number(readProcessField(cursor, "ppid"));
    cursor = Number.isFinite(parent) && parent > 0 ? parent : null;
  }
  return chain;
}
