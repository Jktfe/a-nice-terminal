import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

import { localhostOnly } from "./middleware/localhost.js";
import { apiKeyAuth } from "./middleware/auth.js";
import healthRoutes from "./routes/health.js";
import sessionRoutes from "./routes/sessions.js";
import messageRoutes from "./routes/messages.js";
import { registerSocketHandlers } from "./ws/handlers.js";

// Ensure DB is initialised
import "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.ANT_PORT || "3000", 10);

async function start() {
  const app = express();
  const httpServer = createServer(app);

  const io = new Server(httpServer, {
    cors: { origin: `http://127.0.0.1:${PORT}` },
  });

  // Make io available to route handlers
  app.set("io", io);

  // Middleware
  app.use(localhostOnly);
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

  httpServer.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  ANT running at http://127.0.0.1:${PORT}\n`);
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
