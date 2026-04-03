/**
 * Typed Socket.IO event contract shared between daemon and app.
 *
 * Two namespaces are in use:
 *   /          — default namespace: session control, chat messages, notifications
 *   /terminal  — dedicated binary namespace for PTY I/O
 *
 * Only add event names here that actually exist in the codebase. Payload
 * types use `unknown` where the shape is flexible or refined elsewhere.
 */

// ---------------------------------------------------------------------------
// Default namespace  (/)
// ---------------------------------------------------------------------------

/**
 * Events emitted by the SERVER on the default namespace, listened to by the CLIENT.
 */
export interface ServerToClientEvents {
  // Session lifecycle
  session_list_changed: () => void;
  session_joined: (data: {
    sessionId: string;
    type: string;
    archived?: boolean;
  }) => void;
  session_health: (data: { sessionId: string; alive: boolean }) => void;

  // Terminal output (legacy default-namespace path — still used by handlers.ts)
  terminal_output: (data: { sessionId: string; data: string }) => void;

  // Chat messages
  message_created: (msg: {
    id: string;
    session_id: string;
    role: string;
    content: string;
    format: string;
    status: string;
    metadata?: unknown;
    message_type?: string;
    sender_type?: string;
    sender_name?: string;
    sender_cwd?: string;
    sender_persona?: string;
    sender_terminal_id?: string;
    thread_id?: string;
    annotations?: unknown;
    starred?: number;
    reply_count?: number;
    created_at: string;
    [key: string]: unknown;
  }) => void;
  message_updated: (msg: {
    id: string;
    session_id: string;
    [key: string]: unknown;
  }) => void;
  message_deleted: (data: { id: string; sessionId: string }) => void;

  // Streaming (relay path through chat-handlers)
  stream_chunk: (data: {
    sessionId: string;
    messageId: string;
    content: string;
  }) => void;

  // Thread replies
  thread_reply: (data: {
    threadId: string;
    message: Record<string, unknown>;
  }) => void;

  // Annotations
  annotation_changed: (data: {
    messageId: string;
    annotations: unknown[];
    starred: number;
  }) => void;

  // Agent presence / status
  agent_state_update: (data: {
    sessionId: string;
    agentId: string;
    state: string;
    lastUpdated: string;
  }) => void;
  agent_status: (data: {
    sessionId: string;
    from: string;
    status: string;
    message?: string;
  }) => void;
  agent_notification: (data: {
    type: string;
    task_id: string;
    target_agent_id: string;
    session_id: string;
    message_id: string;
    from: Record<string, unknown>;
    extracted_task: string;
    handle: string;
    created_at: string;
    [key: string]: unknown;
  }) => void;

  // Chairman / terminal approval
  terminal_approval_needed: (data: {
    sessionId: string;
    promptId: string;
    toolType: string;
  }) => void;
  terminal_approval_resolved: (data: { sessionId: string }) => void;

  // Resume commands (CLI capture pipeline)
  resume_command_captured: (cmd: Record<string, unknown>) => void;

  // Multi-agent membership
  member_joined: (data: {
    session_id: string;
    agent_id: string;
    handle: string;
    role: string;
  }) => void;
  member_left: (data: {
    session_id: string;
    agent_id: string;
    handle: string;
  }) => void;

  // Task coordination
  task_available: (data: {
    id: string;
    task: string;
    required_capabilities?: unknown;
    target_agent_id?: string;
  }) => void;
  task_claimed: (data: { id: string; agent_id: string }) => void;
  task_completed: (data: {
    id: string;
    agent_id: string;
    result: unknown;
  }) => void;
  task_changed: (payload: unknown) => void;

  // Error feedback
  error: (data: { message: string }) => void;
}

/**
 * Events emitted by the CLIENT on the default namespace, listened to by the SERVER.
 */
export interface ClientToServerEvents {
  // Session room management
  join_session: (data: { sessionId: string }) => void;
  leave_session: (data: { sessionId: string }) => void;

  // Legacy terminal I/O (default namespace path)
  terminal_input: (data: { sessionId: string; data: string }) => void;
  terminal_resize: (data: {
    sessionId: string;
    cols: number;
    rows: number;
  }) => void;

  // Health check
  check_health: (data: { sessionId: string }) => void;

  // Streaming relay (agent → server → room)
  stream_chunk: (data: {
    sessionId: string;
    messageId: string;
    content: string;
  }) => void;
  stream_end: (data: { sessionId: string; messageId: string }) => void;
}

// ---------------------------------------------------------------------------
// /terminal namespace
// ---------------------------------------------------------------------------

/**
 * Events emitted by the SERVER on the /terminal namespace, listened to by the CLIENT.
 */
export interface TerminalServerToClientEvents {
  // PTY output (binary-first)
  out: (data: { sid: string; d: Uint8Array | Buffer }) => void;

  // Joined confirmation
  joined: (data: { sid: string; type: string; archived?: boolean }) => void;

  // Command lifecycle
  cmd_start: (data: { sid: string; command: string }) => void;
  cmd_end: (data: {
    sid: string;
    command: string;
    exitCode: number;
    durationMs: number;
  }) => void;

  // Terminal state snapshot (for reconnect restore)
  state: (data: {
    sid: string;
    screen: string;
    cursorX: number;
    cursorY: number;
    cols: number;
    rows: number;
  }) => void;

  // Error feedback
  error: (data: { message: string }) => void;
}

/**
 * Events emitted by the CLIENT on the /terminal namespace, listened to by the SERVER.
 */
export interface TerminalClientToServerEvents {
  join: (data: { sid: string }) => void;
  leave: (data: { sid: string }) => void;
  in: (data: { sid: string; d: Uint8Array | Buffer | string }) => void;
  resize: (data: { sid: string; cols: number; rows: number }) => void;
}
