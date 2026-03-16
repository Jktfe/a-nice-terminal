import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, seedSession, seedWorkspace } from "../__tests__/helpers.js";
import db from "../db.js";

vi.mock("../pty-manager.js", () => ({
  createPty: vi.fn(() => ({ write: vi.fn(), kill: vi.fn() })),
  getPty: vi.fn(() => undefined),
  destroyPty: vi.fn(),
  destroyAllPtys: vi.fn(() => 0),
  getTerminalOutput: vi.fn(() => []),
  getTerminalOutputCursor: vi.fn(() => 0),
  resizePty: vi.fn(),
  addPtyOutputListener: vi.fn(),
  searchTerminalOutput: vi.fn(() => []),
}));

import { createPty, getPty, getTerminalOutput, getTerminalOutputCursor } from "../pty-manager.js";

describe("sessions routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    // Clean all tables to prevent state leaking between tests
    db.exec("DELETE FROM messages");
    db.exec("DELETE FROM resume_commands");
    db.exec("DELETE FROM terminal_output_events");
    db.exec("DELETE FROM sessions");
    db.exec("DELETE FROM workspaces");
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/sessions", () => {
    it("returns empty array when no sessions", async () => {
      const res = await request(app).get("/api/sessions");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns all sessions", async () => {
      seedSession({ id: "s1", name: "One", type: "conversation" });
      seedSession({ id: "s2", name: "Two", type: "terminal" });
      const res = await request(app).get("/api/sessions");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });

  describe("GET /api/sessions/:id", () => {
    it("returns a single session", async () => {
      seedSession({ id: "s1", name: "Test" });
      const res = await request(app).get("/api/sessions/s1");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("s1");
    });

    it("returns 404 for missing session", async () => {
      const res = await request(app).get("/api/sessions/missing");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/sessions", () => {
    it("creates a conversation session", async () => {
      const res = await request(app)
        .post("/api/sessions")
        .send({ name: "Chat", type: "conversation" });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe("conversation");
      expect(res.body.name).toBe("Chat");
    });

    it("creates a terminal session", async () => {
      const res = await request(app)
        .post("/api/sessions")
        .send({ type: "terminal" });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe("terminal");
      expect(res.body.name).toBe("Terminal");
    });

    it("defaults to conversation type", async () => {
      const res = await request(app)
        .post("/api/sessions")
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.type).toBe("conversation");
    });

    it("rejects invalid type", async () => {
      const res = await request(app)
        .post("/api/sessions")
        .send({ type: "invalid" });
      expect(res.status).toBe(400);
    });

    it("creates session with workspace_id", async () => {
      seedWorkspace({ id: "w1", name: "Test WS" });
      const res = await request(app)
        .post("/api/sessions")
        .send({ type: "conversation", workspace_id: "w1" });
      expect(res.status).toBe(201);
      expect(res.body.workspace_id).toBe("w1");
    });
  });

  describe("PATCH /api/sessions/:id", () => {
    it("updates session name", async () => {
      seedSession({ id: "s1", name: "Old" });
      const res = await request(app)
        .patch("/api/sessions/s1")
        .send({ name: "New Name" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
    });

    it("returns 404 for missing session", async () => {
      const res = await request(app)
        .patch("/api/sessions/missing")
        .send({ name: "X" });
      expect(res.status).toBe(404);
    });

    it("updates workspace_id", async () => {
      seedWorkspace({ id: "w1", name: "WS" });
      seedSession({ id: "s1", name: "Test" });
      const res = await request(app)
        .patch("/api/sessions/s1")
        .send({ workspace_id: "w1" });
      expect(res.status).toBe(200);
      expect(res.body.workspace_id).toBe("w1");
    });

    it("ungroups session by setting workspace_id to null", async () => {
      seedWorkspace({ id: "w1", name: "WS" });
      seedSession({ id: "s1", name: "Test", workspace_id: "w1" });
      const res = await request(app)
        .patch("/api/sessions/s1")
        .send({ workspace_id: null });
      expect(res.status).toBe(200);
      expect(res.body.workspace_id).toBeNull();
    });
  });

  describe("DELETE /api/sessions/:id", () => {
    it("deletes an existing session", async () => {
      seedSession({ id: "s1" });
      const res = await request(app).delete("/api/sessions/s1");
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
    });

    it("returns 404 for missing session", async () => {
      const res = await request(app).delete("/api/sessions/missing");
      expect(res.status).toBe(404);
    });
  });

  describe("unique name enforcement", () => {
    it("rejects creating a session with a duplicate active name", async () => {
      seedSession({ id: "uq-existing-1", name: "Dev Notes", type: "conversation" });
      const res = await request(app).post("/api/sessions").send({ name: "Dev Notes", type: "conversation" });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
    });

    it("allows creating a session with same name as archived session", async () => {
      seedSession({ id: "uq-archived-1", name: "Dev Notes", type: "conversation", archived: 1 });
      const res = await request(app).post("/api/sessions").send({ name: "Dev Notes", type: "conversation" });
      expect(res.status).toBe(201);
    });

    it("rejects duplicate names case-insensitively", async () => {
      seedSession({ id: "uq-existing-2", name: "Dev Notes", type: "conversation" });
      const res = await request(app).post("/api/sessions").send({ name: "dev notes", type: "conversation" });
      expect(res.status).toBe(409);
    });

    it("auto-increments default terminal names", async () => {
      seedSession({ id: "uq-t1", name: "Terminal", type: "terminal" });
      const res = await request(app).post("/api/sessions").send({ type: "terminal" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Terminal 2");
    });

    it("auto-increments default conversation names", async () => {
      seedSession({ id: "uq-c1", name: "Conversation", type: "conversation" });
      const res = await request(app).post("/api/sessions").send({ type: "conversation" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Conversation 2");
    });

    it("auto-increments past existing numbered names", async () => {
      seedSession({ id: "uq-t1b", name: "Terminal", type: "terminal" });
      seedSession({ id: "uq-t2b", name: "Terminal 2", type: "terminal" });
      seedSession({ id: "uq-t3b", name: "Terminal 3", type: "terminal" });
      const res = await request(app).post("/api/sessions").send({ type: "terminal" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Terminal 4");
    });
  });

  describe("unique name on rename", () => {
    it("rejects renaming to a name used by another active session", async () => {
      seedSession({ id: "rn-s1", name: "Session A" });
      seedSession({ id: "rn-s2", name: "Session B" });
      const res = await request(app).patch("/api/sessions/rn-s2").send({ name: "Session A" });
      expect(res.status).toBe(409);
    });

    it("allows renaming to same name (no-op)", async () => {
      seedSession({ id: "rn-s3", name: "Session A" });
      const res = await request(app).patch("/api/sessions/rn-s3").send({ name: "Session A" });
      expect(res.status).toBe(200);
    });
  });

  describe("archive behaviour", () => {
    it("archives a session", async () => {
      seedSession({ id: "s1", name: "Test" });
      const res = await request(app)
        .patch("/api/sessions/s1")
        .send({ archived: 1 });
      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(1);
    });

    it("excludes archived sessions from default list", async () => {
      seedSession({ id: "s1", name: "Active" });
      seedSession({ id: "s2", name: "Archived", archived: 1 });
      const res = await request(app).get("/api/sessions");
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe("s1");
    });

    it("includes archived sessions when include_archived=true", async () => {
      seedSession({ id: "s1", name: "Active" });
      seedSession({ id: "s2", name: "Archived", archived: 1 });
      const res = await request(app).get("/api/sessions?include_archived=true");
      expect(res.body).toHaveLength(2);
    });

    it("restores an archived session", async () => {
      seedSession({ id: "s1", name: "Test", archived: 1 });
      const res = await request(app)
        .patch("/api/sessions/s1")
        .send({ archived: 0 });
      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(0);
    });

    it("permanently deletes an archived session", async () => {
      seedSession({ id: "s1", name: "Test", archived: 1 });
      const res = await request(app).delete("/api/sessions/s1");
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
    });
  });

  describe("archive auto-rename", () => {
    it("appends timestamp suffix when archiving", async () => {
      seedSession({ id: "ar-s1", name: "Dev Notes" });
      const res = await request(app).patch("/api/sessions/ar-s1").send({ archived: true });
      expect(res.status).toBe(200);
      expect(res.body.name).toMatch(/^Dev Notes \(archived \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)$/);
      expect(res.body.archived).toBe(1);
    });
  });

  describe("restore strip suffix", () => {
    it("strips archive suffix on restore when original name is free", async () => {
      seedSession({ id: "rs-s1", name: "Dev Notes (archived 2026-03-16 09:47:32)", archived: 1 });
      const res = await request(app).patch("/api/sessions/rs-s1").send({ archived: false });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Dev Notes");
    });

    it("keeps suffix on restore when original name is taken", async () => {
      seedSession({ id: "rs-s2", name: "Dev Notes (archived 2026-03-16 09:47:32)", archived: 1 });
      seedSession({ id: "rs-s3", name: "Dev Notes" });
      const res = await request(app).patch("/api/sessions/rs-s2").send({ archived: false });
      expect(res.status).toBe(200);
      expect(res.body.name).toMatch(/archived/);
    });
  });

  describe("POST /api/sessions/:sessionId/terminal/input", () => {
    it("accepts input for terminal session", async () => {
      seedSession({ id: "t1", type: "terminal" });
      const mockPty = { write: vi.fn(), kill: vi.fn() };
      vi.mocked(getPty).mockReturnValue(undefined);
      vi.mocked(createPty).mockReturnValue(mockPty as any);
      vi.mocked(getTerminalOutputCursor).mockReturnValue(5);

      const res = await request(app)
        .post("/api/sessions/t1/terminal/input")
        .send({ data: "ls\n" });
      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
    });

    it("rejects input for conversation session (409)", async () => {
      seedSession({ id: "c1", type: "conversation" });
      const res = await request(app)
        .post("/api/sessions/c1/terminal/input")
        .send({ data: "ls\n" });
      expect(res.status).toBe(409);
    });

    it("rejects non-string data", async () => {
      seedSession({ id: "t2", type: "terminal" });
      const res = await request(app)
        .post("/api/sessions/t2/terminal/input")
        .send({ data: 123 });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/sessions/:sessionId/terminal/resize", () => {
    it("resizes terminal", async () => {
      seedSession({ id: "t3", type: "terminal" });
      const res = await request(app)
        .post("/api/sessions/t3/terminal/resize")
        .send({ cols: 80, rows: 24 });
      expect(res.status).toBe(200);
      expect(res.body.cols).toBe(80);
      expect(res.body.rows).toBe(24);
    });

    it("rejects non-terminal session", async () => {
      seedSession({ id: "c2", type: "conversation" });
      const res = await request(app)
        .post("/api/sessions/c2/terminal/resize")
        .send({ cols: 80, rows: 24 });
      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/sessions/:sessionId/terminal/output", () => {
    it("returns terminal output", async () => {
      seedSession({ id: "t4", type: "terminal" });
      vi.mocked(getTerminalOutput).mockReturnValue([
        { index: 0, data: "hello" },
      ]);
      vi.mocked(getTerminalOutputCursor).mockReturnValue(1);

      const res = await request(app).get("/api/sessions/t4/terminal/output");
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.cursor).toBe(1);
    });

    it("rejects non-terminal session", async () => {
      seedSession({ id: "c3", type: "conversation" });
      const res = await request(app).get("/api/sessions/c3/terminal/output");
      expect(res.status).toBe(409);
    });
  });
});
