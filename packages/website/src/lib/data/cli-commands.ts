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

export const cliCategories = [...new Set(cliCommands.map((c) => c.category))];
