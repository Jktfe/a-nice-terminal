import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// In dev, forward /api and /socket.io to the daemon (not the UI shell).
// ANT_DAEMON_URL overrides; ANT_DAEMON_PORT is a simpler alternative.
// Falls back to https on port 6458 (TLS is always on when certs are configured).
const DAEMON_URL =
  process.env.ANT_DAEMON_URL ??
  `https://127.0.0.1:${process.env.ANT_DAEMON_PORT ?? "6458"}`;

// Self-signed cert on localhost — skip verification for the dev proxy only.
const proxyOpts = { target: DAEMON_URL, secure: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    allowedHosts: true,
    proxy: {
      "/api": proxyOpts,
      "/socket.io": { ...proxyOpts, ws: true },
    },
  },
});
