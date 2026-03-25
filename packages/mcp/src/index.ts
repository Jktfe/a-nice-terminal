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
  "Send a message to a conversation session. For multi-agent coordination, use the metadata field with protocol types: architect_select, task_brief, offer, assignment, status_update, review_request, review_result, completion. Protocol messages render as visual cards in the UI.",
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
    metadata: z.any().optional().describe("Structured metadata. For protocol messages use: { type: 'offer', task_id, capability, confidence (0-1), available } or { type: 'assignment', assignments: [{ task_id, assigned_to, assigned_type, branch }] } etc."),
  },
  async ({ sessionId, content, role, format, sender_type, sender_name, sender_cwd, sender_persona, thread_id, metadata }) => {
    const message = await chatApi(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content, format, sender_type, sender_name, sender_cwd, sender_persona, thread_id, metadata }),
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

// --- Bridge Mappings ---

// List bridge mappings
server.tool(
  "ant_list_bridge_mappings",
  "List all bridge mappings that link external platform channels (Telegram, etc.) to ANT sessions",
  {
    platform: z.string().optional().describe("Filter by platform (e.g. 'telegram')"),
  },
  async ({ platform }) => {
    const qs = platform ? `?platform=${encodeURIComponent(platform)}` : "";
    const mappings = await api(`/api/bridge/mappings${qs}`);
    return {
      content: [{ type: "text", text: JSON.stringify(mappings, null, 2) }],
    };
  }
);

// Create bridge mapping
server.tool(
  "ant_create_bridge_mapping",
  "Link an external platform channel to an ANT conversation session",
  {
    platform: z.string().describe("Platform name (e.g. 'telegram')"),
    externalChannelId: z.string().describe("External channel/chat ID"),
    sessionId: z.string().describe("ANT session ID to link to"),
    externalChannelName: z.string().optional().describe("Human-readable channel name"),
  },
  async ({ platform, externalChannelId, sessionId, externalChannelName }) => {
    const mapping = await api("/api/bridge/mappings", {
      method: "POST",
      body: JSON.stringify({
        platform,
        external_channel_id: externalChannelId,
        session_id: sessionId,
        external_channel_name: externalChannelName,
      }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(mapping, null, 2) }],
    };
  }
);

// Delete bridge mapping
server.tool(
  "ant_delete_bridge_mapping",
  "Remove a bridge mapping (unlink an external channel from an ANT session)",
  {
    mappingId: z.string().describe("Bridge mapping ID to delete"),
  },
  async ({ mappingId }) => {
    await api(`/api/bridge/mappings/${mappingId}`, { method: "DELETE" });
    return {
      content: [{ type: "text", text: JSON.stringify({ deleted: true, id: mappingId }) }],
    };
  }
);

// ---------------------------------------------------------------------------
// V2 Tools — Coordination + Notifications
// ---------------------------------------------------------------------------

// Broadcast a task for other agents
server.tool(
  "ant_broadcast_task",
  "Broadcast a task to other agents. Specify required capabilities to match the right agent. If you know the target agent, set target_agent_id directly. Tasks expire after 1 hour by default.",
  {
    task: z.string().describe("Description of what needs to be done"),
    session_id: z.string().optional().describe("Session context for the task"),
    required_capabilities: z.array(z.string()).optional().describe("Required capabilities: code_review, debugging, testing, architecture, code_generation, visual_review, security"),
    target_agent_id: z.string().optional().describe("Specific agent to target (bypasses capability matching)"),
    agent_id: z.string().optional().describe("Your agent ID (who is broadcasting)"),
    context: z.any().optional().describe("Additional context for the task"),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional().describe("Task priority"),
  },
  async ({ task, session_id, required_capabilities, target_agent_id, agent_id, context, priority }) => {
    const result = await api("/api/v2/tasks/broadcast", {
      method: "POST",
      body: JSON.stringify({ task, session_id, required_capabilities, target_agent_id, agent_id, context, priority }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Get tasks matching my capabilities
server.tool(
  "ant_get_my_tasks",
  "Get pending tasks that match your capabilities. Call this periodically to check if other agents need your help.",
  {
    agent_id: z.string().describe("Your agent ID"),
  },
  async ({ agent_id }) => {
    const tasks = await api(`/api/v2/agent/tasks?agent_id=${encodeURIComponent(agent_id)}`);
    return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
  }
);

// Claim a task
server.tool(
  "ant_claim_task",
  "Claim a pending task — marks it as yours so other agents don't duplicate work.",
  {
    task_id: z.string().describe("Task ID to claim"),
    agent_id: z.string().describe("Your agent ID"),
  },
  async ({ task_id, agent_id }) => {
    try {
      const result = await api(`/api/v2/tasks/${task_id}/claim`, {
        method: "POST",
        body: JSON.stringify({ agent_id }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) return { content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }] };
      throw error;
    }
  }
);

// Complete a task
server.tool(
  "ant_complete_task",
  "Mark a task as completed with the result. The broadcasting agent and any watchers will be notified.",
  {
    task_id: z.string().describe("Task ID"),
    agent_id: z.string().describe("Your agent ID"),
    result: z.string().describe("What you did / the outcome"),
    artifacts: z.array(z.object({
      type: z.string(),
      id: z.string().optional(),
      path: z.string().optional(),
    })).optional().describe("Artifacts produced (files, messages, sessions)"),
  },
  async ({ task_id, agent_id, result, artifacts }) => {
    const res = await api(`/api/v2/tasks/${task_id}/complete`, {
      method: "POST",
      body: JSON.stringify({ agent_id, result, artifacts }),
    });
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  }
);

// Send push notification
server.tool(
  "ant_notify",
  "Send a push notification via ntfy.sh to the configured device. Use for important events: long command completed, error detected, review needed, task completed. Requires NTFY_TOPIC env var.",
  {
    title: z.string().optional().describe("Notification title (default: 'ANT')"),
    body: z.string().describe("Notification body text"),
    priority: z.enum(["min", "low", "default", "high", "urgent"]).optional().describe("Notification priority"),
    tags: z.array(z.string()).optional().describe("Tags for categorisation (e.g. ['terminal', 'error'])"),
  },
  async ({ title, body, priority, tags }) => {
    try {
      const result = await api("/api/v2/notify", {
        method: "POST",
        body: JSON.stringify({ title, body, priority, tags }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) return { content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }] };
      throw error;
    }
  }
);

// List connected devices
server.tool(
  "ant_list_devices",
  "List devices currently connected to ANT. Useful for deciding whether to send notifications or understanding which devices are active.",
  {},
  async () => {
    const devices = await api("/api/v2/devices");
    return { content: [{ type: "text", text: JSON.stringify(devices, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// V2 Tools — Recipes + Obsidian Export
// ---------------------------------------------------------------------------

// List recipes
server.tool(
  "ant_list_recipes",
  "List available workflow recipes. Recipes are reusable multi-step command sequences (e.g. 'New Svelte 5 Project', 'Debug Vercel Deploy'). Filter by category or approval status.",
  {
    category: z.string().optional().describe("Filter by category: setup, debug, deploy, test"),
    approved: z.boolean().optional().describe("Filter by approval status"),
    limit: z.number().optional().describe("Max results"),
  },
  async ({ category, approved, limit }) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (approved !== undefined) params.set("approved", String(approved));
    if (limit) params.set("limit", String(limit));
    const recipes = await api(`/api/v2/recipes?${params.toString()}`);
    return { content: [{ type: "text", text: JSON.stringify(recipes, null, 2) }] };
  }
);

// Get single recipe
server.tool(
  "ant_get_recipe",
  "Get a recipe's full details including all steps and required parameters.",
  {
    recipeId: z.string().describe("Recipe ID"),
  },
  async ({ recipeId }) => {
    const recipe = await api(`/api/v2/recipes/${recipeId}`);
    return { content: [{ type: "text", text: JSON.stringify(recipe, null, 2) }] };
  }
);

// Run a recipe
server.tool(
  "ant_run_recipe",
  "Execute a recipe — returns the resolved step list with parameters substituted. Execute each step using ant_safe_exec in sequence. Interactive steps should be handled manually or skipped.",
  {
    recipeId: z.string().describe("Recipe ID"),
    sessionId: z.string().describe("Terminal session to run steps in"),
    params: z.record(z.string()).optional().describe("Parameter values (e.g. { project_name: 'my-app' })"),
  },
  async ({ recipeId, sessionId, params }) => {
    try {
      const plan = await api(`/api/v2/recipes/${recipeId}/run`, {
        method: "POST",
        body: JSON.stringify({ params, session_id: sessionId }),
      });
      return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }] };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) return { content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }] };
      throw error;
    }
  }
);

// Propose a new recipe
server.tool(
  "ant_propose_recipe",
  "Propose a new recipe based on a successful workflow. The recipe will be pending human approval before other agents can use it.",
  {
    name: z.string().describe("Recipe name (e.g. 'Set Up Clerk Auth')"),
    description: z.string().optional().describe("What this recipe does"),
    category: z.string().optional().describe("Category: setup, debug, deploy, test, cleanup"),
    steps: z.array(z.object({
      command: z.string().describe("Shell command (use {{param_name}} for parameters)"),
      description: z.string().describe("What this step does"),
    })).describe("Ordered list of steps"),
    params: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      default_value: z.string().optional(),
      required: z.boolean().optional(),
    })).optional().describe("Parameters that need to be provided when running"),
    source_agent: z.string().optional().describe("Your agent ID"),
  },
  async ({ name, description, category, steps, params: recipeParams, source_agent }) => {
    const result = await api("/api/v2/recipes", {
      method: "POST",
      body: JSON.stringify({ name, description, category, steps, params: recipeParams, source_agent }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Export session to Obsidian
server.tool(
  "ant_export_to_obsidian",
  "Export a session to the configured Obsidian vault as a markdown file. Terminal sessions become structured command logs. Conversation and unified sessions become chat transcripts with YAML frontmatter, participant lists, and wikilinks.",
  {
    sessionId: z.string().describe("Session ID to export"),
  },
  async ({ sessionId }) => {
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/export/obsidian`, { method: "POST" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) return { content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }] };
      throw error;
    }
  }
);

// ---------------------------------------------------------------------------
// V2 Tools — Knowledge System
// ---------------------------------------------------------------------------

// Report a knowledge fact
server.tool(
  "ant_report_fact",
  "Record a piece of knowledge discovered during this session. Facts are searchable by all agents and persist across sessions. Categories: command_pattern, project_config, api_endpoint, file_location, environment, preference, gotcha.",
  {
    category: z.enum(["command_pattern", "project_config", "api_endpoint", "file_location", "environment", "preference", "gotcha"]).describe("Fact category"),
    key: z.string().describe("Short searchable label (e.g. 'package_manager', 'database_port')"),
    value: z.string().describe("The knowledge (e.g. 'pnpm', '5432')"),
    scope: z.string().optional().describe("Scope: 'global' or 'project:<path>' (default: global)"),
    source_agent: z.string().optional().describe("Your agent ID"),
    confidence: z.number().min(0).max(1).optional().describe("Confidence 0.0-1.0 (default 0.5)"),
  },
  async ({ category, key, value, scope, source_agent, confidence }) => {
    const result = await api("/api/v2/knowledge/facts", {
      method: "POST",
      body: JSON.stringify({ category, key, value, scope, source_agent, confidence }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Search knowledge
server.tool(
  "ant_search_knowledge",
  "Search the knowledge base for facts, error patterns, and past solutions. Use this before starting work to check if relevant knowledge exists. Returns facts ranked by confidence.",
  {
    query: z.string().describe("Search query (natural language or keywords)"),
    scope: z.string().optional().describe("Filter by scope"),
    category: z.string().optional().describe("Filter by category"),
    limit: z.number().optional().describe("Max results (default 20)"),
  },
  async ({ query, scope, category, limit }) => {
    const params = new URLSearchParams({ q: query });
    if (scope) params.set("scope", scope);
    if (category) params.set("category", category);
    if (limit) params.set("limit", String(limit));
    const results = await api(`/api/v2/knowledge/search?${params.toString()}`);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// Check for known error patterns
server.tool(
  "ant_check_error",
  "Check if an error message matches a known pattern with a recorded fix. Use this when a command fails before attempting your own fix — someone may have already solved it.",
  {
    error_text: z.string().describe("The error message or output to check"),
  },
  async ({ error_text }) => {
    const params = new URLSearchParams({ q: error_text });
    const results = await api(`/api/v2/knowledge/errors?${params.toString()}`);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// Find a past fix for a problem
server.tool(
  "ant_find_past_fix",
  "Search for commands that previously fixed similar problems. Combines error pattern matching with knowledge fact search to find the most relevant past solution.",
  {
    problem: z.string().describe("Description of the problem or error text"),
    scope: z.string().optional().describe("Narrow to a project scope"),
  },
  async ({ problem, scope }) => {
    // Search both error patterns and knowledge facts
    const errorParams = new URLSearchParams({ q: problem });
    const factParams = new URLSearchParams({ q: problem });
    if (scope) factParams.set("scope", scope);

    const [errors, facts] = await Promise.all([
      api(`/api/v2/knowledge/errors?${errorParams.toString()}`).catch(() => []),
      api(`/api/v2/knowledge/search?${factParams.toString()}`).catch(() => []),
    ]);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error_patterns: errors,
          related_facts: facts,
          hint: errors.length > 0
            ? `Found ${errors.length} matching error pattern(s). The top fix is: ${(errors as any[])[0]?.fix_command || "no fix recorded yet"}`
            : facts.length > 0
              ? `No error patterns matched, but found ${facts.length} related fact(s).`
              : "No matches found. You may be the first to encounter this.",
        }, null, 2),
      }],
    };
  }
);

// Report an error pattern with a fix
server.tool(
  "ant_report_error_fix",
  "Record that a specific error was fixed by a specific command. Helps other agents solve the same problem in the future.",
  {
    error_signature: z.string().describe("Normalised error text (first meaningful error line)"),
    fix_command: z.string().describe("The command that fixed the error"),
    fix_description: z.string().optional().describe("Human-readable explanation of why the fix works"),
    fix_agent: z.string().optional().describe("Your agent ID"),
    context_scope: z.string().optional().describe("Scope: 'global' or 'project:<path>'"),
  },
  async ({ error_signature, fix_command, fix_description, fix_agent, context_scope }) => {
    const result = await api("/api/v2/knowledge/errors", {
      method: "POST",
      body: JSON.stringify({ error_signature, fix_command, fix_description, fix_agent, context_scope }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// V2 Tools — Session Tiers + Danger-Checked Exec
// ---------------------------------------------------------------------------

// Promote session tier
server.tool(
  "ant_promote_session",
  "Promote a session to a higher lifecycle tier. sprint (15min) → session (1h45) → persistent (always-on). Higher tiers live longer before being reaped.",
  {
    sessionId: z.string().describe("Session ID"),
  },
  async ({ sessionId }) => {
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/promote`, { method: "POST" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) return { content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }] };
      throw error;
    }
  }
);

// Demote session tier
server.tool(
  "ant_demote_session",
  "Demote a session to a lower lifecycle tier. persistent (always-on) → session (1h45) → sprint (15min). Lower tiers are reaped sooner when no clients are connected.",
  {
    sessionId: z.string().describe("Session ID"),
  },
  async ({ sessionId }) => {
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/demote`, { method: "POST" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) return { content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }] };
      throw error;
    }
  }
);

// Set session tier directly
server.tool(
  "ant_set_session_tier",
  "Set a session's lifecycle tier directly. 'sprint' = 15min, 'session' = 1h45 (default), 'persistent' = always-on.",
  {
    sessionId: z.string().describe("Session ID"),
    tier: z.enum(["sprint", "session", "persistent"]).describe("Lifecycle tier"),
  },
  async ({ sessionId, tier }) => {
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/tier`, {
        method: "PATCH",
        body: JSON.stringify({ tier }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) return { content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }] };
      throw error;
    }
  }
);

// Danger-checked exec
server.tool(
  "ant_safe_exec",
  "Execute a command with automatic danger detection. If the command matches a dangerous pattern (rm -rf, DROP TABLE, chmod 777, etc.), returns a warning instead of executing. Set acknowledge_danger: true to proceed anyway. Use this instead of ant_exec_command for safer multi-agent workflows.",
  {
    sessionId: z.string().describe("Session ID"),
    command: z.string().max(TERMINAL_TEXT_LIMIT).describe("Shell command to execute"),
    timeout: z.number().optional().default(30000).describe("Max wait time in ms"),
    agent_id: z.string().optional().describe("Your agent ID (for lock passthrough)"),
    acknowledge_danger: z.boolean().optional().default(false).describe("Set true to bypass danger warning"),
    intent: z.enum(["exploration", "fix", "verification", "test", "setup", "cleanup"]).optional().describe("Tag this command's intent for the knowledge system"),
  },
  async ({ sessionId, command, timeout, agent_id, acknowledge_danger, intent }) => {
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/exec`, {
        method: "POST",
        body: JSON.stringify({ command, timeout, agent_id, acknowledge_danger, intent }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) return { content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }] };
      throw error;
    }
  }
);

// ---------------------------------------------------------------------------
// V2 Tools — Agent Registry + Terminal Locks
// ---------------------------------------------------------------------------

// Register an agent
server.tool(
  "ant_register_agent",
  "[Start here] Register this AI agent with ANT so it can participate in multi-model coordination. Set a unique handle (e.g. 'codex-regex') to be @-mentionable in chat. Other agents can discover you and delegate tasks based on your capabilities.",
  {
    id: z.string().describe("Unique agent ID (e.g. 'claude-code', 'gemini-cli', 'codex')"),
    handle: z.string().optional().describe("Your @-mentionable chat handle (e.g. 'codex-regex', 'claude-arch'). 2-32 chars, alphanumeric + hyphens. Must be unique across all agents."),
    model_family: z.string().describe("Model family (e.g. 'claude', 'gemini', 'gpt', 'deepseek', 'mistral')"),
    display_name: z.string().describe("Human-readable name (e.g. 'Claude Code (Opus 4.6)')"),
    capabilities: z.array(z.string()).optional().describe("What this agent can do: 'code_review', 'debugging', 'testing', 'architecture', 'code_generation', 'visual_review', 'security', etc."),
    preferred_formats: z.array(z.enum(["raw", "structured", "screenshot", "summary"])).optional().describe("Preferred terminal output formats"),
    context_window: z.number().optional().describe("Context window size in tokens"),
    transport: z.enum(["mcp", "function_calling", "rest", "cli"]).optional().describe("How this agent connects to ANT"),
    gateway: z.string().optional().describe("Gateway tool name (e.g. 'vibecli', 'ollama', 'lm-studio')"),
    underlying_model: z.string().optional().describe("Actual model ID (e.g. 'claude-opus-4.6', 'gpt-5.4')"),
  },
  async ({ id, handle, model_family, display_name, capabilities, preferred_formats, context_window, transport, gateway, underlying_model }) => {
    const result = await api("/api/v2/agents/register", {
      method: "POST",
      body: JSON.stringify({ id, handle, model_family, display_name, capabilities, preferred_formats, context_window, transport, gateway, underlying_model }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// List registered agents
server.tool(
  "ant_list_agents",
  "List all AI agents registered with ANT. Shows their capabilities, preferred formats, status, and last activity. Use this to discover what other agents are available for task delegation.",
  {},
  async () => {
    const agents = await api("/api/v2/agents");
    return {
      content: [{ type: "text", text: JSON.stringify(agents, null, 2) }],
    };
  }
);

// Acquire terminal lock
server.tool(
  "ant_acquire_terminal",
  "Acquire exclusive write access to a terminal session. Only the lock holder can send input or execute commands. Other agents get a 423 error with the holder's identity. Locks auto-expire after 5 minutes (configurable). Use this before running commands to prevent conflicts with other agents.",
  {
    sessionId: z.string().describe("Session ID to lock"),
    agentId: z.string().describe("Your agent ID (must match your registration)"),
    durationMs: z.number().optional().describe("Lock duration in ms (default 5min, max 30min)"),
  },
  async ({ sessionId, agentId, durationMs }) => {
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/lock`, {
        method: "POST",
        body: JSON.stringify({ agent_id: agentId, duration_ms: durationMs }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details && details.status === 423) {
        return {
          content: [{ type: "text", text: `Terminal locked by another agent:\n${JSON.stringify(details.payload, null, 2)}` }],
        };
      }
      if (details) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }],
        };
      }
      throw error;
    }
  }
);

// Release terminal lock
server.tool(
  "ant_release_terminal",
  "Release your exclusive lock on a terminal session, allowing other agents to write to it.",
  {
    sessionId: z.string().describe("Session ID to unlock"),
    agentId: z.string().describe("Your agent ID"),
  },
  async ({ sessionId, agentId }) => {
    const result = await api(`/api/v2/sessions/${sessionId}/lock`, {
      method: "DELETE",
      body: JSON.stringify({ agent_id: agentId }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Check terminal lock status
server.tool(
  "ant_check_terminal_lock",
  "Check if a terminal session is currently locked by another agent.",
  {
    sessionId: z.string().describe("Session ID to check"),
  },
  async ({ sessionId }) => {
    const result = await api(`/api/v2/sessions/${sessionId}/lock`);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// V2 Tools — multi-format terminal state with seq IDs
// ---------------------------------------------------------------------------

const V2_FORMAT_ENUM = z.enum(["raw", "structured", "summary"]).optional().default("raw");

// Get terminal state in any format (raw/structured/summary) with seq ID
server.tool(
  "ant_get_terminal_state_v2",
  "Get terminal state in the format best suited to your context window. 'raw' = full screen lines + cursor. 'structured' = command/output pairs with exit codes (best for most agents). 'summary' = compact one-line status (best for small-context models). All formats include a seq ID for drift detection.",
  {
    sessionId: z.string().describe("Session ID"),
    format: V2_FORMAT_ENUM.describe("Output format: raw (screen lines), structured (command/output pairs), summary (compact text)"),
  },
  async ({ sessionId, format }) => {
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/terminal/state?format=${format}`);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }],
        };
      }
      throw error;
    }
  }
);

// Get structured command history
server.tool(
  "ant_get_command_history",
  "Get recent command/output pairs from a terminal session as structured JSON. Each entry includes command, exit_code, output (ANSI-stripped), duration_ms, cwd, and timestamps. Best way for agents to review what happened in a terminal.",
  {
    sessionId: z.string().describe("Session ID"),
    limit: z.number().optional().default(20).describe("Max commands to return (default 20, max 100)"),
    since: z.string().optional().describe("ISO timestamp — only return commands after this time"),
  },
  async ({ sessionId, limit, since }) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (since) params.set("since", since);
    const qs = params.toString();
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/terminal/structured${qs ? `?${qs}` : ""}`);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }],
        };
      }
      throw error;
    }
  }
);

// Get terminal summary (for small-context models)
server.tool(
  "ant_get_terminal_summary",
  "Get a compact one-line summary of terminal state: shell status, last command result, recent error count, and action suggestions. Designed for small-context models (4K-32K tokens) that need minimal but actionable information.",
  {
    sessionId: z.string().describe("Session ID"),
  },
  async ({ sessionId }) => {
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/terminal/summary`);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }],
        };
      }
      throw error;
    }
  }
);

// Read terminal output with seq IDs
server.tool(
  "ant_read_terminal_output_v2",
  "Read terminal output events with seq IDs for drift detection. Supports format negotiation: raw (chunks with seq), structured (command pairs), summary (compact). Use seq to detect if the terminal state has changed since your last read.",
  {
    sessionId: z.string().describe("Session ID"),
    since: z.number().optional().describe("Seq cursor to start from (0 = beginning)"),
    limit: z.number().optional().describe("Maximum chunks to return"),
    format: V2_FORMAT_ENUM.describe("Output format: raw, structured, or summary"),
  },
  async ({ sessionId, since, limit, format }) => {
    const params = new URLSearchParams();
    if (typeof since === "number") params.set("since", String(Math.max(0, since)));
    if (typeof limit === "number") params.set("limit", String(Math.max(1, limit)));
    if (format) params.set("format", format);
    const qs = params.toString();
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/terminal/output${qs ? `?${qs}` : ""}`);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }],
        };
      }
      throw error;
    }
  }
);

// ---------------------------------------------------------------------------
// V2 Tools — Beeper (unified messaging)
// ---------------------------------------------------------------------------

// Send message via Beeper to any network
server.tool(
  "ant_beeper_send",
  "Send a message to any chat via Beeper (WhatsApp, Telegram, Signal, etc.). Requires Beeper Desktop running and ANT_ENABLE_BEEPER=true. The chatID identifies the conversation across any connected network.",
  {
    chatId: z.string().describe("Beeper chat ID"),
    text: z.string().describe("Message text (markdown supported)"),
    replyToMessageId: z.string().optional().describe("Message ID to reply to"),
  },
  async ({ chatId, text, replyToMessageId }) => {
    const tokenRow = await api("/api/v2/beeper/token").catch(() => null);
    if (!tokenRow) {
      return { content: [{ type: "text", text: "Beeper not authenticated. Enable with ANT_ENABLE_BEEPER=true and restart." }] };
    }
    try {
      const beeperUrl = process.env.BEEPER_URL || "http://localhost:23373";
      const body: Record<string, any> = { text };
      if (replyToMessageId) body.replyToMessageID = replyToMessageId;

      const res = await fetch(`${beeperUrl}/v1/chats/${encodeURIComponent(chatId)}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenRow.token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        return { content: [{ type: "text", text: `Beeper send failed: ${res.status} ${errText.slice(0, 200)}` }] };
      }
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Beeper error: ${error.message}` }] };
    }
  }
);

// List Beeper chats
server.tool(
  "ant_beeper_list_chats",
  "List available chats across all connected messaging networks via Beeper. Shows chat title, network (WhatsApp/Telegram/Signal/etc.), and chat ID for use with ant_beeper_send.",
  {
    limit: z.number().optional().default(30).describe("Max chats to return"),
  },
  async ({ limit }) => {
    try {
      const beeperUrl = process.env.BEEPER_URL || "http://localhost:23373";
      const tokenRow = await api("/api/v2/beeper/token").catch(() => null);
      if (!tokenRow) {
        return { content: [{ type: "text", text: "Beeper not authenticated." }] };
      }
      const res = await fetch(`${beeperUrl}/v1/chats?limit=${limit}`, {
        headers: { Authorization: `Bearer ${tokenRow.token}` },
      });
      if (!res.ok) return { content: [{ type: "text", text: `List chats failed: ${res.status}` }] };
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Beeper error: ${error.message}` }] };
    }
  }
);

// Search Beeper messages
server.tool(
  "ant_beeper_search",
  "Search messages across all connected messaging networks via Beeper.",
  {
    query: z.string().describe("Search query"),
    limit: z.number().optional().default(20).describe("Max results"),
  },
  async ({ query, limit }) => {
    try {
      const beeperUrl = process.env.BEEPER_URL || "http://localhost:23373";
      const tokenRow = await api("/api/v2/beeper/token").catch(() => null);
      if (!tokenRow) {
        return { content: [{ type: "text", text: "Beeper not authenticated." }] };
      }
      const res = await fetch(`${beeperUrl}/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
        headers: { Authorization: `Bearer ${tokenRow.token}` },
      });
      if (!res.ok) return { content: [{ type: "text", text: `Search failed: ${res.status}` }] };
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Beeper error: ${error.message}` }] };
    }
  }
);

// ---------------------------------------------------------------------------
// V2 Tools — Preferences + Resources
// ---------------------------------------------------------------------------

// Get user preferences
server.tool(
  "ant_get_preferences",
  "Get learned user preferences (package manager, shell, framework choices, etc.). Use this to tailor your suggestions to the user's established patterns. Preferences are auto-learned from command history or explicitly set.",
  {
    domain: z.string().optional().describe("Filter by domain: tooling, language, framework, style"),
  },
  async ({ domain }) => {
    const params = new URLSearchParams();
    if (domain) params.set("domain", domain);
    const prefs = await api(`/api/v2/preferences?${params.toString()}`);
    return { content: [{ type: "text", text: JSON.stringify(prefs, null, 2) }] };
  }
);

// Trigger preference learning
server.tool(
  "ant_learn_preferences",
  "Analyse command history and learn user preferences (package manager, shell, etc.). Run this periodically to keep preferences up to date.",
  {},
  async () => {
    const result = await api("/api/v2/preferences/learn", { method: "POST" });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Get session resource stats
server.tool(
  "ant_get_session_resources",
  "Get resource statistics for a terminal session: command count, error rate, average duration, output size, and server memory usage.",
  {
    sessionId: z.string().describe("Session ID"),
  },
  async ({ sessionId }) => {
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/resources`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) return { content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }] };
      throw error;
    }
  }
);

// Get terminal screenshot
server.tool(
  "ant_get_terminal_screenshot",
  "Get a visual screenshot of the terminal as SVG (or base64 for embedding). Best for multimodal models like Gemini that can process images. Returns the terminal grid rendered with monospace font on dark background.",
  {
    sessionId: z.string().describe("Session ID"),
    format: z.enum(["svg", "json"]).optional().default("json").describe("'svg' returns raw SVG, 'json' returns base64-encoded SVG with metadata"),
  },
  async ({ sessionId, format }) => {
    try {
      const result = await api(`/api/v2/sessions/${sessionId}/terminal/screenshot?format=${format}`);
      if (format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const details = makeErrorPayload(error);
      if (details) return { content: [{ type: "text", text: JSON.stringify({ status: details.status, error: details.payload }, null, 2) }] };
      throw error;
    }
  }
);

// ---------------------------------------------------------------------------
// Agent Orchestration — bootstrap, conversation membership, notifications
// ---------------------------------------------------------------------------

// Bootstrap — one call to productivity
server.tool(
  "ant_bootstrap",
  "[Start here — call this first] Get everything you need to start working in ANT: your registration status, conversations you've joined, assigned tasks, online agents, terminal sessions, and a quick-start guide. Optionally auto-registers you if model_family and display_name are provided.",
  {
    agent_id: z.string().describe("Your agent ID"),
    handle: z.string().optional().describe("Your @-mentionable handle (e.g. 'codex-regex'). Set this to be addressable in chat."),
    model_family: z.string().optional().describe("Model family for auto-registration (e.g. 'claude', 'gemini')"),
    display_name: z.string().optional().describe("Display name for auto-registration"),
    capabilities: z.string().optional().describe("Comma-separated capabilities for auto-registration (e.g. 'code_review,architecture')"),
  },
  async ({ agent_id, handle, model_family, display_name, capabilities }) => {
    // Auto-register if info provided
    if (model_family && display_name) {
      try {
        await api("/api/v2/agents/register", {
          method: "POST",
          body: JSON.stringify({
            id: agent_id, handle, model_family, display_name,
            capabilities: capabilities?.split(",").map((s: string) => s.trim()) || [],
            transport: "mcp",
          }),
        });
      } catch {}
    }
    const params = new URLSearchParams({ agent_id });
    if (handle) params.set("handle", handle);
    if (model_family) params.set("model_family", model_family);
    if (display_name) params.set("display_name", display_name);
    if (capabilities) params.set("capabilities", capabilities);
    const result = await api(`/api/v2/agent/bootstrap?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Get session context
server.tool(
  "ant_get_context",
  "[Communicate] Get full context for a specific conversation: recent messages, members, linked terminals, active tasks, and your mentions. Call this when joining or returning to a conversation to understand what's happening.",
  {
    session_id: z.string().describe("Conversation session ID to get context for"),
    agent_id: z.string().optional().describe("Your agent ID — if provided, shows your mentions in this conversation"),
    depth: z.number().optional().describe("Number of recent messages to include (default 20, max 100)"),
  },
  async ({ session_id, agent_id, depth }) => {
    const params = new URLSearchParams({ session_id });
    if (agent_id) params.set("agent_id", agent_id);
    if (depth) params.set("depth", String(depth));
    const result = await api(`/api/v2/agent/context?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Join conversation
server.tool(
  "ant_join_conversation",
  "[Communicate] Join a specific conversation session. You will only receive @mention notifications from conversations you've joined. You can optionally use a custom handle for this conversation (different from your global handle).",
  {
    session_id: z.string().describe("Conversation session ID to join"),
    agent_id: z.string().describe("Your agent ID"),
    handle: z.string().optional().describe("Handle to use in this conversation (defaults to your global handle or display_name)"),
    role: z.enum(["participant", "observer"]).optional().describe("Your role: 'participant' (can post) or 'observer' (read-only). Default: participant"),
  },
  async ({ session_id, agent_id, handle, role }) => {
    const result = await api(`/api/v2/conversations/${session_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id, handle, role }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Leave conversation
server.tool(
  "ant_leave_conversation",
  "[Communicate] Leave a conversation session. You will stop receiving notifications from this conversation.",
  {
    session_id: z.string().describe("Conversation session ID to leave"),
    agent_id: z.string().describe("Your agent ID"),
  },
  async ({ session_id, agent_id }) => {
    const result = await api(`/api/v2/conversations/${session_id}/leave`, {
      method: "DELETE",
      body: JSON.stringify({ agent_id }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// List my conversations
server.tool(
  "ant_list_my_conversations",
  "[Communicate] List all conversations you've joined, with your handle and role in each.",
  {
    agent_id: z.string().describe("Your agent ID"),
  },
  async ({ agent_id }) => {
    const result = await api(`/api/v2/agent/${agent_id}/conversations`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// List conversation members
server.tool(
  "ant_list_conversation_members",
  "[Communicate] List all agents that have joined a conversation, with their handles and capabilities.",
  {
    session_id: z.string().describe("Conversation session ID"),
  },
  async ({ session_id }) => {
    const result = await api(`/api/v2/conversations/${session_id}/members`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Poll notifications
server.tool(
  "ant_poll_notifications",
  "[Start here] Check for @mentions and tasks assigned to you. Call this periodically (or after ant_bootstrap) to see if anyone has mentioned you or assigned you work. Returns mentions from conversations you've joined and tasks targeted at you.",
  {
    agent_id: z.string().describe("Your agent ID"),
    since: z.string().optional().describe("ISO timestamp — only return notifications after this time. Omit for all pending."),
  },
  async ({ agent_id, since }) => {
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    const result = await api(`/api/v2/agent/${agent_id}/notifications?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
