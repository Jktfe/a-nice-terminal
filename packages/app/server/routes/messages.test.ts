import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { createTestApp, seedSession, seedMessage } from "../__tests__/helpers.js";

vi.mock("../pty-manager.js", async (importOriginal) => {
  return {
    stripAnsi: vi.fn((s: string) => s),
    destroyPty: vi.fn(),
    destroyAllPtys: vi.fn(() => 0),
    createPty: vi.fn(),
    getPty: vi.fn(),
    getTerminalOutput: vi.fn(() => []),
    getTerminalOutputCursor: vi.fn(() => 0),
    resizePty: vi.fn(),
    addPtyOutputListener: vi.fn(),
    searchTerminalOutput: vi.fn(() => []),
    hasTmuxSession: vi.fn(() => false),
    hasOutputListeners: vi.fn(() => false),
    removePtyOutputListeners: vi.fn(),
    onResumeCommand: vi.fn(() => () => {}),
    startKillTimer: vi.fn(),
    cancelKillTimer: vi.fn(),
    checkSessionHealth: vi.fn(() => true),
    detachPty: vi.fn(),
    reapOrphanedSessions: vi.fn(),
  };
});

describe("messages routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  describe("GET /api/sessions/:sessionId/messages", () => {
    it("returns messages for conversation session", async () => {
      seedSession({ id: "s1", type: "conversation" });
      seedMessage({ id: "m1", session_id: "s1", content: "Hello" });
      const res = await request(app).get("/api/sessions/s1/messages");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].content).toBe("Hello");
    });

    it("returns 404 for missing session", async () => {
      const res = await request(app).get("/api/sessions/missing/messages");
      expect(res.status).toBe(404);
    });

    it("returns 409 for terminal session", async () => {
      seedSession({ id: "t1", type: "terminal" });
      const res = await request(app).get("/api/sessions/t1/messages");
      expect(res.status).toBe(409);
    });

    it("respects limit parameter", async () => {
      seedSession({ id: "s2", type: "conversation" });
      for (let i = 0; i < 5; i++) {
        seedMessage({ id: `m${i}`, session_id: "s2", content: `Msg ${i}` });
      }
      const res = await request(app).get("/api/sessions/s2/messages?limit=2");
      expect(res.body).toHaveLength(2);
    });
  });

  describe("POST /api/sessions/:sessionId/messages", () => {
    it("creates a message with defaults", async () => {
      seedSession({ id: "s1", type: "conversation" });
      const res = await request(app)
        .post("/api/sessions/s1/messages")
        .send({ content: "Hello world" });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe("agent");
      expect(res.body.format).toBe("markdown");
      expect(res.body.status).toBe("complete");
    });

    it("normalises 'user' role to 'human'", async () => {
      seedSession({ id: "s1", type: "conversation" });
      const res = await request(app)
        .post("/api/sessions/s1/messages")
        .send({ role: "user", content: "Hi" });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe("human");
    });

    it("normalises 'assistant' role to 'agent'", async () => {
      seedSession({ id: "s1", type: "conversation" });
      const res = await request(app)
        .post("/api/sessions/s1/messages")
        .send({ role: "assistant", content: "Hi" });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe("agent");
    });

    it("rejects invalid role", async () => {
      seedSession({ id: "s1", type: "conversation" });
      const res = await request(app)
        .post("/api/sessions/s1/messages")
        .send({ role: "admin", content: "Hi" });
      expect(res.status).toBe(400);
    });

    it("rejects invalid format", async () => {
      seedSession({ id: "s1", type: "conversation" });
      const res = await request(app)
        .post("/api/sessions/s1/messages")
        .send({ content: "Hi", format: "html" });
      expect(res.status).toBe(400);
    });

    it("rejects content over 100k", async () => {
      seedSession({ id: "s1", type: "conversation" });
      const res = await request(app)
        .post("/api/sessions/s1/messages")
        .send({ content: "x".repeat(100_001) });
      expect(res.status).toBe(400);
    });

    it("rejects terminal session", async () => {
      seedSession({ id: "t1", type: "terminal" });
      const res = await request(app)
        .post("/api/sessions/t1/messages")
        .send({ content: "Hi" });
      expect(res.status).toBe(409);
    });
  });

  describe("PATCH /api/sessions/:sessionId/messages/:id", () => {
    it("updates message content", async () => {
      seedSession({ id: "s1", type: "conversation" });
      seedMessage({ id: "m1", session_id: "s1" });
      const res = await request(app)
        .patch("/api/sessions/s1/messages/m1")
        .send({ content: "Updated" });
      expect(res.status).toBe(200);
      expect(res.body.content).toBe("Updated");
    });

    it("updates message status", async () => {
      seedSession({ id: "s1", type: "conversation" });
      seedMessage({ id: "m1", session_id: "s1", status: "streaming" });
      const res = await request(app)
        .patch("/api/sessions/s1/messages/m1")
        .send({ status: "complete" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("complete");
    });

    it("returns 404 for missing message", async () => {
      seedSession({ id: "s1", type: "conversation" });
      const res = await request(app)
        .patch("/api/sessions/s1/messages/missing")
        .send({ content: "X" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/sessions/:sessionId/messages/:id", () => {
    it("deletes a message", async () => {
      seedSession({ id: "s1", type: "conversation" });
      seedMessage({ id: "m1", session_id: "s1" });
      const res = await request(app).delete("/api/sessions/s1/messages/m1");
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
    });

    it("returns 404 for missing message", async () => {
      seedSession({ id: "s1", type: "conversation" });
      const res = await request(app).delete(
        "/api/sessions/s1/messages/missing"
      );
      expect(res.status).toBe(404);
    });
  });
});
