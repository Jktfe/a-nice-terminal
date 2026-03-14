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
  ttl_minutes: number | null;
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
  sender_type?: string;
  sender_name?: string;
  sender_cwd?: string;
  sender_persona?: string;
  thread_id?: string;
  annotations?: Array<{ type: string; by: string; at: string; note?: string }>;
  starred?: number;
  reply_count?: number;
}

export type AgentState = "idle" | "thinking" | "working" | "wrapped";

export interface AgentPresence {
  sessionId: string;
  agentId: string;
  state: AgentState;
  lastUpdated: string;
}

interface AppState {
  sessions: Session[];
  workspaces: Workspace[];
  activeSessionId: string | null;
  messages: Message[];
  resumeCommands: ResumeCommand[];
  socket: Socket | null;
  chatSocket: Socket | null;
  connected: boolean;
  chatConnected: boolean;
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
  agentPresence: Record<string, AgentPresence>;

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
  setAgentState: (sessionId: string, agentId: string, state: AgentState) => void;
}

const API_KEY = (import.meta.env.VITE_ANT_API_KEY as string | undefined)?.trim();
const CHAT_URL = import.meta.env.VITE_ANT_CHAT_URL || `${window.location.protocol}//${window.location.hostname}:6464`;
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
    headers.set("Authorization", `Bearer ${API_KEY}`);
    headers.set("x-api-key", API_KEY);
  }
  return headers;
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<any> {
  const fullUrl = url.startsWith("http") ? url : url;

  const headers = buildHeaders(options.headers);
  const response = await fetch(fullUrl, { ...options, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Request failed with status ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function chatApiFetch(url: string, options?: RequestInit) {
  const apiKey = import.meta.env.VITE_ANT_API_KEY;
  const headers: Record<string, string> = {
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
    ...(options?.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${CHAT_URL}${url}`, { ...options, headers });
  if (!res.ok) throw new Error(`Chat API error ${res.status}`);
  return res.json();
}

export const useStore = create<AppState>((set, get) => ({
  sessions: [],
  workspaces: [],
  activeSessionId: localStorage.getItem(ACTIVE_SESSION_KEY),
  messages: [],
  resumeCommands: [],
  socket: null,
  chatSocket: null,
  connected: false,
  chatConnected: false,
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
  agentPresence: {},

  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),

  reconnect: async () => {
    const { socket, chatSocket, activeSessionId } = get();
    await get().loadSessions();
    await get().loadWorkspaces();
    await get().loadResumeCommands();

    if (activeSessionId) {
      if (socket) socket.emit("join_session", { sessionId: activeSessionId });
      if (chatSocket) chatSocket.emit("join_session", { sessionId: activeSessionId });
      
      const session = get().sessions.find((s) => s.id === activeSessionId);
      if (session?.type === "conversation") {
        await get().loadMessages(activeSessionId);
      }
    }
  },

  init: () => {
    if (get().socket) return;

    const socket = io({
      auth: API_KEY ? { apiKey: API_KEY } : undefined,
      query: API_KEY ? { apiKey: API_KEY } : undefined,
    });

    const chatSocket = io(CHAT_URL, {
      auth: API_KEY ? { apiKey: API_KEY } : undefined,
      query: API_KEY ? { apiKey: API_KEY } : undefined,
    });

    socket.on("connect", () => {
      const isReconnect = get().sessions.length > 0;
      set({ connected: true, error: null });
      if (isReconnect) {
        get().reconnect();
      } else {
        const { activeSessionId } = get();
        if (activeSessionId) socket.emit("join_session", { sessionId: activeSessionId });
      }
    });

    chatSocket.on("connect", () => {
      set({ chatConnected: true });
      const { activeSessionId } = get();
      if (activeSessionId) chatSocket.emit("join_session", { sessionId: activeSessionId });
    });

    socket.on("disconnect", () => set({ connected: false }));
    chatSocket.on("disconnect", () => set({ chatConnected: false }));

    socket.on("connect_error", (error) => {
      set({ connected: false, error: error.message || "Terminal socket failed" });
    });

    chatSocket.on("connect_error", (error) => {
      console.error("Chat socket error:", error);
    });

    socket.on("error", (error: { message?: string }) => {
      if (typeof error === "object" && error?.message) {
        set({ error: error.message });
      }
    });

    chatSocket.on("message_created", (message: Message) => {
      set((s) => {
        const isActive = message.session_id === s.activeSessionId;
        const isSplit = message.session_id === s.splitSessionId;

        let unreadCounts = s.unreadCounts;
        if (!isActive) {
          unreadCounts = {
            ...s.unreadCounts,
            [message.session_id]: (s.unreadCounts[message.session_id] || 0) + 1,
          };

          if (document.hidden && Notification.permission === "granted") {
            const session = s.sessions.find((ses) => ses.id === message.session_id);
            const body = message.content.length > 100
              ? message.content.slice(0, 100) + "..."
              : message.content;
            new Notification(session?.name || "ANT", { body });
          }
        }

        let splitMessages = s.splitMessages;
        if (isSplit && !splitMessages.some((m) => m.id === message.id)) {
          splitMessages = [...splitMessages, message];
        }

        const agentPresence = { ...s.agentPresence };
        if (message.role === "agent") {
           delete agentPresence[message.session_id];
        }

        return {
          messages: isActive ? [...s.messages, message] : s.messages,
          unreadCounts,
          splitMessages,
          agentPresence
        };
      });
    });

    chatSocket.on("message_updated", (message: Message) => {
      set((s) => {
        const isActive = message.session_id === s.activeSessionId;
        const isSplit = message.session_id === s.splitSessionId;
        const updatedMessages = s.messages.map((m) => (m.id === message.id ? message : m));
        const updatedSplitMessages = s.splitMessages.map((m) => (m.id === message.id ? message : m));
        return {
          messages: isActive ? updatedMessages : s.messages,
          splitMessages: isSplit ? updatedSplitMessages : s.splitMessages,
        };
      });
    });

    chatSocket.on("message_deleted", ({ id, sessionId }) => {
      set((s) => ({
        messages: sessionId === s.activeSessionId ? s.messages.filter((m) => m.id !== id) : s.messages,
        splitMessages: sessionId === s.splitSessionId ? s.splitMessages.filter((m) => m.id !== id) : s.splitMessages,
      }));
    });

    chatSocket.on("stream_chunk", ({ sessionId, messageId, content }) => {
      set((s) => {
        const isActive = sessionId === s.activeSessionId;
        const isSplit = sessionId === s.splitSessionId;

        const updateChunks = (msgs: Message[]): Message[] => {
          const existing = msgs.find((m) => m.id === messageId);
          if (existing) {
            return msgs.map((m) =>
              m.id === messageId ? { ...m, content: m.content + content, status: "streaming" as const } : m
            );
          }
          return [
            ...msgs,
            {
              id: messageId,
              session_id: sessionId,
              role: "agent" as const,
              content,
              format: "markdown",
              status: "streaming",
              created_at: new Date().toISOString(),
            },
          ];
        };

        return {
          messages: isActive ? updateChunks(s.messages) : s.messages,
          splitMessages: isSplit ? updateChunks(s.splitMessages) : s.splitMessages,
        };
      });
    });

    socket.on("session_list_changed", () => get().loadSessions());

    socket.on("session_health", ({ sessionId, isAlive }) => {
      set((s) => ({
        sessionHealth: { ...s.sessionHealth, [sessionId]: isAlive },
      }));
    });

    chatSocket.on("agent_state_update", (presence: AgentPresence) => {
      set((s) => ({
        agentPresence: {
          ...s.agentPresence,
          [presence.sessionId]: presence,
        },
      }));
    });

    chatSocket.on("annotation_changed", ({ messageId, annotations, starred }: { messageId: string; annotations: any[]; starred: number }) => {
      const { messages, splitMessages } = get();
      const update = (msgs: Message[]) => msgs.map((m) =>
        m.id === messageId ? { ...m, annotations, starred } : m
      );
      set({ messages: update(messages), splitMessages: update(splitMessages) });
    });

    set({ socket, chatSocket });
  },

  loadSessions: async () => {
    try {
      const sessions = await apiFetch("/api/sessions?include_archived=true");
      set({ sessions });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  loadWorkspaces: async () => {
    try {
      const workspaces = await apiFetch("/api/workspaces");
      set({ workspaces });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  createWorkspace: async (name) => {
    try {
      const ws = await apiFetch("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await get().loadWorkspaces();
      return ws;
    } catch (err: any) {
      set({ error: err.message });
      return null;
    }
  },

  renameWorkspace: async (id, name) => {
    try {
      await apiFetch(`/api/workspaces/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await get().loadWorkspaces();
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  deleteWorkspace: async (id) => {
    try {
      await apiFetch(`/api/workspaces/${id}`, { method: "DELETE" });
      await get().loadWorkspaces();
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  moveSessionToWorkspace: async (sessionId, workspaceId) => {
    try {
      await apiFetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      await get().loadSessions();
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  createSession: async (type, name, workspaceId) => {
    try {
      const session = await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ type, name, workspace_id: workspaceId }),
      });
      await get().loadSessions();
      set({ activeSessionId: session.id });
      localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
      return session;
    } catch (err: any) {
      set({ error: err.message });
      return null;
    }
  },

  deleteSession: async (id) => {
    try {
      await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
      const { activeSessionId, sessions } = get();
      const updatedSessions = sessions.filter((s) => s.id !== id);
      set({ sessions: updatedSessions });
      if (activeSessionId === id) {
        const next = updatedSessions.find((s) => s.archived === 0)?.id || null;
        set({ activeSessionId: next });
        if (next) localStorage.setItem(ACTIVE_SESSION_KEY, next);
        else localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  renameSession: async (id, name) => {
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await get().loadSessions();
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  archiveSession: async (id) => {
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      await get().loadSessions();
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  restoreSession: async (id) => {
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
      });
      await get().loadSessions();
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  toggleShowArchived: () => set((s) => ({ showArchived: !s.showArchived })),

  setActiveSession: (id) => {
    const { socket, chatSocket, activeSessionId } = get();
    if (activeSessionId === id) return;

    if (activeSessionId) {
      if (socket) socket.emit("leave_session", { sessionId: activeSessionId });
      if (chatSocket) chatSocket.emit("leave_session", { sessionId: activeSessionId });
    }

    set({ activeSessionId: id, messages: [] });
    localStorage.setItem(ACTIVE_SESSION_KEY, id);

    if (socket) socket.emit("join_session", { sessionId: id });
    if (chatSocket) chatSocket.emit("join_session", { sessionId: id });

    const session = get().sessions.find((s) => s.id === id);
    if (session?.type === "conversation") {
      get().loadMessages(id);
    }
  },

  loadMessages: async (sessionId) => {
    try {
      const messages = await chatApiFetch(`/api/sessions/${sessionId}/messages`);
      if (get().activeSessionId === sessionId) {
        set({ messages });
      }
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  sendMessage: async (content, role = "human", metadata) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    return get().sendMessageToSession(activeSessionId, content, role);
  },

  sendMessageToSession: async (sessionId, content, role = "human") => {
    try {
      await chatApiFetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, role }),
      });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  uploadFile: async (file) => {
    const formData = new FormData();
    formData.append("file", file);

    const headers = new Headers();
    if (API_KEY) {
      headers.set("Authorization", `Bearer ${API_KEY}`);
      headers.set("x-api-key", API_KEY);
    }

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      headers,
    });

    if (!response.ok) {
      throw new Error("File upload failed");
    }

    return response.json();
  },

  loadResumeCommands: async () => {
    try {
      const commands = await apiFetch("/api/resume-commands");
      set({ resumeCommands: commands });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  deleteResumeCommand: async (id) => {
    try {
      await apiFetch(`/api/resume-commands/${id}`, { method: "DELETE" });
      await get().loadResumeCommands();
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  togglePin: (sessionId) => {
    set((s) => {
      const next = new Set(s.pinnedSessionIds);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
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

  toggleSplit: () => {
    set((s) => {
      const { socket, chatSocket, splitSessionId, splitMode } = s;
      if (splitMode) {
        if (splitSessionId) {
          if (socket) socket.emit("leave_session", { sessionId: splitSessionId });
          if (chatSocket) chatSocket.emit("leave_session", { sessionId: splitSessionId });
        }
        return { splitMode: false, splitSessionId: null, splitMessages: [] };
      }
      return { splitMode: true };
    });
  },

  setSplitSession: (id) => {
    const { socket, chatSocket, splitSessionId } = get();
    if (splitSessionId) {
      if (socket) socket.emit("leave_session", { sessionId: splitSessionId });
      if (chatSocket) chatSocket.emit("leave_session", { sessionId: splitSessionId });
    }
    set({ splitSessionId: id, splitMessages: [] });
    if (socket) socket.emit("join_session", { sessionId: id });
    if (chatSocket) chatSocket.emit("join_session", { sessionId: id });
    get().loadSplitMessages(id);
  },

  loadSplitMessages: async (sessionId) => {
    try {
      const session = get().sessions.find((item) => item.id === sessionId);
      if (session?.type !== "conversation") {
        set({ splitMessages: [] });
        return;
      }
      const messages = await chatApiFetch(`/api/sessions/${sessionId}/messages`);
      set({ splitMessages: messages });
    } catch {
      set({ splitMessages: [] });
    }
  },

  setAgentState: (sessionId, agentId, state) => {
    set((s) => ({
      agentPresence: {
        ...s.agentPresence,
        [sessionId]: {
          sessionId,
          agentId,
          state,
          lastUpdated: new Date().toISOString(),
        },
      },
    }));
  },
}));
