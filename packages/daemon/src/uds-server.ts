import net from "node:net";
import { log, error } from "./logger.js";

interface RpcRequest {
  id: string;
  method: string;
  params: unknown;
}

interface RpcResponse {
  id: string;
  result?: unknown;
  error?: string;
}

const STUB = { ok: true, stub: true };

const HANDLERS: Record<string, (params: unknown) => unknown> = {
  "session.list": (_params) => STUB,
  "session.create": (_params) => STUB,
  "session.get": (_params) => STUB,
  "chat.list": (_params) => STUB,
  "chat.send": (_params) => STUB,
  "terminal.create": (_params) => STUB,
  "terminal.input": (_params) => STUB,
  "terminal.focus": (_params) => STUB,
};

function handleMessage(raw: string): RpcResponse | null {
  let req: RpcRequest;
  try {
    req = JSON.parse(raw) as RpcRequest;
  } catch {
    return null; // Malformed — skip silently
  }

  const { id, method, params } = req;
  log("uds", `${method}`, { id });

  const handler = HANDLERS[method];
  if (!handler) {
    return { id, error: `Unknown method: ${method}` };
  }

  try {
    const result = handler(params);
    return { id, result };
  } catch (err) {
    error("uds", `Handler error for ${method}`, err);
    return { id, error: err instanceof Error ? err.message : "Internal error" };
  }
}

export function createUdsServer(socketPath: string): net.Server {
  const server = net.createServer((socket) => {
    log("uds", "Client connected");

    let buffer = "";

    socket.setEncoding("utf8");

    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) fragment in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const response = handleMessage(trimmed);
        if (response) {
          socket.write(JSON.stringify(response) + "\n");
        }
      }
    });

    socket.on("end", () => {
      log("uds", "Client disconnected");
    });

    socket.on("error", (err) => {
      error("uds", "Socket error", err);
    });
  });

  server.on("error", (err) => {
    error("uds", "Server error", err);
  });

  server.listen(socketPath, () => {
    log("uds", `Listening on ${socketPath}`);
  });

  return server;
}
