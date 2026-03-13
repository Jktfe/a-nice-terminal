export interface DbSession {
  id: string;
  name: string;
  type: "terminal" | "conversation";
  shell: string | null;
  cwd: string | null;
  workspace_id: string | null;
  archived: number;
  ttl_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbWorkspace {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: "human" | "agent" | "system";
  content: string;
  format: string;
  status: "pending" | "streaming" | "complete";
  created_at: string;
}

export interface DbResumeCommand {
  id: string;
  session_id: string;
  cli: "claude" | "codex" | "gemini" | "copilot";
  command: string;
  description: string | null;
  root_path: string | null;
  captured_at: string;
}

/**
 * Strip ANSI escape sequences from a string.
 */
export function stripAnsi(str: string): string {
  if (typeof str !== "string") return "";
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "");
}
