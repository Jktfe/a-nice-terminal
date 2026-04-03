import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createUdsServer } from "./uds-server.js";
import { writePid, removePid } from "./pid.js";
import { log, error } from "./logger.js";

const SOCKET_PATH =
  process.env.ANT_SOCKET ?? path.join(os.tmpdir(), "ant", "antd.sock");

const HTTP_PORT = parseInt(process.env.ANT_PORT ?? "6458", 10);

const PID_FILE = path.join(path.dirname(SOCKET_PATH), "antd.pid");

function ensureSocketDir(): void {
  const dir = path.dirname(SOCKET_PATH);
  fs.mkdirSync(dir, { recursive: true });
}

function removeStaleSocket(): void {
  try {
    fs.unlinkSync(SOCKET_PATH);
    log("antd", "Removed stale socket file");
  } catch {
    // File does not exist — nothing to do
  }
}

function shutdown(udsServer: ReturnType<typeof createUdsServer>, httpServer: http.Server): void {
  log("antd", "Shutting down...");

  udsServer.close(() => {
    log("antd", "UDS server closed");
  });

  httpServer.close(() => {
    log("antd", "HTTP server closed");
  });

  removeStaleSocket();
  removePid(PID_FILE);

  // Allow in-flight close callbacks to fire before hard exit
  setTimeout(() => process.exit(0), 300);
}

export async function start(): Promise<void> {
  log("antd", `Starting antd (pid ${process.pid})`);
  log("antd", `UDS socket: ${SOCKET_PATH}`);
  log("antd", `HTTP port: ${HTTP_PORT}`);

  ensureSocketDir();
  removeStaleSocket();
  writePid(PID_FILE);

  // --- UDS server ---
  const udsServer = createUdsServer(SOCKET_PATH);

  // --- HTTP server (kept for web UI / socket.io compat) ---
  const httpServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "antd", pid: process.pid }));
  });

  httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
    log("antd", `HTTP listening on 127.0.0.1:${HTTP_PORT}`);
  });

  httpServer.on("error", (err) => {
    error("antd", "HTTP server error", err);
  });

  // --- Signal handling ---
  const handleSignal = () => shutdown(udsServer, httpServer);
  process.on("SIGTERM", handleSignal);
  process.on("SIGINT", handleSignal);

  log("antd", "Ready");
}

start().catch((err) => {
  error("antd", "Fatal startup error", err);
  process.exit(1);
});
