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
  type: "terminal" | "conversation" | "unified";
  shell: string | null;
  cwd: string | null;
  workspace_id: string | null;
  archived: number;
  ttl_minutes: number | null;
  tier?: "sprint" | "session" | "persistent";
  terminal_id?: string | null;
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
  annotations?: Array<{
    type: string;
    by: string;
    at: string;
    note?: string;
    data?: {
      sentiment?: "up" | "down";
      outcome?: number;
      speed?: number;
      trust?: number;
    };
  }>;
  starred?: number;
  reply_count?: number;
  message_type?: "text" | "command_result" | "terminal_block" | "agent_action" | "terminal_embed" | "file" | "image";
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
  agentPresence: Record<string, AgentPresence>;
  uiTheme: UiTheme;
  docsOpen: boolean;
  knowledgePanelOpen: boolean;
  parseDeleteSessionId: string | null;
  draftsBySessionId: Record<string, string>;
  commonCallsOpen: boolean;
  chatViewMode: ChatViewMode;
  offlineQueue: Array<{ sessionId: string; content: string; role: string; queuedAt: string }>;

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
    type: "terminal" | "conversation" | "unified",
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
  archiveOrDeleteSession: (id: string) => Promise<void>;
  restoreSession: (id: string) => Promise<void>;
  toggleShowArchived: () => void;
  toggleSplit: () => void;
  setSplitSession: (id: string) => void;
  loadSplitMessages: (sessionId: string) => Promise<void>;
  setAgentState: (sessionId: string, agentId: string, state: AgentState) => void;
  setUiTheme: (theme: UiTheme) => void;
  toggleDocs: () => void;
  toggleKnowledgePanel: () => void;
  openParseDeleteDialog: (id: string) => void;
  closeParseDeleteDialog: () => void;
  saveDraft: (sessionId: string, text: string) => void;
  clearDraft: (sessionId: string) => void;
  toggleCommonCalls: () => void;
  setChatViewMode: (mode: ChatViewMode) => void;
}

const API_KEY = (import.meta.env.VITE_ANT_API_KEY as string | undefined)?.trim();
const ACTIVE_SESSION_KEY = "ant-active-session-id";
const PINNED_SESSIONS_KEY = "ant-pinned-session-ids";
const TERMINAL_FONT_SIZE_KEY = "ant-terminal-font-size";
const TERMINAL_THEME_KEY = "ant-terminal-theme";
const UI_THEME_KEY = "ant-ui-theme";
const CHAT_VIEW_MODE_KEY = "ant-chat-view-mode";

export type UiTheme = "dark" | "light" | "system";
export type ChatViewMode = "classic" | "aero";

function applyUiTheme(theme: UiTheme) {
  const root = document.documentElement;
  if (theme === "system") {
    const preferLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    root.classList.toggle("light", preferLight);
  } else {
    root.classList.toggle("light", theme === "light");
  }
}

function loadUiTheme(): UiTheme {
  const stored = localStorage.getItem(UI_THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "light";
}

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
  const headers = buildHeaders(options.headers);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Request failed with status ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export const useStore = create<AppState>((set, get) => ({
  sessions: [],
  workspaces: [],
  activeSessionId: localStorage.getItem(ACTIVE_SESSION_KEY),
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
  agentPresence: {},
  uiTheme: loadUiTheme(),
  docsOpen: false,
  knowledgePanelOpen: false,
  parseDeleteSessionId: null,
  draftsBySessionId: {},
  commonCallsOpen: false,
  chatViewMode: (localStorage.getItem(CHAT_VIEW_MODE_KEY) as ChatViewMode) || "classic",
  offlineQueue: JSON.parse(localStorage.getItem("ant-offline-queue") || "[]"),

  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),

  reconnect: async () => {
    const { socket, activeSessionId } = get();
    await get().loadSessions();
    await get().loadWorkspaces();
    await get().loadResumeCommands();

    if (activeSessionId) {
      if (socket) socket.emit("join_session", { sessionId: activeSessionId });
      
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

    socket.on("connect", () => {
      set({ connected: true, error: null });
      get().loadSessions();
      get().loadWorkspaces();
      get().loadResumeCommands();
      const { activeSessionId } = get();
      if (activeSessionId) socket.emit("join_session", { sessionId: activeSessionId });

      // Flush offline message queue
      const queue = get().offlineQueue;
      if (queue.length > 0) {
        set({ offlineQueue: [] });
        localStorage.removeItem("ant-offline-queue");
        for (const msg of queue) {
          apiFetch(`/api/sessions/${msg.sessionId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: msg.content, role: msg.role }),
          }).catch(() => {});
        }
      }
    });

    socket.on("disconnect", () => set({ connected: false }));

    socket.on("connect_error", (error) => {
      set({ connected: false, error: error.message || "Socket connection failed" });
    });

    socket.on("error", (error: { message?: string }) => {
      if (typeof error === "object" && error?.message) {
        set({ error: error.message });
      }
    });

    // --- Message event handlers ---

    const handleMessageCreated = (message: Message) => {
      set((s) => {
        const isActive = message.session_id === s.activeSessionId;
        const isSplit = message.session_id === s.splitSessionId;

        // Dedup: ignore if we already have this message
        if (isActive && s.messages.some((m) => m.id === message.id)) return s;

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
    };

    const handleMessageUpdated = (message: Message) => {
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
    };

    const handleMessageDeleted = ({ id, sessionId }: { id: string; sessionId: string }) => {
      set((s) => ({
        messages: sessionId === s.activeSessionId ? s.messages.filter((m) => m.id !== id) : s.messages,
        splitMessages: sessionId === s.splitSessionId ? s.splitMessages.filter((m) => m.id !== id) : s.splitMessages,
      }));
    };

    const handleStreamChunk = ({ sessionId, messageId, content }: { sessionId: string; messageId: string; content: string }) => {
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
    };

    const handleAnnotationChanged = ({ messageId, annotations, starred }: { messageId: string; annotations: any[]; starred: number }) => {
      set((s) => ({
        messages: s.messages.map((m) => m.id === messageId ? { ...m, annotations, starred } : m),
        splitMessages: s.splitMessages.map((m) => m.id === messageId ? { ...m, annotations, starred } : m),
      }));
    };

    socket.on("message_created", handleMessageCreated);
    socket.on("message_updated", handleMessageUpdated);
    socket.on("message_deleted", handleMessageDeleted);
    socket.on("stream_chunk", handleStreamChunk);
    socket.on("annotation_changed", handleAnnotationChanged);

    socket.on("session_list_changed", () => get().loadSessions());

    socket.on("session_health", ({ sessionId, isAlive }) => {
      set((s) => ({
        sessionHealth: { ...s.sessionHealth, [sessionId]: isAlive },
      }));
    });

    socket.on("agent_state_update", (presence: AgentPresence) => {
      set((s) => ({
        agentPresence: {
          ...s.agentPresence,
          [presence.sessionId]: presence,
        },
      }));
    });

    set({ socket });
  },

  loadSessions: async () => {
    try {
      const sessions = await apiFetch("/api/sessions?include_archived=true");
      set({ sessions });
      // Validate stored active session still exists
      const { activeSessionId } = get();
      if (activeSessionId && !sessions.find((s: Session) => s.id === activeSessionId)) {
        const fallback = sessions.find((s: Session) => !s.archived)?.id || null;
        set({ activeSessionId: fallback, error: null });
        if (fallback) localStorage.setItem(ACTIVE_SESSION_KEY, fallback);
        else localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
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
      get().setActiveSession(session.id);
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
      // Clean up draft for deleted session
      const { [id]: _, ...remainingDrafts } = get().draftsBySessionId;
      set({ draftsBySessionId: remainingDrafts });
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

  archiveOrDeleteSession: async (id) => {
    try {
      const { hasContent } = await apiFetch(`/api/sessions/${id}/has-content`);
      if (hasContent) {
        await get().archiveSession(id);
      } else {
        await get().deleteSession(id);
      }
    } catch {
      // Fallback to archive if content check fails
      await get().archiveSession(id);
    }
  },

  restoreSession: async (id) => {
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
      });
      await get().loadSessions();
      // Re-join to spawn PTY if this is the active terminal session
      const { activeSessionId, socket } = get();
      if (activeSessionId === id && socket) {
        socket.emit("leave_session", { sessionId: id });
        socket.emit("join_session", { sessionId: id });
      }
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  toggleShowArchived: () => set((s) => ({ showArchived: !s.showArchived })),

  setActiveSession: (id) => {
    const { socket, activeSessionId } = get();
    if (activeSessionId === id) return;

    if (activeSessionId) {
      if (socket) socket.emit("leave_session", { sessionId: activeSessionId });
    }

    set({ activeSessionId: id, messages: [] });
    localStorage.setItem(ACTIVE_SESSION_KEY, id);

    if (socket) socket.emit("join_session", { sessionId: id });

    const session = get().sessions.find((s) => s.id === id);
    if (session?.type === "conversation") {
      get().loadMessages(id);
    }
  },

  loadMessages: async (sessionId) => {
    try {
      const messages = await apiFetch(`/api/sessions/${sessionId}/messages`);
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
    const { connected } = get();

    // If offline, queue the message for later
    if (!connected) {
      const queued = { sessionId, content, role, queuedAt: new Date().toISOString() };
      const queue = [...get().offlineQueue, queued];
      localStorage.setItem("ant-offline-queue", JSON.stringify(queue));
      set({ offlineQueue: queue });
      return;
    }

    try {
      await apiFetch(`/api/sessions/${sessionId}/messages`, {
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
      const { socket, splitSessionId, splitMode } = s;
      if (splitMode) {
        if (splitSessionId) {
          if (socket) socket.emit("leave_session", { sessionId: splitSessionId });
        }
        return { splitMode: false, splitSessionId: null, splitMessages: [] };
      }
      return { splitMode: true };
    });
  },

  setSplitSession: (id) => {
    const { socket, splitSessionId } = get();
    if (splitSessionId) {
      if (socket) socket.emit("leave_session", { sessionId: splitSessionId });
    }
    set({ splitSessionId: id, splitMessages: [] });
    if (socket) socket.emit("join_session", { sessionId: id });
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

  setUiTheme: (theme) => {
    localStorage.setItem(UI_THEME_KEY, theme);
    applyUiTheme(theme);
    set({ uiTheme: theme });
  },

  toggleDocs: () => set((s) => ({ docsOpen: !s.docsOpen })),
  toggleKnowledgePanel: () => set((s) => ({ knowledgePanelOpen: !s.knowledgePanelOpen })),
  openParseDeleteDialog: (id) => set({ parseDeleteSessionId: id }),
  closeParseDeleteDialog: () => set({ parseDeleteSessionId: null }),
  saveDraft: (sessionId, text) => set((s) => ({
    draftsBySessionId: { ...s.draftsBySessionId, [sessionId]: text },
  })),
  clearDraft: (sessionId) => set((s) => {
    const { [sessionId]: _, ...rest } = s.draftsBySessionId;
    return { draftsBySessionId: rest };
  }),
  toggleCommonCalls: () => set((s) => ({ commonCallsOpen: !s.commonCallsOpen })),
  setChatViewMode: (mode) => {
    localStorage.setItem(CHAT_VIEW_MODE_KEY, mode);
    set({ chatViewMode: mode });
  },
}));

// Apply theme on load
applyUiTheme(loadUiTheme());

// Listen for system theme changes
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  const { uiTheme } = useStore.getState();
  if (uiTheme === "system") applyUiTheme("system");
});
