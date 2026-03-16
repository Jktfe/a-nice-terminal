import { io, type Socket } from "socket.io-client";
import type { Client } from "./client.js";
import type { Format } from "./output.js";
import type { ResolvedSession } from "./resolve.js";
import * as out from "./output.js";

function connectSocket(client: Client, namespace?: string): Socket {
  const url = namespace ? `${client.config.server}${namespace}` : client.config.server;
  const socket = io(url, {
    transports: ["websocket"],
    auth: client.config.apiKey ? { apiKey: client.config.apiKey } : undefined,
    query: client.config.apiKey ? { apiKey: client.config.apiKey } : undefined,
  });
  return socket;
}

export async function followSession(
  client: Client,
  session: ResolvedSession,
  format: Format,
  plain?: boolean,
): Promise<void> {
  return new Promise((resolve) => {
    if (session.type === "conversation") {
      const socket = connectSocket(client);
      socket.on("connect", () => {
        socket.emit("join_session", { sessionId: session.id });
      });
      socket.on("message_created", (message: any) => {
        if (message.session_id !== session.id) return;
        if (format === "json") { out.json(message); } else { out.messageLine(message); }
      });
      process.on("SIGINT", () => { socket.disconnect(); resolve(); });
    } else {
      const socket = connectSocket(client, "/terminal");
      socket.on("connect", () => {
        socket.emit("join", { sid: session.id });
      });
      socket.on("out", ({ sid, d }: { sid: string; d: ArrayBuffer | Uint8Array | string }) => {
        if (sid !== session.id) return;
        let data = typeof d === "string" ? d : new TextDecoder().decode(d);
        if (plain) data = data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
        process.stdout.write(data);
      });
      process.on("SIGINT", () => {
        socket.emit("leave", { sid: session.id });
        socket.disconnect();
        resolve();
      });
    }
  });
}

export async function attachTerminal(client: Client, session: ResolvedSession): Promise<number> {
  return new Promise((resolve) => {
    const socket = connectSocket(client, "/terminal");
    let cleaned = false;

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      socket.emit("leave", { sid: session.id });
      socket.disconnect();
    }

    socket.on("connect", () => {
      socket.emit("join", { sid: session.id });
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();

      process.stdin.on("data", (data: Buffer) => {
        // Detach on ctrl+] (0x1d)
        if (data.length === 1 && data[0] === 0x1d) {
          cleanup();
          resolve(0);
          return;
        }
        socket.emit("in", { sid: session.id, d: data });
      });
    });

    socket.on("out", ({ sid, d }: { sid: string; d: ArrayBuffer | Uint8Array | string }) => {
      if (sid !== session.id) return;
      const data = typeof d === "string" ? d : Buffer.from(d);
      process.stdout.write(data);
    });

    socket.on("disconnect", () => { cleanup(); resolve(1); });
    process.on("SIGINT", () => { cleanup(); resolve(130); });
    process.on("exit", cleanup);
  });
}
