import express from "express";
import { createServer } from "http";
import { Server, type Socket } from "socket.io";

import { isAllowedHost, tailscaleOnly } from "./middleware/localhost.js";
import { apiKeyAuth } from "./middleware/auth.js";
import messageRoutes from "./routes/messages.js";
import annotationRoutes from "./routes/annotations.js";
import storeRoutes from "./routes/store.js";
import { registerChatHandlers } from "./ws/chat-handlers.js";
import db from "./db.js";

const PORT = parseInt(process.env.ANT_CHAT_PORT || "6464", 10);
const HOST = process.env.ANT_HOST || "0.0.0.0";
const WS_API_KEY = process.env.ANT_API_KEY;

function getClientApiKey(socket: Socket): string | undefined {
  const handshake = (socket as any)?.handshake || {};
  const auth = (handshake.auth || {}) as Record<string, string | undefined>;
  const query = (handshake.query || {}) as Record<string, string | string[] | undefined>;
  const headers = (handshake.headers || {}) as Record<string, string | string[] | undefined>;

  const rawAuth = auth.apiKey || (query.apiKey as string | undefined);
  const headerApiKey = Array.isArray(headers["x-api-key"]) ? headers["x-api-key"][0] : headers["x-api-key"];
  const headerAuth = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;

  if (rawAuth) return rawAuth;
  if (headerApiKey) return headerApiKey;
  if (headerAuth?.startsWith("Bearer ")) return headerAuth.slice("Bearer ".length);
  return headerAuth;
}

function extractIp(socket: Socket): string {
  const remote = socket?.request?.socket?.remoteAddress as string | undefined;
  const direct = socket?.conn?.remoteAddress as string | undefined;
  const headers = ((socket as any)?.handshake?.headers || {}) as Record<string, string | string[] | undefined>;
  const xffRaw = headers["x-forwarded-for"];
  const xff = (typeof xffRaw === "string" ? xffRaw : "").split(",")[0].trim();
  return xff || remote || direct || "";
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
});

app.set("io", io);

// Socket.IO auth middleware
io.use((socket, next) => {
  const ip = extractIp(socket as any);
  if (!isAllowedHost(ip)) {
    return next(new Error("ANT is restricted to the configured local network."));
  }
  if (!WS_API_KEY) return next();
  const provided = getClientApiKey(socket);
  if (!provided) return next(new Error("Invalid or missing API key"));
  if (provided === WS_API_KEY) return next();
  next(new Error("Invalid or missing API key"));
});

// Express middleware — CORS must come before auth so preflight OPTIONS requests succeed
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", _req.headers.origin || "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(tailscaleOnly);
app.use(apiKeyAuth);
app.use(express.json());

// Routes
app.use(messageRoutes);
app.use(annotationRoutes);
app.use(storeRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "chat-sidecar" });
});

// WebSocket handlers
registerChatHandlers(io);

// Heartbeat
const HEARTBEAT_INTERVAL = 30_000;
const heartbeat = setInterval(() => {
  try {
    db.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)")
      .run("last_heartbeat_chat", new Date().toISOString());
  } catch {}
}, HEARTBEAT_INTERVAL);

// Graceful shutdown
function shutdown() {
  console.log("[chat-server] Shutting down...");
  clearInterval(heartbeat);
  try {
    db.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)")
      .run("last_shutdown_chat", new Date().toISOString());
  } catch {}
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

httpServer.listen(PORT, HOST, () => {
  console.log(`  ANT Chat Sidecar running at http://${HOST}:${PORT}`);
});
