import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import express from "express";
import { Server, type Socket } from "socket.io";

import { createUdsServer } from "./uds-server.js";
import { writePid, removePid } from "./pid.js";
import { log, error } from "./logger.js";

import { isAllowedHost, tailscaleOnly } from "./middleware/localhost.js";
import { apiKeyAuth } from "./middleware/auth.js";

import healthRoutes from "./routes/health.js";
import sessionRoutes from "./routes/sessions.js";
import messageRoutes from "./routes/messages.js";
import uploadRoutes from "./routes/uploads.js";
import resumeCommandRoutes from "./routes/resume-commands.js";
import settingsRoutes from "./routes/settings.js";
import workspaceRoutes from "./routes/workspaces.js";
import agentRoutes from "./routes/agent.js";
import annotationRoutes from "./routes/annotations.js";
import storeRoutes from "./routes/store.js";
import bridgeRoutes from "./routes/bridge.js";
import agentV2Routes from "./routes/agent-v2.js";
import knowledgeRoutes from "./routes/knowledge.js";
import recipeRoutes from "./routes/recipes.js";
import coordinationRoutes from "./routes/coordination.js";
import chatRoomProtocolRoutes, { mountChatRoomRoutes } from "./routes/chat-rooms.js";
import retentionRoutes from "./routes/retention.js";
import commonCallsRoutes from "./routes/common-calls.js";
import tasksRoutes from "./routes/tasks.js";
import chairRoutes from "./routes/chair.js";
import terminalsRouter from "./routes/terminals.js";
import workflowsRouter from "./routes/workflows.js";
import exportRouter from "./routes/export.js";

import { registerSocketHandlers } from "./ws/handlers.js";
// Chat and terminal-namespace handlers are imported dynamically so the daemon
// degrades gracefully if either file is absent (e.g. during an incremental build).

import { reapOrphanedSessions } from "./pty-manager.js";
import { startRetentionScheduler, stopRetentionScheduler } from "./retention.js";
import { startChair, stopChair } from "./chair/chair.js";
import { setIo } from "./chair/terminal-monitor.js";
import { DbChatRoomRegistry } from "./db-chat-room-registry.js";
import { CaptureIngest } from "./capture-ingest.js";
import db from "./db.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SOCKET_PATH =
  process.env.ANT_SOCKET ?? path.join(os.tmpdir(), "ant", "antd.sock");

const HTTP_PORT = parseInt(process.env.ANT_PORT ?? "6458", 10);
const HTTP_HOST = process.env.ANT_HOST ?? "0.0.0.0";
const WS_API_KEY = process.env.ANT_API_KEY;

const PID_FILE = path.join(path.dirname(SOCKET_PATH), "antd.pid");

// ─── Auth sanity check ────────────────────────────────────────────────────────
// If both network-level guard (Tailscale) and API key auth are simultaneously
// disabled, the daemon is wide open to any reachable host. Refuse to start.
{
  const tailscaleOnly = process.env.ANT_TAILSCALE_ONLY;
  const tailscaleEnabled = tailscaleOnly === undefined || tailscaleOnly === "" ||
    !["false", "0", "no", "off", "n"].includes(tailscaleOnly.toLowerCase());
  if (!tailscaleEnabled && !WS_API_KEY) {
    console.error(
      "[antd] FATAL: ANT_TAILSCALE_ONLY is disabled and ANT_API_KEY is not set.\n" +
      "       The daemon would be accessible to any host without authentication.\n" +
      "       Set ANT_API_KEY or re-enable ANT_TAILSCALE_ONLY before starting."
    );
    process.exit(1);
  }
}

// ─── TLS ─────────────────────────────────────────────────────────────────────

const TLS_CERT = process.env.ANT_TLS_CERT;
const TLS_KEY = process.env.ANT_TLS_KEY;

function createAppServer(app: express.Application) {
  if (TLS_CERT && TLS_KEY) {
    try {
      const cert = fs.readFileSync(TLS_CERT);
      const key = fs.readFileSync(TLS_KEY);
      log("antd", `TLS: using cert ${TLS_CERT}`);
      return { server: createHttpsServer({ cert, key }, app), protocol: "https" };
    } catch (err) {
      error("antd", "TLS: failed to read cert/key, falling back to HTTP", err);
    }
  }
  return { server: createServer(app), protocol: "http" };
}

// ─── Socket.IO helpers ────────────────────────────────────────────────────────

function getClientApiKey(socket: Socket): string | undefined {
  const handshake = (socket as any)?.handshake ?? {};
  const auth = (handshake.auth ?? {}) as Record<string, string | undefined>;
  const query = (handshake.query ?? {}) as Record<string, string | string[] | undefined>;
  const headers = (handshake.headers ?? {}) as Record<string, string | string[] | undefined>;

  const rawAuth = auth.apiKey ?? (query.apiKey as string | undefined);
  const headerApiKey = Array.isArray(headers["x-api-key"])
    ? headers["x-api-key"][0]
    : headers["x-api-key"];
  const headerAuth = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;

  if (rawAuth) return rawAuth;
  if (headerApiKey) return headerApiKey;
  if (headerAuth?.startsWith("Bearer ")) return headerAuth.slice("Bearer ".length);
  return headerAuth;
}

// Use the actual TCP peer address — never trust X-Forwarded-For by default.
function extractIp(socket: Socket): string {
  const remote = (socket as any)?.request?.socket?.remoteAddress as string | undefined;
  const direct = (socket as any)?.conn?.remoteAddress as string | undefined;
  return remote ?? direct ?? "";
}

// ─── Socket dir / stale socket helpers ───────────────────────────────────────

function ensureSocketDir(): void {
  fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true });
}

function removeStaleSocket(): void {
  try {
    fs.unlinkSync(SOCKET_PATH);
    log("antd", "Removed stale socket file");
  } catch {
    // File does not exist — nothing to do
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function start(): Promise<void> {
  log("antd", `Starting antd (pid ${process.pid})`);
  log("antd", `UDS socket: ${SOCKET_PATH}`);
  log("antd", `HTTP port: ${HTTP_PORT}`);

  // ── Prepare socket dir + PID ──────────────────────────────────────────────
  ensureSocketDir();
  removeStaleSocket();
  writePid(PID_FILE);

  // ── Express app ───────────────────────────────────────────────────────────
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true }));

  // ── HTTP / HTTPS server ───────────────────────────────────────────────────
  const { server: httpServer, protocol } = createAppServer(app);

  // ── Socket.IO ─────────────────────────────────────────────────────────────
  const io = new Server(httpServer, {
    cors: { origin: true },
  });

  // Make io available to route handlers that need to emit events
  app.set("io", io);

  // Inject io into terminal monitor (must happen before startChair)
  setIo(io);

  // Socket.IO auth middleware (default namespace)
  io.use((socket, next) => {
    const ip = extractIp(socket);
    if (!isAllowedHost(ip)) {
      return next(new Error("ANT is restricted to the configured local network."));
    }
    if (!WS_API_KEY) return next();
    const provided = getClientApiKey(socket);
    if (!provided) return next(new Error("Invalid or missing API key"));
    if (provided === WS_API_KEY) return next();
    next(new Error("Invalid or missing API key"));
  });

  // ── Middleware ────────────────────────────────────────────────────────────
  app.use(tailscaleOnly);
  app.use(apiKeyAuth);

  // ── Routes ───────────────────────────────────────────────────────────────
  app.use(healthRoutes);
  app.use(sessionRoutes);
  app.use(messageRoutes);
  app.use(uploadRoutes);
  app.use(resumeCommandRoutes);
  app.use(settingsRoutes);
  app.use(workspaceRoutes);
  app.use(agentRoutes);
  app.use(annotationRoutes);
  app.use(storeRoutes);
  app.use(bridgeRoutes);
  app.use(agentV2Routes);
  app.use(knowledgeRoutes);
  app.use(recipeRoutes);
  app.use(coordinationRoutes);
  app.use(chatRoomProtocolRoutes);

  // Shared registry — DB-backed, persists across restarts
  const chatRoomRegistry = new DbChatRoomRegistry(db);
  mountChatRoomRoutes(app, () => chatRoomRegistry);

  app.use(retentionRoutes);
  app.use(commonCallsRoutes);
  app.use(tasksRoutes);
  app.use(chairRoutes);
  app.use(terminalsRouter);
  app.use(workflowsRouter);
  app.use(exportRouter);

  // ── WebSocket handlers ────────────────────────────────────────────────────

  // Control plane (default namespace)
  registerSocketHandlers(io);

  // Chat streaming handlers — dynamic import so daemon degrades gracefully
  // if the file is absent during an incremental build or partial deploy.
  try {
    const { registerChatHandlers } = await import("./ws/chat-handlers.js");
    registerChatHandlers(io);
  } catch {
    log("antd", "ws/chat-handlers.ts not available — skipping");
  }

  // Terminal namespace — same graceful-degradation guard.
  try {
    const { registerTerminalNamespace } = await import("./ws/terminal-namespace.js");
    const termNs = registerTerminalNamespace(io);

    // Apply same auth guard to the terminal namespace
    termNs.use((socket, next) => {
      const ip = extractIp(socket as unknown as Socket);
      if (!isAllowedHost(ip)) {
        return next(new Error("ANT is restricted to the configured local network."));
      }
      if (!WS_API_KEY) return next();
      const provided = getClientApiKey(socket as unknown as Socket);
      if (!provided) return next(new Error("Invalid or missing API key"));
      if (provided === WS_API_KEY) return next();
      next(new Error("Invalid or missing API key"));
    });
  } catch {
    log("antd", "ws/terminal-namespace.ts not yet available — skipping (Step 8)");
  }

  // ── Global error handler ──────────────────────────────────────────────────
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    error("antd", "Unhandled error", err);
    res.status(500).json({
      error: err.message ?? "Internal Server Error",
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });
  });

  // ── UDS server ────────────────────────────────────────────────────────────
  const udsServer = createUdsServer(SOCKET_PATH);

  // ── Start HTTP server ─────────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
      log("antd", `HTTP listening at ${protocol}://${HTTP_HOST}:${HTTP_PORT}`);
      resolve();
    });
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  const upsertState = db.prepare(
    "INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)"
  );
  upsertState.run("last_heartbeat", new Date().toISOString());
  // Clear any stale shutdown timestamp from a previous run
  db.prepare("DELETE FROM server_state WHERE key = 'last_shutdown'").run();

  const heartbeatInterval = setInterval(() => {
    upsertState.run("last_heartbeat", new Date().toISOString());
  }, 30_000);

  // ── Background services ───────────────────────────────────────────────────

  // Re-adopt or schedule cleanup of orphaned dtach sessions
  reapOrphanedSessions();

  // Archive retention — daily sweep
  startRetentionScheduler(io);

  // Chair — ambient orchestrator (respects chairman_enabled flag)
  startChair(io, chatRoomRegistry);

  // Capture ingest — tail ant-capture log/event files into SQLite
  let captureIngest: CaptureIngest | null = null;
  const captureDir = process.env.ANT_CAPTURE_DIR;
  if (captureDir) {
    captureIngest = new CaptureIngest(db, captureDir);
    captureIngest.start();
    log("antd", `Capture ingest started (watching ${captureDir})`);
  } else {
    log("antd", "Capture ingest disabled (set ANT_CAPTURE_DIR to enable)");
  }

  // Nudge all reconnecting clients to reload state
  setTimeout(() => io.emit("session_list_changed"), 1000);

  log("antd", "Ready");

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  function gracefulShutdown(signal: string): void {
    log("antd", `Received ${signal} — shutting down`);
    upsertState.run("last_shutdown", new Date().toISOString());
    clearInterval(heartbeatInterval);

    stopChair();
    stopRetentionScheduler();
    if (captureIngest) captureIngest.stop();

    udsServer.close(() => {
      log("antd", "UDS server closed");
    });

    io.close();
    httpServer.close(() => {
      log("antd", "HTTP server closed");
      removePid(PID_FILE);
      removeStaleSocket();
      process.exit(0);
    });

    // Force exit after 5 s if connections don't drain
    setTimeout(() => process.exit(0), 5_000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

// ── Uncaught error guards ────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  error("antd", "Uncaught exception", err);
});
process.on("unhandledRejection", (err) => {
  error("antd", "Unhandled rejection", err instanceof Error ? err : new Error(String(err)));
});

start().catch((err) => {
  error("antd", "Fatal startup error", err);
  process.exit(1);
});
