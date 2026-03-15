/**
 * Multi-Agent Conversation Protocol — Structured metadata types.
 *
 * These types define the coordination layer for multi-agent conversations.
 * Messages with protocol metadata get rendered as special cards in the UI.
 *
 * Flow:
 *   1. MasterDave (or human) posts `architect_select` → names the Architect
 *   2. Architect posts `task_brief` → describes what needs doing
 *   3. Agents post `offer` → "I can do X, because Y, available now"
 *   4. Architect posts `assignment` → allocates tasks based on offers
 *   5. Agents post `status_update` → progress reports
 *   6. Agents post `review_request` → ask for review
 *   7. Architect posts `review_result` → accept/reject/revise
 *   8. Architect posts `completion` → work is done
 */

// All protocol message types
export type ProtocolType =
  | "architect_select"
  | "task_brief"
  | "offer"
  | "assignment"
  | "status_update"
  | "review_request"
  | "review_result"
  | "completion";

// MasterDave selects an architect for the conversation
export interface ArchitectSelect {
  type: "architect_select";
  architect_name: string;
  architect_type: string; // sender_type of the architect
  reason: string;
}

// Architect describes the work to be done
export interface TaskBrief {
  type: "task_brief";
  title: string;
  tasks: Array<{
    id: string;
    description: string;
    requirements?: string;
    estimated_effort?: string; // "small" | "medium" | "large"
  }>;
}

// Agent offers to take a task
export interface Offer {
  type: "offer";
  task_id: string;
  capability: string;   // why I'm suited
  confidence: number;    // 0-1
  available: boolean;
  estimated_time?: string;
}

// Architect assigns tasks to agents
export interface Assignment {
  type: "assignment";
  assignments: Array<{
    task_id: string;
    assigned_to: string;     // sender_name
    assigned_type: string;   // sender_type
    branch?: string;         // git branch name
    reason?: string;
  }>;
}

// Agent reports progress
export interface StatusUpdate {
  type: "status_update";
  task_id: string;
  status: "in_progress" | "blocked" | "complete" | "failed";
  progress?: string;
  blockers?: string;
  branch?: string;
  commits?: string[];
}

// Agent requests review
export interface ReviewRequest {
  type: "review_request";
  task_id: string;
  branch: string;
  summary: string;
  files_changed?: string[];
  tests_passing?: boolean;
}

// Architect reviews work
export interface ReviewResult {
  type: "review_result";
  task_id: string;
  verdict: "approved" | "changes_requested" | "rejected";
  feedback?: string;
  merge?: boolean;
}

// Architect marks the conversation's work as complete
export interface Completion {
  type: "completion";
  summary: string;
  tasks_completed: string[];
  branches_merged?: string[];
  next_steps?: string[];
}

export type ProtocolMetadata =
  | ArchitectSelect
  | TaskBrief
  | Offer
  | Assignment
  | StatusUpdate
  | ReviewRequest
  | ReviewResult
  | Completion;

/**
 * Check if a message's metadata is a protocol message.
 */
export function isProtocolMessage(metadata: any): metadata is ProtocolMetadata {
  if (!metadata || typeof metadata !== "object") return false;
  return typeof metadata.type === "string" && PROTOCOL_TYPES.has(metadata.type);
}

const PROTOCOL_TYPES = new Set<string>([
  "architect_select",
  "task_brief",
  "offer",
  "assignment",
  "status_update",
  "review_request",
  "review_result",
  "completion",
]);

/**
 * Get a human-readable label for a protocol type.
 */
export function protocolLabel(type: ProtocolType): string {
  const labels: Record<ProtocolType, string> = {
    architect_select: "Architect Selected",
    task_brief: "Task Brief",
    offer: "Offer",
    assignment: "Task Assignment",
    status_update: "Status Update",
    review_request: "Review Request",
    review_result: "Review Result",
    completion: "Complete",
  };
  return labels[type] || type;
}

/**
 * Get accent colour for a protocol type.
 */
export function protocolAccent(type: ProtocolType): string {
  const accents: Record<ProtocolType, string> = {
    architect_select: "#f59e0b", // amber
    task_brief: "#3b82f6",      // blue
    offer: "#22c55e",           // green
    assignment: "#a855f7",      // purple
    status_update: "#6b7280",   // grey
    review_request: "#f59e0b",  // amber
    review_result: "#10b981",   // emerald
    completion: "#10b981",      // emerald
  };
  return accents[type] || "#e5e5e5";
}
