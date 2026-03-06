import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, seedSession } from "../__tests__/helpers.js";

vi.mock("../pty-manager.js", () => ({
  createPty: vi.fn(() => ({ write: vi.fn(), kill: vi.fn() })),
  getPty: vi.fn(() => undefined),
  destroyPty: vi.fn(),
  getTerminalOutput: vi.fn(() => []),
  getTerminalOutputCursor: vi.fn(() => 0),
  resizePty: vi.fn(),
}));

import { createPty, getPty, getTerminalOutput, getTerminalOutputCursor } from "../pty-manager.js";

describe("sessions routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
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
