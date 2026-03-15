import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerSocketHandlers } from "./handlers.js";

vi.mock("../pty-manager.js", () => ({
  createPty: vi.fn(() => ({ write: vi.fn(), kill: vi.fn() })),
  getPty: vi.fn(() => undefined),
  getHeadless: vi.fn(() => undefined),
  getCommandTracker: vi.fn(() => undefined),
  destroyPty: vi.fn(),
  hasOutputListeners: vi.fn(() => false),
  addPtyOutputListener: vi.fn(() => () => {}),
  resizePty: vi.fn(),
  onResumeCommand: vi.fn(() => () => {}),
  onCwdUpdate: vi.fn(() => () => {}),
  onCommandLifecycle: vi.fn(() => () => {}),
  hasTmuxSession: vi.fn(() => false),
  startKillTimer: vi.fn(),
  cancelKillTimer: vi.fn(),
  checkSessionHealth: vi.fn(() => true),
  stripAnsi: vi.fn((s: string) => s),
}));

import {
  createPty,
  getPty,
  hasOutputListeners,
  addPtyOutputListener,
  resizePty,
  destroyPty,
  startKillTimer,
} from "../pty-manager.js";
import db from "../db.js";
const testDb = db;

function createMockSocket() {
  const handlers = new Map<string, Function>();
  return {
    on: vi.fn((event: string, handler: Function) => {
      handlers.set(event, handler);
    }),
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    _trigger(event: string, ...args: any[]) {
      const handler = handlers.get(event);
      if (handler) handler(...args);
    },
  };
}

function createMockIo() {
  const connectionHandlers: Function[] = [];
  const rooms = new Map<string, Set<string>>();
  const toRoom = {
    emit: vi.fn(),
  };
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (event === "connection") connectionHandlers.push(handler);
    }),
    to: vi.fn(() => toRoom),
    emit: vi.fn(),
    toRoom,
    sockets: {
      adapter: { rooms },
    },
    _simulateConnection(socket: any) {
      for (const handler of connectionHandlers) handler(socket);
    },
  };
}

function seedTestSession(id: string, type: string, shell: string | null = null) {
  testDb
    .prepare("INSERT OR REPLACE INTO sessions (id, name, type, shell) VALUES (?, ?, ?, ?)")
    .run(id, `Session ${id}`, type, shell);
}

describe("WebSocket handlers", () => {
  let mockIo: ReturnType<typeof createMockIo>;
  let mockSocket: ReturnType<typeof createMockSocket>;

  beforeEach(() => {
    mockIo = createMockIo();
    mockSocket = createMockSocket();
    registerSocketHandlers(mockIo as any);
    mockIo._simulateConnection(mockSocket);
    vi.clearAllMocks();
  });

  describe("join_session", () => {
    it("joins a conversation session room", () => {
      seedTestSession("s1", "conversation");
      mockSocket._trigger("join_session", { sessionId: "s1" });
      expect(mockSocket.join).toHaveBeenCalledWith("s1");
      expect(mockSocket.emit).toHaveBeenCalledWith("session_joined", {
        sessionId: "s1",
        type: "conversation",
      });
    });

    it("joins a terminal session and creates PTY", () => {
      seedTestSession("t1", "terminal");
      mockSocket._trigger("join_session", { sessionId: "t1" });
      expect(mockSocket.join).toHaveBeenCalledWith("t1");
      expect(vi.mocked(addPtyOutputListener)).toHaveBeenCalled();
    });

    it("emits error for missing session", () => {
      mockSocket._trigger("join_session", { sessionId: "nonexistent" });
      expect(mockSocket.emit).toHaveBeenCalledWith("error", {
        message: "Session not found",
      });
    });

    it("emits error for invalid sessionId", () => {
      mockSocket._trigger("join_session", { sessionId: "" });
      expect(mockSocket.emit).toHaveBeenCalledWith("error", {
        message: "Invalid sessionId",
      });
    });

    it("emits error for non-string sessionId", () => {
      mockSocket._trigger("join_session", { sessionId: 123 });
      expect(mockSocket.emit).toHaveBeenCalledWith("error", {
        message: "Invalid sessionId",
      });
    });
  });

  describe("leave_session", () => {
    it("leaves a session room", () => {
      mockSocket._trigger("leave_session", { sessionId: "s1" });
      expect(mockSocket.leave).toHaveBeenCalledWith("s1");
    });

    it("ignores empty sessionId", () => {
      mockSocket._trigger("leave_session", { sessionId: "" });
      expect(mockSocket.leave).not.toHaveBeenCalled();
    });

    it("does not call startKillTimer synchronously (500ms delay)", () => {
      seedTestSession("t1", "terminal");
      mockSocket._trigger("join_session", { sessionId: "t1" });
      vi.clearAllMocks();

      mockSocket._trigger("leave_session", { sessionId: "t1" });

      // Kill timer should NOT be called synchronously — 500ms delay
      expect(vi.mocked(startKillTimer)).not.toHaveBeenCalled();
    });
  });

  describe("terminal_input", () => {
    it("writes data to existing PTY", () => {
      seedTestSession("t1", "terminal");
      const mockPtyProcess = { write: vi.fn(), kill: vi.fn() };
      vi.mocked(getPty).mockReturnValue(mockPtyProcess as any);

      mockSocket._trigger("terminal_input", { sessionId: "t1", data: "ls\n" });
      expect(mockPtyProcess.write).toHaveBeenCalledWith("ls\n");
    });

    it("creates PTY if none exists", () => {
      seedTestSession("t2", "terminal");
      vi.mocked(getPty).mockReturnValue(undefined);
      vi.mocked(createPty).mockReturnValue({ write: vi.fn(), kill: vi.fn() } as any);

      mockSocket._trigger("terminal_input", { sessionId: "t2", data: "ls\n" });
      expect(vi.mocked(createPty)).toHaveBeenCalled();
    });

    it("rejects non-terminal session", () => {
      seedTestSession("c1", "conversation");
      mockSocket._trigger("terminal_input", { sessionId: "c1", data: "ls\n" });
      expect(mockSocket.emit).toHaveBeenCalledWith("error", {
        message: "Not a terminal session",
      });
    });

    it("rejects non-string data", () => {
      seedTestSession("t3", "terminal");
      mockSocket._trigger("terminal_input", { sessionId: "t3", data: 123 });
      expect(mockSocket.emit).toHaveBeenCalledWith("error", {
        message: "Invalid input payload",
      });
    });

    it("rejects oversized input", () => {
      seedTestSession("t4", "terminal");
      mockSocket._trigger("terminal_input", {
        sessionId: "t4",
        data: "x".repeat(10_001),
      });
      expect(mockSocket.emit).toHaveBeenCalledWith("error", {
        message: "Invalid input payload",
      });
    });
  });

  describe("terminal_resize", () => {
    it("resizes terminal", () => {
      seedTestSession("t1", "terminal");
      mockSocket._trigger("terminal_resize", {
        sessionId: "t1",
        cols: 80,
        rows: 24,
      });
      expect(vi.mocked(resizePty)).toHaveBeenCalledWith("t1", 80, 24);
    });

    it("emits error for non-terminal session", () => {
      seedTestSession("c1", "conversation");
      mockSocket._trigger("terminal_resize", {
        sessionId: "c1",
        cols: 80,
        rows: 24,
      });
      expect(mockSocket.emit).toHaveBeenCalledWith("error", {
        message: "Not a terminal session",
      });
    });

    it("emits error for invalid dimensions", () => {
      seedTestSession("t2", "terminal");
      mockSocket._trigger("terminal_resize", {
        sessionId: "t2",
        cols: "bad",
        rows: 24,
      });
      expect(mockSocket.emit).toHaveBeenCalledWith("error", {
        message: "Invalid terminal size",
      });
    });
  });

});
