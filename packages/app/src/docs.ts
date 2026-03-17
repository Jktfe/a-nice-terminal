export interface DocParam {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface DocEntry {
  name: string;
  category: string;
  description: string;
  params: DocParam[];
  example?: string;
}

export const mcpTools: DocEntry[] = [
  // Sessions
  { name: "ant_list_sessions", category: "Sessions", description: "List all ANT sessions (both terminal and conversation)", params: [{ name: "includeArchived", type: "boolean", description: "Include archived sessions (default false)" }] },
  { name: "ant_create_session", category: "Sessions", description: "Create a new ANT session", params: [{ name: "type", type: "terminal | conversation", required: true, description: "Session type" }, { name: "name", type: "string", description: "Session name" }, { name: "workspaceId", type: "string", description: "Workspace ID" }] },
  { name: "ant_get_session", category: "Sessions", description: "Get a single ANT session by ID (includes cwd for terminals)", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }] },
  { name: "ant_update_session", category: "Sessions", description: "Update an ANT session (rename, move to workspace, or archive/restore)", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "name", type: "string", description: "New name" }, { name: "workspaceId", type: "string | null", description: "Workspace ID (null to ungroup)" }, { name: "archived", type: "boolean", description: "Set true to archive, false to restore" }] },
  { name: "ant_delete_session", category: "Sessions", description: "Delete an ANT session and its terminal process (if any)", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }] },

  // Messages
  { name: "ant_read_messages", category: "Messages", description: "Read messages from a conversation session", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "since", type: "string", description: "ISO timestamp — only return messages after this time" }, { name: "limit", type: "number", description: "Max messages to return (default 100)" }] },
  { name: "ant_send_message", category: "Messages", description: "Send a message to a conversation session (markdown supported, protocol metadata for multi-agent cards)", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "content", type: "string", required: true, description: "Message content" }, { name: "role", type: "human | agent | system", description: "Message role (default human)" }, { name: "sender_type", type: "string", description: "Sender type: claude, codex, gemini, copilot, human, system" }, { name: "sender_name", type: "string", description: "Display name" }, { name: "metadata", type: "object", description: "Structured metadata for protocol messages" }], example: 'ant_send_message({ sessionId: "abc", content: "Hello", role: "agent", sender_type: "claude" })' },
  { name: "ant_stream_message", category: "Messages", description: "Start a streaming message (returns message ID for later completion)", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "role", type: "human | agent | system", description: "Message role" }] },
  { name: "ant_complete_stream", category: "Messages", description: "Finalise a streaming message with the full content", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "messageId", type: "string", required: true, description: "Message ID from ant_stream_message" }, { name: "content", type: "string", required: true, description: "Full message content" }] },
  { name: "ant_delete_message", category: "Messages", description: "Delete a message from a conversation session", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "messageId", type: "string", required: true, description: "Message ID" }] },
  { name: "ant_reply_to_message", category: "Messages", description: "Reply to a specific message in a thread", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "messageId", type: "string", required: true, description: "Parent message ID" }, { name: "content", type: "string", required: true, description: "Reply content" }] },
  { name: "ant_store_message", category: "Messages", description: "Store a message to the configured Obsidian vault", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "messageId", type: "string", required: true, description: "Message ID" }] },

  // Terminal
  { name: "ant_terminal_input", category: "Terminal", description: "Write input to a terminal session", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "data", type: "string", required: true, description: "Terminal input to write (max 10000 chars)" }] },
  { name: "ant_terminal_resize", category: "Terminal", description: "Resize the terminal for a terminal session", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "cols", type: "number", required: true, description: "Width in columns (1–500)" }, { name: "rows", type: "number", required: true, description: "Height in rows (1–200)" }] },
  { name: "ant_read_terminal_output", category: "Terminal", description: "Read terminal output events from a terminal session", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "since", type: "number", description: "Event cursor to start from" }, { name: "limit", type: "number", description: "Maximum events to return" }] },
  { name: "ant_get_terminal_state", category: "Terminal", description: "Get a full text snapshot (grid + scrollback) of a terminal session", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "format", type: "plain | ansi", description: "Output format (default plain)" }] },

  // Agent
  { name: "ant_get_screen", category: "Agent", description: "Get structured view of the terminal screen: clean text lines, cursor position, shell state, dimensions", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }] },
  { name: "ant_exec_command", category: "Agent", description: "Execute a shell command in a terminal session, wait for completion, return structured result with exit code", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "command", type: "string", required: true, description: "Shell command to execute" }, { name: "timeout", type: "number", description: "Max wait in ms (default 30s, max 5min)" }], example: 'ant_exec_command({ sessionId: "abc", command: "ls -la", timeout: 10000 })' },
  { name: "ant_wait_idle", category: "Agent", description: "Wait until the shell in a terminal session is idle (no command running)", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "timeout", type: "number", description: "Max wait in ms (default 30s)" }] },
  { name: "ant_update_presence", category: "Agent", description: "Update the agent's presence state (thinking, working, idle, wrapped)", params: [{ name: "sessionId", type: "string", required: true, description: "Session ID" }, { name: "state", type: "idle | thinking | working | wrapped", required: true, description: "Agent state" }, { name: "agentId", type: "string", description: "Unique agent ID (default 'agent')" }] },

  // Workspace
  { name: "ant_list_workspaces", category: "Workspace", description: "List all ANT workspaces", params: [] },
  { name: "ant_create_workspace", category: "Workspace", description: "Create a new ANT workspace for grouping sessions", params: [{ name: "name", type: "string", required: true, description: "Workspace name" }] },
  { name: "ant_update_workspace", category: "Workspace", description: "Rename an ANT workspace", params: [{ name: "workspaceId", type: "string", required: true, description: "Workspace ID" }, { name: "name", type: "string", required: true, description: "New name" }] },
  { name: "ant_delete_workspace", category: "Workspace", description: "Delete an ANT workspace (sessions become ungrouped)", params: [{ name: "workspaceId", type: "string", required: true, description: "Workspace ID" }] },

  // Search
  { name: "ant_search", category: "Search", description: "Search across all ANT sessions and messages by keyword", params: [{ name: "query", type: "string", required: true, description: "Search query" }, { name: "workspaceId", type: "string", description: "Filter by workspace" }, { name: "limit", type: "number", description: "Max results (default 50, max 200)" }] },

  // Resume
  { name: "ant_list_resume_commands", category: "Resume", description: "List captured LLM CLI resume commands (claude --resume, codex resume, etc.)", params: [] },
  { name: "ant_delete_resume_command", category: "Resume", description: "Delete a captured resume command by ID", params: [{ name: "id", type: "string", required: true, description: "Resume command ID" }] },

  // Admin
  { name: "ant_kill_all_terminals", category: "Admin", description: "Kill all terminal PTY processes (nuclear option)", params: [] },
];

export const cliCommands: DocEntry[] = [
  { name: "list", category: "Core", description: "List sessions (alias: ls)", params: [{ name: "--archived", type: "flag", description: "Show only archived sessions" }, { name: "--type <type>", type: "string", description: "Filter by type (terminal|conversation)" }, { name: "--workspace <name>", type: "string", description: "Filter by workspace name" }], example: "ant list --type terminal" },
  { name: "create", category: "Core", description: "Create a new session (alias: c)", params: [{ name: "name", type: "string", required: true, description: "Session name" }, { name: "-t, --type <type>", type: "string", description: "Session type (default: conversation)" }, { name: "--workspace <name>", type: "string", description: "Workspace name" }, { name: "--cwd <path>", type: "string", description: "Working directory for terminals" }], example: "ant create 'My Session' -t terminal" },
  { name: "read", category: "Core", description: "Read messages or terminal output (alias: r)", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }, { name: "-l, --limit <n>", type: "number", description: "Number of items (default 50)" }, { name: "-f, --follow", type: "flag", description: "Tail new messages/output in real-time" }, { name: "--plain", type: "flag", description: "Strip ANSI escape codes" }], example: "ant read 'Terminal 1' --follow" },
  { name: "post", category: "Core", description: "Post a message or send terminal input (alias: p)", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }, { name: "message", type: "string", description: "Message content or command" }, { name: "--role <role>", type: "string", description: "Message role (human|agent|system)" }, { name: "--key <keyname>", type: "string", description: "Send a single key (terminal only)" }, { name: "--seq <sequence>", type: "string", description: "Send a key sequence (terminal only)" }], example: "ant post 'Terminal 1' 'ls -la'" },
  { name: "search", category: "Core", description: "Search sessions and messages (alias: s)", params: [{ name: "query", type: "string", required: true, description: "Search query" }, { name: "--workspace <name>", type: "string", description: "Filter by workspace" }, { name: "-l, --limit <n>", type: "number", description: "Max results" }], example: "ant search 'deploy script'" },
  { name: "delete", category: "Manage", description: "Delete a session permanently (alias: rm)", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }, { name: "--force", type: "flag", description: "Skip confirmation prompt" }] },
  { name: "archive", category: "Manage", description: "Archive a session", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }] },
  { name: "restore", category: "Manage", description: "Restore an archived session", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }] },
  { name: "rename", category: "Manage", description: "Rename a session", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }, { name: "new-name", type: "string", required: true, description: "New session name" }] },
  { name: "members", category: "Query", description: "List participants in a session (alias: m)", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }] },
  { name: "filter", category: "Query", description: "Filter messages by sender (alias: f)", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }, { name: "sender", type: "string", required: true, description: "Sender to filter by" }, { name: "--role <role>", type: "string", description: "Filter by role" }] },
  { name: "exec", category: "Terminal", description: "Execute a command in a terminal session (alias: x)", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }, { name: "command", type: "string", description: "Command to execute" }, { name: "-t, --timeout <seconds>", type: "number", description: "Timeout (default 30s)" }, { name: "-i, --interactive", type: "flag", description: "Interactive TTY attach" }], example: "ant exec 'Terminal 1' 'npm test'" },
  { name: "attach", category: "Terminal", description: "Attach interactively to a terminal session (alias: a)", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }], example: "ant attach 'Terminal 1'" },
  { name: "screen", category: "Terminal", description: "Show current terminal screen state (alias: sc)", params: [{ name: "session", type: "string", required: true, description: "Session ID or name" }, { name: "--plain", type: "flag", description: "Strip ANSI escape codes" }, { name: "--lines <n>", type: "number", description: "Show last N lines" }] },
  { name: "health", category: "Admin", description: "Check server connectivity", params: [], example: "ant health" },
];

export const mcpCategories = [...new Set(mcpTools.map((t) => t.category))];
export const cliCategories = [...new Set(cliCommands.map((c) => c.category))];
