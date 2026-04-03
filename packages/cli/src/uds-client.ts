import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const DEFAULT_SOCKET_PATH =
  process.env.ANT_SOCKET ?? path.join(os.tmpdir(), "ant", "antd.sock");

const TIMEOUT_MS = 10_000;

export class UdsClient {
  readonly socketPath: string;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? DEFAULT_SOCKET_PATH;
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    const id = randomUUID();
    const request = JSON.stringify({ id, method, params: params ?? null }) + "\n";

    return new Promise((resolve, reject) => {
      let settled = false;

      const socket = net.createConnection(this.socketPath);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(`UDS call timed out after ${TIMEOUT_MS / 1000}s (method: ${method})`));
      }, TIMEOUT_MS);

      socket.on("error", (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
          reject(new Error("antd not running — start with: ant daemon start"));
        } else {
          reject(err);
        }
      });

      socket.on("connect", () => {
        socket.write(request);
      });

      let buffer = "";

      socket.setEncoding("utf8");

      socket.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let response: { id: string; result?: unknown; error?: string };
          try {
            response = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (response.id !== id) continue;

          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();

          if (response.error !== undefined) {
            reject(new Error(response.error));
          } else {
            resolve(response.result);
          }
        }
      });

      socket.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("antd closed the connection before responding"));
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check socket file exists first (fast path, avoids connection attempt)
      fs.accessSync(this.socketPath);
    } catch {
      return false;
    }

    return new Promise((resolve) => {
      const socket = net.createConnection(this.socketPath);

      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 2_000);

      socket.on("connect", () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });

      socket.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }
}
