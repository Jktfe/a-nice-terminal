/**
 * ANT app server — thin UI shell.
 *
 * Responsibilities:
 *   1. Serve the React / Vite frontend (dev middleware or static dist).
 *   2. Proxy /api/* and /socket.io/* to the daemon.
 *   3. Apply Tailscale-only host guard (security).
 *   4. Optionally terminate TLS so the browser can reach the frontend via HTTPS.
 *
 * All business logic (routes, WS handlers, DB, Chair, PTY) lives in packages/daemon.
 */

import express from "express";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

import { isAllowedHost, tailscaleOnly } from "./middleware/localhost.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.ANT_UI_PORT ?? process.env.ANT_PORT ?? "3000", 10);
const HOST = process.env.ANT_HOST ?? "0.0.0.0";

// The daemon's base URL — all /api/* and /socket.io/* calls are forwarded here.
const DAEMON_URL = process.env.ANT_DAEMON_URL ?? `http://localhost:${process.env.ANT_DAEMON_PORT ?? "6458"}`;

const TLS_CERT = process.env.ANT_TLS_CERT;
const TLS_KEY  = process.env.ANT_TLS_KEY;

// ─── TLS helper ───────────────────────────────────────────────────────────────

function createAppServer(app: express.Application) {
  if (TLS_CERT && TLS_KEY) {
    try {
      const cert = fs.readFileSync(TLS_CERT);
      const key  = fs.readFileSync(TLS_KEY);
      console.log(`  [TLS] Using cert: ${TLS_CERT}`);
      return { server: createHttpsServer({ cert, key }, app), protocol: "https" };
    } catch (err) {
      console.warn("  [TLS] Failed to read cert/key, falling back to HTTP:", err);
    }
  }
  return { server: createServer(app), protocol: "http" };
}

// ─── Proxy helper ────────────────────────────────────────────────────────────

/**
 * Forward an incoming Express request to the daemon and pipe the response back.
 * Works for regular HTTP and for WebSocket upgrade (handled separately via
 * the raw httpServer 'upgrade' event).
 */
function proxyRequest(
  req: express.Request,
  res: express.Response,
  daemonUrl: string,
): void {
  const parsed = new URL(daemonUrl);
  const isHttps = parsed.protocol === "https:";
  const reqFn   = isHttps ? httpsRequest : httpRequest;

  const options = {
    hostname: parsed.hostname,
    port:     parsed.port || (isHttps ? 443 : 80),
    path:     req.url,
    method:   req.method,
    headers:  { ...req.headers, host: parsed.host },
    // Daemon uses a self-signed cert — skip verification for same-machine proxy hops.
    rejectUnauthorized: false,
  };

  const proxyReq = reqFn(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.warn(`  [proxy] Daemon unreachable (${daemonUrl}):`, err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: "Daemon unreachable",
        detail: err.message,
        hint:   `Ensure antd is running and ANT_DAEMON_URL (${daemonUrl}) is correct.`,
      });
    }
  });

  req.pipe(proxyReq, { end: true });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function start() {
  const app = express();
  const { server: httpServer, protocol } = createAppServer(app);

  // ── Security: Tailscale / localhost guard ─────────────────────────────────
  app.use(tailscaleOnly);

  // ── Proxy /api/* → daemon ─────────────────────────────────────────────────
  // Express strips the mount prefix from req.url, so we must restore it before
  // forwarding — otherwise GET /api/health becomes GET /health on the daemon.
  app.use("/api", (req, res) => {
    req.url = "/api" + req.url;
    proxyRequest(req, res, DAEMON_URL);
  });

  // ── Proxy /socket.io/* (HTTP long-poll fallback) → daemon ─────────────────
  app.use("/socket.io", (req, res) => {
    req.url = "/socket.io" + req.url;
    proxyRequest(req, res, DAEMON_URL);
  });

  // ── WebSocket upgrade → daemon ────────────────────────────────────────────
  const daemonParsed = new URL(DAEMON_URL);
  const daemonIsHttps = daemonParsed.protocol === "https:";
  const daemonPort    = parseInt(daemonParsed.port || (daemonIsHttps ? "443" : "80"), 10);

  httpServer.on("upgrade", (req, socket, head) => {
    // Guard: only proxy upgrade requests from allowed hosts.
    const remoteIp = (socket as any).remoteAddress as string | undefined ?? "";
    if (!isAllowedHost(remoteIp)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    // Open a raw TCP (or TLS) connection to the daemon and tunnel the WS frames.
    import(daemonIsHttps ? "node:tls" : "node:net").then((netMod) => {
      const upstream: import("node:net").Socket = (netMod as any).connect(
        {
          host: daemonParsed.hostname,
          port: daemonPort,
          rejectUnauthorized: false,
        },
        () => {
          const headerLines = [
            `${req.method} ${req.url} HTTP/1.1`,
            `Host: ${daemonParsed.host}`,
            ...Object.entries(req.headers).map(
              ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`,
            ),
            "",
            "",
          ].join("\r\n");
          upstream.write(headerLines);
          upstream.write(head);
          socket.pipe(upstream);
          upstream.pipe(socket);
        },
      );

      upstream.on("error", (err: Error) => {
        console.warn("  [ws-proxy] Daemon WebSocket unreachable:", err.message);
        socket.destroy();
      });

      socket.on("error", () => upstream.destroy());
    }).catch((err) => {
      console.warn("  [ws-proxy] Failed to load net module:", err);
      socket.destroy();
    });
  });

  // ── Uploads served by daemon — but proxy the path just in case older clients
  //    hit /uploads directly on the UI server ────────────────────────────────
  app.use("/uploads", (req, res) => {
    proxyRequest(req, res, DAEMON_URL);
  });

  // ── Frontend: Vite dev middleware (dev) or static dist (prod) ────────────
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
    const distPath = path.join(__dirname, "..", "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // ── Global error handler ──────────────────────────────────────────────────
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[app-server] Unhandled error:", err);
    res.status(500).json({
      error: err.message ?? "Internal Server Error",
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });
  });

  // ── Listen ────────────────────────────────────────────────────────────────
  httpServer.listen(PORT, HOST, () => {
    console.log(`\n  ANT UI running at ${protocol}://${HOST}:${PORT}`);
    console.log(`  Proxying API + WS to daemon: ${DAEMON_URL}\n`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  function gracefulShutdown(signal: string) {
    console.log(`[app-server] Received ${signal} — shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000);
  }
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
}

// ── Uncaught error guards ────────────────────────────────────────────────────
process.on("uncaughtException",  (err) => console.error("Uncaught exception:", err));
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

start().catch((err) => {
  console.error("Failed to start ANT app server:", err);
  process.exit(1);
});
