import { create } from "zustand";
import { io, Socket } from "socket.io-client";

export interface Session {
  id: string;
  name: string;
  type: "terminal" | "conversation";
  shell: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: "human" | "agent" | "system";
  content: string;
  format: string;
  status: "pending" | "streaming" | "complete";
  created_at: string;
}

interface AppState {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Message[];
  socket: Socket | null;
  connected: boolean;
  sidebarOpen: boolean;

  // Actions
  init: () => void;
  loadSessions: () => Promise<void>;
  createSession: (
    type: "terminal" | "conversation",
    name?: string
  ) => Promise<Session>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, name: string) => Promise<void>;
  setActiveSession: (id: string) => void;
  loadMessages: (sessionId: string) => Promise<void>;
  sendMessage: (content: string, role?: string) => Promise<void>;
  toggleSidebar: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  socket: null,
  connected: false,
  sidebarOpen: true,

  init: () => {
    // Prevent double-init (React StrictMode)
    if (get().socket) return;

    const socket = io();

    socket.on("connect", () => set({ connected: true }));
    socket.on("disconnect", () => set({ connected: false }));

    // Check if already connected (can happen if connect fires before listener)
    if (socket.connected) set({ connected: true });

    socket.on("message_created", (message: Message) => {
      set((s) => {
        if (message.session_id !== s.activeSessionId) return s;
        if (s.messages.some((m) => m.id === message.id)) return s;
        return { messages: [...s.messages, message] };
      });
    });

    socket.on("message_updated", (message: Message) => {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === message.id ? message : m)),
      }));
    });

    socket.on("message_deleted", ({ id }: { id: string }) => {
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== id),
      }));
    });

    set({ socket });
    get().loadSessions();
  },

  loadSessions: async () => {
    const res = await fetch("/api/sessions");
    const sessions = await res.json();
    set({ sessions });
  },

  createSession: async (type, name) => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, name }),
    });
    const session = await res.json();
    set((s) => ({ sessions: [session, ...s.sessions] }));
    get().setActiveSession(session.id);
    return session;
  },

  deleteSession: async (id) => {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    set((s) => {
      const sessions = s.sessions.filter((ses) => ses.id !== id);
      const activeSessionId =
        s.activeSessionId === id
          ? sessions[0]?.id || null
          : s.activeSessionId;
      return { sessions, activeSessionId };
    });

    const newActive = get().activeSessionId;
    if (newActive) get().setActiveSession(newActive);
  },

  renameSession: async (id, name) => {
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    set((s) => ({
      sessions: s.sessions.map((ses) =>
        ses.id === id ? { ...ses, name } : ses
      ),
    }));
  },

  setActiveSession: (id) => {
    const { socket, activeSessionId } = get();

    // Leave previous session room
    if (activeSessionId && socket) {
      socket.emit("leave_session", { sessionId: activeSessionId });
    }

    set({ activeSessionId: id, messages: [] });

    // Join new session room
    if (socket) {
      socket.emit("join_session", { sessionId: id });
    }

    // Load messages for conversation sessions
    const session = get().sessions.find((s) => s.id === id);
    if (session?.type === "conversation") {
      get().loadMessages(id);
    }
  },

  loadMessages: async (sessionId) => {
    const res = await fetch(`/api/sessions/${sessionId}/messages`);
    const messages = await res.json();
    set({ messages });
  },

  sendMessage: async (content, role = "human") => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;

    await fetch(`/api/sessions/${activeSessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content }),
    });
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
