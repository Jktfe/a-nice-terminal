// ANT v3 — WebSocket Handler
// Replaces Socket.IO with native WebSocket for terminal I/O and real-time events

import { ptyManager } from './pty-manager';
import { ptyClient } from './pty-client';
import { queries } from './db';

interface WSClient {
  ws: WebSocket;
  sessionId: string | null;
  joinedSessions: Set<string>;
}

class WebSocketHandler {
  private clients = new Set<WSClient>();

  /** Handle a new WebSocket connection */
  handleConnection(ws: WebSocket): void {
    const client: WSClient = { ws, sessionId: null, joinedSessions: new Set() };
    this.clients.add(client);

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        this.handleMessage(client, msg);
      } catch {}
    });

    ws.addEventListener('close', () => {
      this.clients.delete(client);
    });
  }

  /** Route incoming WebSocket messages */
  private handleMessage(client: WSClient, msg: any): void {
    switch (msg.type) {
      case 'join_session':
        this.handleJoin(client, msg.sessionId);
        break;
      case 'leave_session':
        this.handleLeave(client, msg.sessionId);
        break;
      case 'terminal_input':
        this.handleTerminalInput(msg.sessionId, msg.data);
        break;
      case 'terminal_resize':
        ptyManager.resize(msg.sessionId, msg.cols, msg.rows);
        break;
      case 'check_health':
        this.sendToClient(client, {
          type: 'session_health',
          sessionId: msg.sessionId,
          alive: ptyManager.isAlive(msg.sessionId),
        });
        break;
    }
  }

  /** Join a session to receive real-time events */
  private handleJoin(client: WSClient, sessionId: string): void {
    client.joinedSessions.add(sessionId);

    // If terminal session exists and is alive, attach
    if (ptyManager.isAlive(sessionId)) {
      this.sendToClient(client, {
        type: 'session_health',
        sessionId,
        alive: true,
      });
    }
  }

  /** Leave a session */
  private handleLeave(client: WSClient, sessionId: string): void {
    client.joinedSessions.delete(sessionId);
  }

  /** Forward terminal input to PTY */
  private handleTerminalInput(sessionId: string, data: string): void {
    ptyManager.write(sessionId, data);
  }

  /** Broadcast to all clients that have joined a specific session */
  broadcastToSession(sessionId: string, message: any): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.joinedSessions.has(sessionId) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  /** Broadcast to ALL connected clients */
  broadcastAll(message: any): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  /** Send a message to a specific client */
  private sendToClient(client: WSClient, message: any): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  /** Wire up PTY output to broadcast (both in-process manager and daemon client) */
  init(): void {
    // ptyManager handles direct in-process sessions (fallback path).
    // ptyClient handles sessions running in the persistent daemon (primary path).
    // Both fire 'terminal_output' so PtyChat and xterm receive all output.
    ptyManager.onData((sessionId, data) => {
      this.broadcastToSession(sessionId, { type: 'terminal_output', sessionId, data });
    });
    ptyClient.onData((sessionId, data) => {
      this.broadcastToSession(sessionId, { type: 'terminal_output', sessionId, data });
    });
  }
}

export const wsHandler = new WebSocketHandler();
