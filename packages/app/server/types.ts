export interface DbSession {
  id: string;
  name: string;
  type: "terminal" | "conversation";
  shell: string | null;
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
