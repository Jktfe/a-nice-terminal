/// <reference types="vite/client" />
import { create } from "zustand";
import { io, Socket } from "socket.io-client";

export interface Session {
  id: string;
  name: string;
  type: "terminal" | "conversation";
  shell: string | null;
  cwd: string | null;
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
  activeSessionId: string | null;
  messages: Message[];
  resumeCommands: ResumeCommand[];
  socket: Socket | null;
  connected: boolean;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  error: string | null;
  sessionHealth: Record<string, boolean>;

  // Actions
  init: () => void;
  reconnect: () => Promise<void>;
  loadSessions: () => Promise<void>;
  createSession: (
    type: "terminal" | "conversation",
    name?: string
  ) => Promise<Session | null>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, name: string) => Promise<void>;
  setActiveSession: (id: string) => void;
  loadMessages: (sessionId: string) => Promise<void>;
  sendMessage: (content: string, role?: "human" | "agent" | "system", metadata?: any) => Promise<void>;
  uploadFile: (file: File) => Promise<{ url: string; filename: string }>;
  loadResumeCommands: () => Promise<void>;
  deleteResumeCommand: (id: string) => Promise<void>;
  toggleSidebar: () => void;
  toggleSettings: () => void;
  clearError: () => void;
  setError: (message: string) => void;
}

const API_KEY = (import.meta.env.VITE_ANT_API_KEY as string | undefined)?.trim();
const ACTIVE_SESSION_KEY = "ant-active-session-id";

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
  activeSessionId: null,
  messages: [],
  resumeCommands: [],
  socket: null,
  connected: false,
  sidebarOpen: true,
  settingsOpen: false,
  error: null,
  sessionHealth: {},

  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),

  reconnect: async () => {
    const { socket, activeSessionId } = get();
    await get().loadSessions();
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
        if (message.session_id !== s.activeSessionId) return s;
        if (s.messages.some((m) => m.id === message.id)) return s;
        return {
          messages: [...s.messages, message],
        };
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

    // Phase 2: Session freshness — react to server-side session mutations
    socket.on("session_list_changed", () => {
      if (sessionListDebounce) clearTimeout(sessionListDebounce);
      sessionListDebounce = setTimeout(() => {
        get().loadSessions();
      }, 500);
    });

    // Phase 4: Session health monitoring
    socket.on("session_health", ({ sessionId, alive }: { sessionId: string; alive: boolean }) => {
      set((s) => ({
        sessionHealth: { ...s.sessionHealth, [sessionId]: alive },
      }));
    });

    set({ socket });
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

    // Phase 2: 30-second polling fallback for session freshness
    setInterval(() => {
      get().loadSessions();
    }, 30_000);
  },

  loadSessions: async () => {
    try {
      const sessions = await apiFetch("/api/sessions");
      set({ sessions });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to load sessions" });
    }
  },

  createSession: async (type, name) => {
    try {
      const session = await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ type, name }),
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
    const { socket, activeSessionId } = get();

    if (activeSessionId && socket) {
      socket.emit("leave_session", { sessionId: activeSessionId });
    }

    set({ activeSessionId: id, messages: [] });
    localStorage.setItem(ACTIVE_SESSION_KEY, id);

    if (socket) {
      socket.emit("join_session", { sessionId: id });
    }

    const session = get().sessions.find((s) => s.id === id);
    if (session?.type === "conversation") {
      get().loadMessages(id);
    }
    // Phase 4: Check health for terminal sessions
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

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
}));
