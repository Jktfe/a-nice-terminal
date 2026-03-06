import { describe, it, expect, vi, beforeEach } from "vitest";

const fakePtyInstance = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
};

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => {
    // Return a fresh-ish fake each time
    fakePtyInstance.onData.mockReset();
    fakePtyInstance.onExit.mockReset();
    fakePtyInstance.write.mockReset();
    fakePtyInstance.resize.mockReset();
    fakePtyInstance.kill.mockReset();
    return fakePtyInstance;
  }),
}));

import {
  createPty,
  getPty,
  destroyPty,
  getTerminalOutput,
  getTerminalOutputCursor,
  resizePty,
  addPtyOutputListener,
  removePtyOutputListeners,
  hasOutputListeners,
} from "./pty-manager.js";

describe("pty-manager", () => {
  beforeEach(() => {
    // Clean up any PTY sessions from prior tests
    try { destroyPty("test-pty"); } catch {}
    try { destroyPty("test-pty-2"); } catch {}
    vi.clearAllMocks();
  });

  describe("createPty", () => {
    it("creates a PTY and returns the process", () => {
      const p = createPty("test-pty");
      expect(p).toBeDefined();
      expect(fakePtyInstance.onData).toHaveBeenCalled();
      expect(fakePtyInstance.onExit).toHaveBeenCalled();
    });

    it("returns existing PTY if already created", () => {
      const p1 = createPty("test-pty");
      const p2 = createPty("test-pty");
      expect(p1).toBe(p2);
    });

    it("rejects disallowed shells", () => {
      expect(() => createPty("test-pty-2", "/usr/bin/evil")).toThrow(
        "Shell not allowed"
      );
    });

    it("accepts allowed shells", () => {
      const p = createPty("test-pty", "/bin/zsh");
      expect(p).toBeDefined();
    });
  });

  describe("getPty", () => {
    it("returns undefined for unknown session", () => {
      expect(getPty("nonexistent")).toBeUndefined();
    });

    it("returns process for existing session", () => {
      createPty("test-pty");
      expect(getPty("test-pty")).toBeDefined();
    });
  });

  describe("destroyPty", () => {
    it("removes the PTY session", () => {
      createPty("test-pty");
      destroyPty("test-pty");
      expect(getPty("test-pty")).toBeUndefined();
    });

    it("is a no-op for unknown session", () => {
      expect(() => destroyPty("nonexistent")).not.toThrow();
    });
  });

  describe("output buffering and cursor pagination", () => {
    it("stores output events via onData callback", () => {
      createPty("test-pty");
      // Simulate onData callback
      const onDataCb = fakePtyInstance.onData.mock.calls[0][0];
      onDataCb("line1");
      onDataCb("line2");

      const output = getTerminalOutput("test-pty");
      expect(output).toHaveLength(2);
      expect(output[0]).toEqual({ index: 0, data: "line1" });
      expect(output[1]).toEqual({ index: 1, data: "line2" });
    });

    it("returns correct cursor position", () => {
      createPty("test-pty");
      const onDataCb = fakePtyInstance.onData.mock.calls[0][0];
      onDataCb("a");
      onDataCb("b");
      onDataCb("c");

      expect(getTerminalOutputCursor("test-pty")).toBe(3);
    });

    it("respects since parameter", () => {
      createPty("test-pty");
      const onDataCb = fakePtyInstance.onData.mock.calls[0][0];
      for (let i = 0; i < 5; i++) onDataCb(`line${i}`);

      const output = getTerminalOutput("test-pty", { since: 3 });
      expect(output).toHaveLength(2);
      expect(output[0].index).toBe(3);
    });

    it("respects limit parameter", () => {
      createPty("test-pty");
      const onDataCb = fakePtyInstance.onData.mock.calls[0][0];
      for (let i = 0; i < 10; i++) onDataCb(`line${i}`);

      const output = getTerminalOutput("test-pty", { since: 0, limit: 3 });
      expect(output).toHaveLength(3);
    });

    it("returns empty for unknown session", () => {
      expect(getTerminalOutput("nonexistent")).toEqual([]);
    });

    it("returns 0 cursor for unknown session", () => {
      expect(getTerminalOutputCursor("nonexistent")).toBe(0);
    });
  });

  describe("output listeners", () => {
    it("adds and invokes listeners", () => {
      createPty("test-pty");
      const listener = vi.fn();
      addPtyOutputListener("test-pty", listener);

      const onDataCb = fakePtyInstance.onData.mock.calls[0][0];
      onDataCb("test data");

      expect(listener).toHaveBeenCalledWith("test data");
    });

    it("returns undefined when adding listener to unknown session", () => {
      const result = addPtyOutputListener("nonexistent", vi.fn());
      expect(result).toBeUndefined();
    });

    it("returns a removal function", () => {
      createPty("test-pty");
      const listener = vi.fn();
      const remove = addPtyOutputListener("test-pty", listener)!;
      expect(typeof remove).toBe("function");
      remove();
      expect(hasOutputListeners("test-pty")).toBe(false);
    });

    it("clears all listeners", () => {
      createPty("test-pty");
      addPtyOutputListener("test-pty", vi.fn());
      addPtyOutputListener("test-pty", vi.fn());
      expect(hasOutputListeners("test-pty")).toBe(true);
      removePtyOutputListeners("test-pty");
      expect(hasOutputListeners("test-pty")).toBe(false);
    });
  });

  describe("resizePty", () => {
    it("resizes an existing PTY", () => {
      createPty("test-pty");
      resizePty("test-pty", 80, 24);
      expect(fakePtyInstance.resize).toHaveBeenCalledWith(80, 24);
    });

    it("clamps values", () => {
      createPty("test-pty");
      resizePty("test-pty", 0, 999);
      expect(fakePtyInstance.resize).toHaveBeenCalledWith(1, 200);
    });

    it("is a no-op for unknown session", () => {
      expect(() => resizePty("nonexistent", 80, 24)).not.toThrow();
    });
  });
});
