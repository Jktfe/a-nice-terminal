#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HOST = process.env.ANT_HOST || "127.0.0.1";
const PORT = process.env.ANT_PORT || "3000";
const EFFECTIVE_HOST = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
const BASE_URL = process.env.ANT_BASE_URL || `http://${EFFECTIVE_HOST}:${PORT}`;
const API_KEY = process.env.ANT_API_KEY;
const TERMINAL_TEXT_LIMIT = 10_000;
const MAX_TERMINAL_COLS = 500;
const MAX_TERMINAL_ROWS = 200;

type AntErrorPayload = { error?: string; details?: string; [key: string]: unknown };

class AntApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown, message: string) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function getReadableErrorPayload(payload: unknown): string {
  if (typeof payload === "string" && payload.length > 0) return payload;
  if (payload && typeof payload === "object") {
    const details = payload as AntErrorPayload;
    if (details.error && details.details) return `${details.error}: ${details.details}`;
    if (details.error) return details.error;
  }
  return "Unexpected API error";
}

function makeErrorPayload(error: unknown): { status: number; payload: unknown } | null {
  if (error instanceof AntApiError) {
    return { status: error.status, payload: error.payload };
  }
  return null;
}

async function api(path: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });

  if (!res.ok) {
    const body = await res.text();
    let payload: unknown = body;
    try {
      payload = JSON.parse(body);
    } catch (_err) {
      // Keep raw body text as payload for non-json responses.
    }
    throw new AntApiError(
      res.status,
      payload,
      `ANT API error ${res.status}: ${getReadableErrorPayload(payload)}`
    );
  }

  return res.json();
}

const server = new McpServer({
  name: "a-nice-terminal",
  version: "0.1.0",
});

const ROLE_ENUM = z.enum(["human", "agent", "system"]);
const FORMAT_ENUM = z.enum(["markdown", "text", "plaintext", "json"]);

// List sessions
server.tool(
  "ant_list_sessions",
  "List all ANT sessions (both terminal and conversation)",
  {},
  async () => {
    const sessions = await api("/api/sessions");
    return {
      content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
    };
  }
);

// Create session
server.tool(
  "ant_create_session",
  "Create a new ANT session",
  {
    type: z
      .enum(["terminal", "conversation"])
      .describe("Session type: 'terminal' for shell, 'conversation' for text"),
    name: z.string().optional().describe("Session name"),
  },
  async ({ type, name }) => {
    const session = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ type, name }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
    };
  }
);

// Read messages
server.tool(
  "ant_read_messages",
  "Read messages from a conversation session",
  {
    sessionId: z.string().describe("Session ID"),
    since: z
      .string()
      .optional()
      .describe("ISO timestamp - only return messages after this time"),
    limit: z.number().optional().describe("Max messages to return (default 100)"),
  },
  async ({ sessionId, since, limit }) => {
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    if (limit) params.set("limit", String(limit));

    const qs = params.toString();
    const messages = await api(
      `/api/sessions/${sessionId}/messages${qs ? `?${qs}` : ""}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
    };
  }
);

// Send message
server.tool(
  "ant_send_message",
  "Send a message to a conversation session",
  {
    sessionId: z.string().describe("Session ID"),
    content: z.string().describe("Message content (markdown supported)"),
    role: ROLE_ENUM.default("human").describe("Message role"),
    format: FORMAT_ENUM.default("markdown").describe("Message format"),
  },
  async ({ sessionId, content, role, format }) => {
    const message = await api(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content, format }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(message, null, 2) }],
    };
  }
);

// Start streaming message
server.tool(
  "ant_stream_message",
  "Start a streaming message (returns message ID for later completion)",
  {
    sessionId: z.string().describe("Session ID"),
    role: ROLE_ENUM.default("human").describe("Message role"),
    format: FORMAT_ENUM.default("markdown").describe("Message format"),
  },
  async ({ sessionId, role, format }) => {
    const message = await api(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content: "", format, status: "streaming" }),
    });
    return {
      content: [
        {
          type: "text",
          text: `Streaming message created. ID: ${message.id}\nUse ant_complete_stream to finalise with content.`,
        },
      ],
    };
  }
);

// Complete streaming message
server.tool(
  "ant_complete_stream",
  "Finalise a streaming message with the full content",
  {
    sessionId: z.string().describe("Session ID"),
    messageId: z.string().describe("Message ID from ant_stream_message"),
    content: z.string().describe("Full message content"),
  },
  async ({ sessionId, messageId, content }) => {
    const message = await api(
      `/api/sessions/${sessionId}/messages/${messageId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ content, status: "complete" }),
      }
    );
    return {
      content: [{ type: "text", text: JSON.stringify(message, null, 2) }],
    };
  }
);

// Send terminal input
server.tool(
  "ant_terminal_input",
  "Write input to a terminal session",
  {
    sessionId: z.string().describe("Session ID"),
    data: z.string().max(TERMINAL_TEXT_LIMIT).describe("Terminal input to write"),
  },
  async ({ sessionId, data }) => {
    try {
      const result = await api(`/api/sessions/${sessionId}/terminal/input`, {
        method: "POST",
        body: JSON.stringify({ data }),
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: details.status, error: details.payload },
                null,
                2
              ),
            },
          ],
        };
      }
      throw error;
    }
  }
);

// Resize terminal
server.tool(
  "ant_terminal_resize",
  "Resize the terminal for a terminal session",
  {
    sessionId: z.string().describe("Session ID"),
    cols: z.number().int().min(1).max(MAX_TERMINAL_COLS).describe("New terminal width in columns"),
    rows: z.number().int().min(1).max(MAX_TERMINAL_ROWS).describe("New terminal height in rows"),
  },
  async ({ sessionId, cols, rows }) => {
    try {
      const result = await api(`/api/sessions/${sessionId}/terminal/resize`, {
        method: "POST",
        body: JSON.stringify({ cols, rows }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: details.status, error: details.payload },
                null,
                2
              ),
            },
          ],
        };
      }
      throw error;
    }
  }
);

// Read terminal output (cursor-based)
server.tool(
  "ant_read_terminal_output",
  "Read terminal output events from a terminal session",
  {
    sessionId: z.string().describe("Session ID"),
    since: z.number().optional().describe("Event cursor to start from"),
    limit: z.number().optional().describe("Maximum events to return"),
  },
  async ({ sessionId, since, limit }) => {
    const params = new URLSearchParams();
    if (typeof since === "number") params.set("since", String(Math.max(0, since)));
    if (typeof limit === "number") params.set("limit", String(Math.max(1, limit)));

    const qs = params.toString();
    try {
      const result = await api(
        `/api/sessions/${sessionId}/terminal/output${qs ? `?${qs}` : ""}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: details.status, error: details.payload },
                null,
                2
              ),
            },
          ],
        };
      }
      throw error;
    }
  }
);

// Run
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
