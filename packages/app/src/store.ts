/// <reference types="vite/client" />
import { create } from "zustand";
import { io, Socket } from "socket.io-client";

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  name: string;
  type: "terminal" | "conversation";
  shell: string | null;
  cwd: string | null;
  workspace_id: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface ResumeCommand {
  id: string;
  session_id: string;
  cli: "claude" | "codex" | "gemini" | "copilot";
  command: string;
  description: string | null;
  root_path: string | null;
  captured_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: "human" | "agent" | "system";
  content: string;
  format: string;
  status: "pending" | "streaming" | "complete";
  metadata?: any;
  created_at: string;
}

interface AppState {
  sessions: Session[];
  workspaces: Workspace[];
  activeSessionId: string | null;
  messages: Message[];
  resumeCommands: ResumeCommand[];
  socket: Socket | null;
  connected: boolean;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  error: string | null;
  sessionHealth: Record<string, boolean>;
  pinnedSessionIds: Set<string>;
  terminalFontSize: number;
  terminalTheme: string;
  unreadCounts: Record<string, number>;
  showArchived: boolean;
  splitMode: boolean;
  splitSessionId: string | null;
  splitMessages: Message[];

  // Actions
  init: () => void;
  reconnect: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string) => Promise<Workspace | null>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  moveSessionToWorkspace: (sessionId: string, workspaceId: string | null) => Promise<void>;
  createSession: (
    type: "terminal" | "conversation",
    name?: string,
    workspaceId?: string
  ) => Promise<Session | null>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, name: string) => Promise<void>;
  setActiveSession: (id: string) => void;
  loadMessages: (sessionId: string) => Promise<void>;
  sendMessage: (content: string, role?: "human" | "agent" | "system", metadata?: any) => Promise<void>;
  sendMessageToSession: (sessionId: string, content: string, role?: "human" | "agent" | "system") => Promise<void>;
  uploadFile: (file: File) => Promise<{ url: string; filename: string }>;
  loadResumeCommands: () => Promise<void>;
  deleteResumeCommand: (id: string) => Promise<void>;
  togglePin: (sessionId: string) => void;
  setTerminalFontSize: (size: number) => void;
  setTerminalTheme: (theme: string) => void;
  toggleSidebar: () => void;
  toggleSettings: () => void;
  clearError: () => void;
  setError: (message: string) => void;
  archiveSession: (id: string) => Promise<void>;
  restoreSession: (id: string) => Promise<void>;
  toggleShowArchived: () => void;
  toggleSplit: () => void;
  setSplitSession: (id: string) => void;
  loadSplitMessages: (sessionId: string) => Promise<void>;
}

const API_KEY = (import.meta.env.VITE_ANT_API_KEY as string | undefined)?.trim();
const ACTIVE_SESSION_KEY = "ant-active-session-id";
const PINNED_SESSIONS_KEY = "ant-pinned-session-ids";
const TERMINAL_FONT_SIZE_KEY = "ant-terminal-font-size";
const TERMINAL_THEME_KEY = "ant-terminal-theme";

function loadPinnedSessions(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_SESSIONS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function savePinnedSessions(ids: Set<string>) {
  localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify([...ids]));
}

function buildHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (API_KEY) {
    headers.set("X-API-Key", API_KEY);
  }
  return headers;
}

export async function apiFetch(input: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(input, {
    ...options,
    headers: buildHeaders(options.headers),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function messageWithDefault(message: Partial<Message>): Message {
  return {
    id: message.id || "",
    session_id: message.session_id || "",
    role: message.role || "agent",
    content: message.content || "",
    format: message.format || "markdown",
    status: message.status || "complete",
    created_at: message.created_at || new Date().toISOString(),
  };
}

function appendStreamChunk(state: AppState, payload: {
  sessionId: string;
  messageId: string;
  role?: Message["role"];
  format?: string;
  content: string;
}) {
  const streamState = state.messages;
  if (payload.sessionId !== state.activeSessionId) return streamState;

  const found = streamState.find((m) => m.id === payload.messageId);
  if (found) {
    return streamState.map((message) => {
      if (message.id !== payload.messageId) return message;
      return {
        ...message,
        content: `${message.content}${payload.content}`,
        role: payload.role || message.role,
        format: payload.format || message.format,
        status: "streaming" as const,
      };
    });
  }

  const fallback = messageWithDefault({
    id: payload.messageId,
    session_id: payload.sessionId,
    role: payload.role,
    format: payload.format || "markdown",
    content: payload.content,
    status: "streaming" as const,
  });

  return [...streamState, fallback];
}

let sessionListDebounce: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<AppState>((set, get) => ({
  sessions: [],
  workspaces: [],
  activeSessionId: null,
  messages: [],
  resumeCommands: [],
  socket: null,
  connected: false,
  sidebarOpen: true,
  settingsOpen: false,
  error: null,
  sessionHealth: {},
  pinnedSessionIds: loadPinnedSessions(),
  terminalFontSize: Number(localStorage.getItem(TERMINAL_FONT_SIZE_KEY)) || 14,
  terminalTheme: localStorage.getItem(TERMINAL_THEME_KEY) || "default",
  unreadCounts: {},
  showArchived: false,
  splitMode: false,
  splitSessionId: null,
  splitMessages: [],

  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),

  reconnect: async () => {
    const { socket, activeSessionId } = get();
    await get().loadSessions();
    await get().loadWorkspaces();
    await get().loadResumeCommands();

    if (activeSessionId && socket) {
      socket.emit("join_session", { sessionId: activeSessionId });
      const session = get().sessions.find((s) => s.id === activeSessionId);
      if (session?.type === "conversation") {
        await get().loadMessages(activeSessionId);
      }
    }
  },

  init: () => {
    // Prevent double-init (React StrictMode)
    if (get().socket) return;

    const socket = io({
      auth: API_KEY ? { apiKey: API_KEY } : undefined,
      query: API_KEY ? { apiKey: API_KEY } : undefined,
    });

    socket.on("connect", () => {
      const isReconnect = get().sessions.length > 0;
      set({ connected: true, error: null });
      if (isReconnect) {
        get().reconnect();
      }
    });

    socket.on("disconnect", () => {
      set({ connected: false });
    });

    socket.on("connect_error", (error) => {
      set({ connected: false, error: error.message || "Socket connection failed" });
    });

    socket.on("error", (error: { message?: string }) => {
      if (typeof error === "object" && error?.message) {
        set({ error: error.message });
      }
    });

    socket.on("message_created", (message: Message) => {
      set((s) => {
        const isActive = message.session_id === s.activeSessionId;
        const isSplit = message.session_id === s.splitSessionId;

        // Unread tracking + browser notification for non-active sessions
        let unreadCounts = s.unreadCounts;
        if (!isActive) {
          unreadCounts = {
            ...s.unreadCounts,
            [message.session_id]: (s.unreadCounts[message.session_id] || 0) + 1,
          };

          // Browser notification when tab is hidden
          if (document.hidden && Notification.permission === "granted") {
            const session = s.sessions.find((ses) => ses.id === message.session_id);
            const body = message.content.length > 100
              ? message.content.slice(0, 100) + "..."
              : message.content;
            new Notification(session?.name || "ANT", { body });
          }
        }

        // Append to split messages if this message is for the split session
        let splitMessages = s.splitMessages;
        if (isSplit && !splitMessages.some((m) => m.id === message.id)) {
          splitMessages = [...splitMessages, message];
        }

        // Append to main messages if active
        let messages = s.messages;
        if (isActive && !messages.some((m) => m.id === message.id)) {
          messages = [...messages, message];
        }

        return { messages, unreadCounts, splitMessages };
      });
    });

    socket.on("message_updated", (message: Message) => {
      set((s) => {
        if (message.session_id !== s.activeSessionId) return s;
        return {
          messages: s.messages.some((m) => m.id === message.id)
            ? s.messages.map((current) =>
                current.id === message.id ? message : current
              )
            : [...s.messages, message],
        };
      });
    });

    socket.on("stream_chunk", (payload: {
      sessionId: string;
      messageId: string;
      role?: Message["role"];
      format?: string;
      content: string;
    }) => {
      set((s) => ({ messages: appendStreamChunk(s, payload) }));
    });

    socket.on("message_deleted", ({ id }: { id: string }) => {
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== id),
      }));
    });

    socket.on("resume_command_captured", (cmd: ResumeCommand) => {
      set((s) => {
        if (s.resumeCommands.some((c) => c.id === cmd.id)) return s;
        return { resumeCommands: [cmd, ...s.resumeCommands] };
      });
    });

    // Reload sidebar when another client creates/renames/deletes a session or workspace
    socket.on("session_list_changed", () => {
      if (sessionListDebounce) clearTimeout(sessionListDebounce);
      sessionListDebounce = setTimeout(() => {
        get().loadSessions();
        get().loadWorkspaces();
      }, 500);
    });

    // Track whether each terminal's tmux session is still alive
    socket.on("session_health", ({ sessionId, alive }: { sessionId: string; alive: boolean }) => {
      set((s) => ({
        sessionHealth: { ...s.sessionHealth, [sessionId]: alive },
      }));
    });

    set({ socket });

    // Request browser notification permission (silent if already decided)
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    get().loadWorkspaces();
    get().loadSessions().then(() => {
      const savedId = localStorage.getItem(ACTIVE_SESSION_KEY);
      const sessions = get().sessions;
      if (savedId && sessions.some((s) => s.id === savedId)) {
        get().setActiveSession(savedId);
      } else {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    });
    get().loadResumeCommands();

    // Polling fallback in case a session_list_changed event is missed
    setInterval(() => {
      get().loadSessions();
    }, 30_000);
  },

  loadSessions: async () => {
    try {
      const { showArchived } = get();
      const url = showArchived ? "/api/sessions?include_archived=true" : "/api/sessions";
      const sessions = await apiFetch(url);
      set({ sessions });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to load sessions" });
    }
  },

  createSession: async (type, name, workspaceId) => {
    try {
      const session = await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ type, name, workspace_id: workspaceId ?? null }),
      });
      set((s) => ({ sessions: [session, ...s.sessions] }));
      get().setActiveSession(session.id);
      return session;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to create session" });
      return null;
    }
  },

  deleteSession: async (id) => {
    try {
      await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
      set((s) => {
        const sessions = s.sessions.filter((ses) => ses.id !== id);
        const activeSessionId =
          s.activeSessionId === id
            ? sessions[0]?.id || null
            : s.activeSessionId;
        if (activeSessionId) {
          localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
        } else {
          localStorage.removeItem(ACTIVE_SESSION_KEY);
        }
        return { sessions, activeSessionId };
      });

      const newActive = get().activeSessionId;
      if (newActive) get().setActiveSession(newActive);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to delete session" });
    }
  },

  renameSession: async (id, name) => {
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      set((s) => ({
        sessions: s.sessions.map((ses) =>
          ses.id === id ? { ...ses, name } : ses
        ),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to rename session" });
    }
  },

  setActiveSession: (id) => {
    const { socket, activeSessionId, unreadCounts } = get();

    if (activeSessionId && socket) {
      socket.emit("leave_session", { sessionId: activeSessionId });
    }

    const newUnread = { ...unreadCounts };
    delete newUnread[id];
    set({ activeSessionId: id, messages: [], unreadCounts: newUnread });
    localStorage.setItem(ACTIVE_SESSION_KEY, id);

    if (socket) {
      socket.emit("join_session", { sessionId: id });
    }

    const session = get().sessions.find((s) => s.id === id);
    if (session?.type === "conversation") {
      get().loadMessages(id);
    }
    // Immediately check if the terminal's tmux session is still alive
    if (session?.type === "terminal" && socket) {
      socket.emit("check_health", { sessionId: id });
    }
  },

  loadMessages: async (sessionId) => {
    try {
      const session = get().sessions.find((item) => item.id === sessionId);
      if (session?.type !== "conversation") {
        set({ messages: [] });
        return;
      }

      const messages = await apiFetch(`/api/sessions/${sessionId}/messages`);
      set({ messages });
    } catch (error) {
      set({
        messages: [],
        error: error instanceof Error ? error.message : "Failed to load messages",
      });
    }
  },

  sendMessage: async (content, role = "human", metadata = null) => {
    const { activeSessionId, clearError } = get();
    if (!activeSessionId) return;

    const trimmed = content.trim();
    if (!trimmed && !metadata) return;

    try {
      await apiFetch(`/api/sessions/${activeSessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ role, content: trimmed, metadata }),
      });
      clearError();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to send message" });
    }
  },

  uploadFile: async (file) => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      headers: API_KEY ? { "X-API-Key": API_KEY } : {},
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Upload failed");
    }

    return response.json();
  },

  loadResumeCommands: async () => {
    try {
      const commands = await apiFetch("/api/resume-commands");
      set({ resumeCommands: commands });
    } catch {
      // Non-critical — silently ignore
    }
  },

  deleteResumeCommand: async (id) => {
    try {
      await apiFetch(`/api/resume-commands/${id}`, { method: "DELETE" });
      set((s) => ({
        resumeCommands: s.resumeCommands.filter((c) => c.id !== id),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to delete resume command" });
    }
  },

  loadWorkspaces: async () => {
    try {
      const workspaces = await apiFetch("/api/workspaces");
      set({ workspaces });
    } catch {
      // Non-critical — silently ignore
    }
  },

  createWorkspace: async (name) => {
    try {
      const workspace = await apiFetch("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      set((s) => ({ workspaces: [workspace, ...s.workspaces] }));
      return workspace;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to create workspace" });
      return null;
    }
  },

  renameWorkspace: async (id, name) => {
    try {
      await apiFetch(`/api/workspaces/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to rename workspace" });
    }
  },

  deleteWorkspace: async (id) => {
    try {
      await apiFetch(`/api/workspaces/${id}`, { method: "DELETE" });
      set((s) => ({
        workspaces: s.workspaces.filter((w) => w.id !== id),
      }));
      await get().loadSessions();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to delete workspace" });
    }
  },

  moveSessionToWorkspace: async (sessionId, workspaceId) => {
    try {
      await apiFetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      set((s) => ({
        sessions: s.sessions.map((ses) =>
          ses.id === sessionId ? { ...ses, workspace_id: workspaceId } : ses
        ),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to move session" });
    }
  },

  sendMessageToSession: async (sessionId, content, role = "human") => {
    try {
      await apiFetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ role, content }),
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to send message" });
    }
  },

  togglePin: (sessionId) => {
    set((s) => {
      const next = new Set(s.pinnedSessionIds);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      savePinnedSessions(next);
      return { pinnedSessionIds: next };
    });
  },

  setTerminalFontSize: (size) => {
    localStorage.setItem(TERMINAL_FONT_SIZE_KEY, String(size));
    set({ terminalFontSize: size });
  },

  setTerminalTheme: (theme) => {
    localStorage.setItem(TERMINAL_THEME_KEY, theme);
    set({ terminalTheme: theme });
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

  archiveSession: async (id) => {
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: 1 }),
      });
      set((s) => {
        const sessions = s.showArchived
          ? s.sessions.map((ses) => (ses.id === id ? { ...ses, archived: 1 } : ses))
          : s.sessions.filter((ses) => ses.id !== id);
        const activeSessionId =
          s.activeSessionId === id
            ? sessions.find((ses) => !ses.archived)?.id || null
            : s.activeSessionId;
        return { sessions, activeSessionId };
      });
      const newActive = get().activeSessionId;
      if (newActive) get().setActiveSession(newActive);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to archive session" });
    }
  },

  restoreSession: async (id) => {
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: 0 }),
      });
      set((s) => ({
        sessions: s.sessions.map((ses) =>
          ses.id === id ? { ...ses, archived: 0 } : ses
        ),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to restore session" });
    }
  },

  toggleShowArchived: () => {
    set((s) => ({ showArchived: !s.showArchived }));
    get().loadSessions();
  },

  toggleSplit: () => {
    set((s) => {
      if (s.splitMode) {
        // Leaving split — leave the split session room
        if (s.splitSessionId && s.socket) {
          s.socket.emit("leave_session", { sessionId: s.splitSessionId });
        }
        return { splitMode: false, splitSessionId: null, splitMessages: [] };
      }
      return { splitMode: true };
    });
  },

  setSplitSession: (id) => {
    const { socket, splitSessionId } = get();
    if (splitSessionId && socket) {
      socket.emit("leave_session", { sessionId: splitSessionId });
    }
    set({ splitSessionId: id, splitMessages: [] });
    if (socket) {
      socket.emit("join_session", { sessionId: id });
    }
    get().loadSplitMessages(id);
  },

  loadSplitMessages: async (sessionId) => {
    try {
      const session = get().sessions.find((item) => item.id === sessionId);
      if (session?.type !== "conversation") {
        set({ splitMessages: [] });
        return;
      }
      const messages = await apiFetch(`/api/sessions/${sessionId}/messages`);
      set({ splitMessages: messages });
    } catch {
      set({ splitMessages: [] });
    }
  },
}));
