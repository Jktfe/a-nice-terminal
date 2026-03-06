#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = `http://127.0.0.1:${process.env.ANT_PORT || "3000"}`;
const API_KEY = process.env.ANT_API_KEY;

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
    throw new Error(`ANT API error ${res.status}: ${body}`);
  }

  return res.json();
}

const server = new McpServer({
  name: "a-nice-terminal",
  version: "0.1.0",
});

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
    role: z
      .enum(["human", "agent", "system"])
      .default("agent")
      .describe("Message role"),
  },
  async ({ sessionId, content, role }) => {
    const message = await api(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
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
    role: z
      .enum(["human", "agent", "system"])
      .default("agent")
      .describe("Message role"),
  },
  async ({ sessionId, role }) => {
    const message = await api(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content: "", status: "streaming" }),
    });
    return {
      content: [
        {
          type: "text",
          text: `Streaming message created. ID: ${message.id}\nUse ant_complete_stream to finalise.`,
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

// Run
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
