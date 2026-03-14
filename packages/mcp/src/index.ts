#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HOST = process.env.ANT_HOST || "127.0.0.1";
const PORT = process.env.ANT_PORT || "3000";
const EFFECTIVE_HOST = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
const BASE_URL = process.env.ANT_BASE_URL || `http://${EFFECTIVE_HOST}:${PORT}`;

const CHAT_HOST = process.env.ANT_CHAT_HOST || "127.0.0.1";
const CHAT_PORT = process.env.ANT_CHAT_PORT || "6464";
const CHAT_BASE_URL = process.env.ANT_CHAT_URL || `http://${CHAT_HOST}:${CHAT_PORT}`;

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
  const apiKey = process.env.ANT_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
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

async function chatApi(path: string, options?: RequestInit) {
  const apiKey = process.env.ANT_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };
  const res = await fetch(`${CHAT_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.text();
    let payload: unknown = body;
    try { payload = JSON.parse(body); } catch {}
    throw new AntApiError(res.status, payload, `ANT Chat API error ${res.status}: ${getReadableErrorPayload(payload)}`);
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
  {
    includeArchived: z.boolean().optional().describe("Include archived sessions (default false)"),
  },
  async ({ includeArchived }) => {
    const params = new URLSearchParams();
    if (includeArchived) params.set("include_archived", "true");
    const qs = params.toString();
    const sessions = await api(`/api/sessions${qs ? `?${qs}` : ""}`);
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
    workspaceId: z.string().optional().describe("Workspace ID to assign the session to"),
  },
  async ({ type, name, workspaceId }) => {
    const session = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ type, name, workspace_id: workspaceId ?? null }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
    };
  }
);

// Get single session
server.tool(
  "ant_get_session",
  "Get a single ANT session by ID (includes cwd for terminals)",
  {
    sessionId: z.string().describe("Session ID"),
  },
  async ({ sessionId }) => {
    const session = await api(`/api/sessions/${sessionId}`);
    return {
      content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
    };
  }
);

// Update session
server.tool(
  "ant_update_session",
  "Update an ANT session (rename, move to workspace, or archive/restore)",
  {
    sessionId: z.string().describe("Session ID"),
    name: z.string().optional().describe("New session name"),
    workspaceId: z.string().nullable().optional().describe("Workspace ID (null to ungroup)"),
    archived: z.boolean().optional().describe("Set true to archive, false to restore"),
  },
  async ({ sessionId, name, workspaceId, archived }) => {
    const body: Record<string, unknown> = {};
    if (name !== undefined) body.name = name;
    if (workspaceId !== undefined) body.workspace_id = workspaceId;
    if (archived !== undefined) body.archived = archived ? 1 : 0;
    const session = await api(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
    };
  }
);

// Delete session
server.tool(
  "ant_delete_session",
  "Delete an ANT session and its terminal process (if any)",
  {
    sessionId: z.string().describe("Session ID"),
  },
  async ({ sessionId }) => {
    const result = await api(`/api/sessions/${sessionId}`, {
      method: "DELETE",
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
    const messages = await chatApi(
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
    sender_type: z.string().optional().describe("Sender type: claude, codex, gemini, copilot, human, system"),
    sender_name: z.string().optional().describe("Display name"),
    sender_cwd: z.string().optional().describe("Working directory"),
    sender_persona: z.string().optional().describe("Agent persona/role"),
    thread_id: z.string().optional().describe("Parent message ID for thread replies"),
  },
  async ({ sessionId, content, role, format, sender_type, sender_name, sender_cwd, sender_persona, thread_id }) => {
    const message = await chatApi(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content, format, sender_type, sender_name, sender_cwd, sender_persona, thread_id }),
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
    const message = await chatApi(`/api/sessions/${sessionId}/messages`, {
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
    const message = await chatApi(
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

// Delete message
server.tool(
  "ant_delete_message",
  "Delete a message from a conversation session",
  {
    sessionId: z.string().describe("Session ID"),
    messageId: z.string().describe("Message ID to delete"),
  },
  async ({ sessionId, messageId }) => {
    const result = await chatApi(
      `/api/sessions/${sessionId}/messages/${messageId}`,
      { method: "DELETE" }
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Reply to a message in a thread
server.tool(
  "ant_reply_to_message",
  "Reply to a specific message in a thread",
  {
    sessionId: z.string().describe("Session ID"),
    messageId: z.string().describe("Parent message ID to reply to"),
    content: z.string().describe("Reply content"),
    sender_type: z.string().optional().describe("Sender type"),
    sender_name: z.string().optional().describe("Display name"),
  },
  async ({ sessionId, messageId, content, sender_type, sender_name }) => {
    const message = await chatApi(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role: "agent", content, sender_type, sender_name, thread_id: messageId }),
    });
    return { content: [{ type: "text", text: JSON.stringify(message, null, 2) }] };
  }
);

// Store message to Obsidian vault
server.tool(
  "ant_store_message",
  "Store a message to the configured Obsidian vault",
  {
    sessionId: z.string().describe("Session ID"),
    messageId: z.string().describe("Message ID to store"),
  },
  async ({ sessionId, messageId }) => {
    const result = await chatApi("/api/store", {
      method: "POST",
      body: JSON.stringify({ sessionId, messageId }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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

// Get full terminal state (snapshot)
server.tool(
  "ant_get_terminal_state",
  "Get a full text snapshot (grid + scrollback) of a terminal session. Best for agents to 'see' the current terminal state.",
  {
    sessionId: z.string().describe("Session ID"),
    format: z.enum(["plain", "ansi"]).optional().default("plain").describe("Output format: 'plain' for clean text, 'ansi' for color/formatting"),
  },
  async ({ sessionId, format }) => {
    try {
      const result = await api(`/api/sessions/${sessionId}/terminal/state?format=${format}`);
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

// Update agent presence/state
server.tool(
  "ant_update_presence",
  "Update the agent's presence state (thinking, working, idle, wrapped) for a session.",
  {
    sessionId: z.string().describe("Session ID"),
    state: z.enum(["idle", "thinking", "working", "wrapped"]).describe("The current state of the agent"),
    agentId: z.string().optional().default("agent").describe("Unique ID for the agent"),
  },
  async ({ sessionId, state, agentId }) => {
    try {
      // This will be handled by a new POST endpoint in the sessions router
      await api(`/api/sessions/${sessionId}/presence`, {
        method: "POST",
        body: JSON.stringify({ state, agentId }),
      });
      return {
        content: [{ type: "text", text: `Presence updated to ${state}` }],
      };
    } catch (error) {
      const details = makeErrorPayload(error);
      return {
        content: [{ type: "text", text: `Failed to update presence: ${details?.payload || "Unknown error"}` }],
      };
    }
  }
);

// Kill all terminals
server.tool(
  "ant_kill_all_terminals",
  "Kill all terminal PTY processes and their tmux sessions (nuclear option)",
  {},
  async () => {
    const result = await api("/api/sessions/terminals/all", {
      method: "DELETE",
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// List resume commands
server.tool(
  "ant_list_resume_commands",
  "List captured LLM CLI resume commands (claude --resume, codex resume, etc.)",
  {},
  async () => {
    const commands = await api("/api/resume-commands");
    return {
      content: [{ type: "text", text: JSON.stringify(commands, null, 2) }],
    };
  }
);

// Delete resume command
server.tool(
  "ant_delete_resume_command",
  "Delete a captured resume command by ID",
  {
    id: z.string().describe("Resume command ID"),
  },
  async ({ id }) => {
    const result = await api(`/api/resume-commands/${id}`, {
      method: "DELETE",
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// List workspaces
server.tool(
  "ant_list_workspaces",
  "List all ANT workspaces",
  {},
  async () => {
    const workspaces = await api("/api/workspaces");
    return {
      content: [{ type: "text", text: JSON.stringify(workspaces, null, 2) }],
    };
  }
);

// Create workspace
server.tool(
  "ant_create_workspace",
  "Create a new ANT workspace for grouping sessions",
  {
    name: z.string().describe("Workspace name"),
  },
  async ({ name }) => {
    const workspace = await api("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(workspace, null, 2) }],
    };
  }
);

// Update workspace
server.tool(
  "ant_update_workspace",
  "Rename an ANT workspace",
  {
    workspaceId: z.string().describe("Workspace ID"),
    name: z.string().describe("New workspace name"),
  },
  async ({ workspaceId, name }) => {
    const workspace = await api(`/api/workspaces/${workspaceId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(workspace, null, 2) }],
    };
  }
);

// Delete workspace
server.tool(
  "ant_delete_workspace",
  "Delete an ANT workspace (sessions become ungrouped)",
  {
    workspaceId: z.string().describe("Workspace ID"),
  },
  async ({ workspaceId }) => {
    const result = await api(`/api/workspaces/${workspaceId}`, {
      method: "DELETE",
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// Agent API tools — structured terminal interaction for AI agents
// ---------------------------------------------------------------------------

// Get structured screen state
server.tool(
  "ant_get_screen",
  "Get a structured view of the terminal screen: clean text lines, cursor position, shell state, and dimensions. Best for agents to 'see' what's on screen without parsing ANSI.",
  {
    sessionId: z.string().describe("Session ID"),
  },
  async ({ sessionId }) => {
    try {
      const result = await api(`/api/agent/sessions/${sessionId}/screen`);
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

// Execute command and wait for result
server.tool(
  "ant_exec_command",
  "Execute a shell command in a terminal session, wait for it to complete, and return the structured result including exit code and clean output. This is the primary way agents should run commands.",
  {
    sessionId: z.string().describe("Session ID"),
    command: z.string().max(TERMINAL_TEXT_LIMIT).describe("Shell command to execute"),
    timeout: z.number().optional().default(30000).describe("Max wait time in ms (default 30s, max 5min)"),
  },
  async ({ sessionId, command, timeout }) => {
    try {
      const result = await api(`/api/agent/sessions/${sessionId}/exec`, {
        method: "POST",
        body: JSON.stringify({ command, timeout }),
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

// Wait for shell to become idle
server.tool(
  "ant_wait_idle",
  "Wait until the shell in a terminal session is idle (no command running). Useful after sending raw input to wait for completion before reading results.",
  {
    sessionId: z.string().describe("Session ID"),
    timeout: z.number().optional().default(30000).describe("Max wait time in ms (default 30s, max 5min)"),
  },
  async ({ sessionId, timeout }) => {
    try {
      const result = await api(`/api/agent/sessions/${sessionId}/wait-idle?timeout=${timeout}`);
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

// Search across sessions and messages
server.tool(
  "ant_search",
  "Search across all ANT sessions and messages by keyword",
  {
    query: z.string().describe("Search query"),
    workspaceId: z.string().optional().describe("Filter by workspace ID"),
    limit: z.number().optional().describe("Max results (default 50, max 200)"),
  },
  async ({ query, workspaceId, limit }) => {
    const params = new URLSearchParams({ q: query });
    if (workspaceId) params.set("workspace_id", workspaceId);
    if (limit) params.set("limit", String(limit));
    const results = await api(`/api/search?${params.toString()}`);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// Run
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
}
