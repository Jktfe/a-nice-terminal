import express from "express";
import { createServer } from "http";
import { Server, type Socket } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

import { isAllowedHost, tailscaleOnly } from "./middleware/localhost.js";
import { apiKeyAuth } from "./middleware/auth.js";
import healthRoutes from "./routes/health.js";
import sessionRoutes from "./routes/sessions.js";
import messageRoutes from "./routes/messages.js";
import { registerSocketHandlers } from "./ws/handlers.js";

// Ensure DB is initialised
import "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.ANT_PORT || "3000", 10);
const HOST = process.env.ANT_HOST || "0.0.0.0";
const WS_API_KEY = process.env.ANT_API_KEY;

function getClientApiKey(socket: Socket): string | undefined {
  const handshake = (socket as any)?.handshake || {};
  const auth = (handshake.auth || {}) as Record<string, string | undefined>;
  const query = (handshake.query || {}) as Record<string, string | string[] | undefined>;
  const headers = (handshake.headers || {}) as Record<string, string | string[] | undefined>;

  const rawAuth = auth.apiKey || (query.apiKey as string | undefined);
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

function extractIp(socket: Socket): string {
  const remote = socket?.request?.socket?.remoteAddress as string | undefined;
  const direct = socket?.conn?.remoteAddress as string | undefined;
  const xff = ((socket?.headers?.["x-forwarded-for"] as string | undefined) || "").split(",")[0].trim();
  return xff || remote || direct || "";
}

async function start() {
  const app = express();
  const httpServer = createServer(app);

  const io = new Server(httpServer, {
    cors: { origin: true },
  });

  // Make io available to route handlers
  app.set("io", io);
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

  // Middleware
  app.use(tailscaleOnly);
  app.use(apiKeyAuth);
  app.use(express.json());

  // API routes
  app.use(healthRoutes);
  app.use(sessionRoutes);
  app.use(messageRoutes);

  // WebSocket
  registerSocketHandlers(io);

  // Vite dev server or static files
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: path.join(__dirname, ".."),
      server: {
        middlewareMode: true,
        hmr: { port: PORT + 1 },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "..", "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`\n  ANT running at http://${HOST}:${PORT}\n`);
  });
}

// Prevent uncaught errors from crashing the server
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

start().catch((err) => {
  console.error("Failed to start ANT:", err);
  process.exit(1);
});
