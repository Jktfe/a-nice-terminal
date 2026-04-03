import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Format } from "../output.js";
import * as out from "../output.js";
import { UdsClient } from "../uds-client.js";

// ---------------------------------------------------------------------------
// Paths — mirror the daemon's own conventions
// ---------------------------------------------------------------------------

const SOCKET_PATH =
  process.env.ANT_SOCKET ?? path.join(os.tmpdir(), "ant", "antd.sock");

const SOCKET_DIR = path.dirname(SOCKET_PATH);
const PID_FILE = path.join(SOCKET_DIR, "antd.pid");

// Resolve daemon entry relative to this package's location in the monorepo.
// packages/cli/src/commands/ → packages/daemon/src/index.ts
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DAEMON_ENTRY = path.resolve(__dirname, "../../../daemon/src/index.ts");

// ---------------------------------------------------------------------------
// PID helpers (mirrors daemon/src/pid.ts — no cross-package import needed)
// ---------------------------------------------------------------------------

function readPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removePid(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // Already gone — fine
  }
}

// ---------------------------------------------------------------------------
// daemon start
// ---------------------------------------------------------------------------

export async function daemonStart(opts: { format: Format }): Promise<void> {
  // Check if already running
  const existingPid = readPid();
  if (existingPid !== null && isRunning(existingPid)) {
    if (opts.format === "json") {
      process.stdout.write(JSON.stringify({ running: true, pid: existingPid, started: false }) + "\n");
    } else {
      process.stdout.write(`antd already running (pid ${existingPid})\n`);
    }
    return;
  }

  // Clean up stale PID
  if (existingPid !== null) removePid();

  // Ensure socket directory exists
  fs.mkdirSync(SOCKET_DIR, { recursive: true });

  // Find tsx — prefer local node_modules, fall back to PATH
  const tsxPath = findTsx();

  const child = spawn(tsxPath, [DAEMON_ENTRY], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  child.unref();

  // Brief wait then verify it started
  await new Promise<void>((resolve) => setTimeout(resolve, 400));

  const pid = readPid();

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify({ started: true, pid: pid ?? null }) + "\n");
  } else {
    if (pid !== null) {
      process.stdout.write(`antd started (pid ${pid})\n`);
    } else {
      process.stdout.write(`antd spawned — PID file not yet written. Check logs.\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// daemon stop
// ---------------------------------------------------------------------------

export async function daemonStop(opts: { format: Format }): Promise<void> {
  const pid = readPid();

  if (pid === null) {
    if (opts.format === "json") {
      process.stdout.write(JSON.stringify({ running: false, stopped: false }) + "\n");
    } else {
      process.stdout.write("antd not running (no PID file).\n");
    }
    return;
  }

  if (!isRunning(pid)) {
    removePid();
    if (opts.format === "json") {
      process.stdout.write(JSON.stringify({ running: false, stopped: false, stale: true }) + "\n");
    } else {
      process.stdout.write(`antd not running (stale pid ${pid} removed).\n`);
    }
    return;
  }

  process.kill(pid, "SIGTERM");

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify({ stopped: true, pid }) + "\n");
  } else {
    process.stdout.write(`antd stopped (pid ${pid}).\n`);
  }
}

// ---------------------------------------------------------------------------
// daemon status
// ---------------------------------------------------------------------------

export async function daemonStatus(opts: { format: Format }): Promise<void> {
  const pid = readPid();

  if (pid === null) {
    if (opts.format === "json") {
      process.stdout.write(JSON.stringify({ running: false }) + "\n");
    } else {
      process.stdout.write("antd: not running\n");
    }
    return;
  }

  const running = isRunning(pid);

  if (!running) {
    removePid();
  }

  // Optionally probe the UDS socket
  const uds = new UdsClient(SOCKET_PATH);
  const socketReady = running ? await uds.isAvailable() : false;

  const status = {
    running,
    pid: running ? pid : null,
    socketPath: SOCKET_PATH,
    socketReady,
  };

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(status) + "\n");
  } else {
    if (running) {
      process.stdout.write(`antd: running (pid ${pid})\n`);
      process.stdout.write(`socket: ${socketReady ? "ready" : "not yet ready"} — ${SOCKET_PATH}\n`);
    } else {
      process.stdout.write(`antd: not running (stale pid ${pid} cleared)\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// daemon restart
// ---------------------------------------------------------------------------

export async function daemonRestart(opts: { format: Format }): Promise<void> {
  await daemonStop({ format: "human" }); // always stop quietly; we control output here
  // Brief pause to let the socket release
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  await daemonStart(opts);
}

// ---------------------------------------------------------------------------
// Internal: find tsx binary
// ---------------------------------------------------------------------------

function findTsx(): string {
  // Walk up from this file to find the monorepo root node_modules/.bin/tsx
  const candidates = [
    path.resolve(__dirname, "../../../../node_modules/.bin/tsx"),
    path.resolve(__dirname, "../../../node_modules/.bin/tsx"),
    path.resolve(__dirname, "../../node_modules/.bin/tsx"),
    "tsx", // fall back to PATH
  ];

  for (const candidate of candidates) {
    if (candidate === "tsx") return candidate;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not found here
    }
  }

  return "tsx";
}
