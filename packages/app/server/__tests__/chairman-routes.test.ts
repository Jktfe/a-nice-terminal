import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../pty-manager.js", () => ({
  getPty: vi.fn(),
  getHeadless: vi.fn(),
}));

import { getPty, getHeadless } from "../pty-manager.js";
import supertest from "supertest";
import express from "express";
import chairmanRouter from "../routes/chairman.js";
import { testDb } from "./setup.ts";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(chairmanRouter);
  return app;
}

describe("GET /api/chairman/status", () => {
  beforeEach(() => {
    testDb.prepare("DELETE FROM server_state WHERE key = 'chairman_room'").run();
  });

  it("includes room in response", async () => {
    const res = await supertest(createApp()).get("/api/chairman/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("room");
    expect(res.body.room).toBe("");
  });

  it("shows room value after it has been set", async () => {
    testDb
      .prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES ('chairman_room', 'ChatV2')")
      .run();
    const res = await supertest(createApp()).get("/api/chairman/status");
    expect(res.status).toBe(200);
    expect(res.body.room).toBe("ChatV2");
  });
});

describe("POST /api/chairman/room", () => {
  beforeEach(() => {
    testDb.prepare("DELETE FROM server_state WHERE key = 'chairman_room'").run();
  });

  it("sets chairman_room in server_state", async () => {
    const res = await supertest(createApp())
      .post("/api/chairman/room")
      .send({ room: "ChatV2" });
    expect(res.status).toBe(200);
    expect(res.body.room).toBe("ChatV2");

    const row = testDb
      .prepare("SELECT value FROM server_state WHERE key = 'chairman_room'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe("ChatV2");
  });

  it("returns 400 when room is missing", async () => {
    const res = await supertest(createApp())
      .post("/api/chairman/room")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when room is whitespace only", async () => {
    const res = await supertest(createApp())
      .post("/api/chairman/room")
      .send({ room: "   " });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chairman/terminal-action", () => {
  beforeEach(() => {
    testDb.prepare("INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)").run(
      "chat-sess", "Chat", "conversation"
    );
    testDb.prepare(
      "INSERT OR IGNORE INTO messages (id, session_id, role, content, format, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "msg-1", "chat-sess", "agent", "Approval required", "markdown", "complete",
      JSON.stringify({ type: "terminal_approval", status: "pending" })
    );
  });

  it("approve: writes y\\n to PTY and patches message status", async () => {
    const mockWrite = vi.fn();
    vi.mocked(getPty).mockReturnValue({ write: mockWrite } as any);

    const res = await supertest(createApp())
      .post("/api/chairman/terminal-action")
      .send({ terminal_id: "term-1", action: "approve", message_id: "msg-1", session_id: "chat-sess" });

    expect(res.status).toBe(200);
    expect(mockWrite).toHaveBeenCalledWith("y\n");
    const msg = testDb.prepare("SELECT metadata FROM messages WHERE id = 'msg-1'").get() as any;
    expect(JSON.parse(msg.metadata).status).toBe("approved");
  });

  it("reject: writes n\\n to PTY and patches message status", async () => {
    const mockWrite = vi.fn();
    vi.mocked(getPty).mockReturnValue({ write: mockWrite } as any);

    const res = await supertest(createApp())
      .post("/api/chairman/terminal-action")
      .send({ terminal_id: "term-1", action: "reject", message_id: "msg-1", session_id: "chat-sess" });

    expect(res.status).toBe(200);
    expect(mockWrite).toHaveBeenCalledWith("n\n");
    const msg = testDb.prepare("SELECT metadata FROM messages WHERE id = 'msg-1'").get() as any;
    expect(JSON.parse(msg.metadata).status).toBe("rejected");
  });

  it("returns 409 when message already resolved", async () => {
    testDb.prepare("UPDATE messages SET metadata = ? WHERE id = 'msg-1'").run(
      JSON.stringify({ type: "terminal_approval", status: "approved" })
    );
    vi.mocked(getPty).mockReturnValue({ write: vi.fn() } as any);

    const res = await supertest(createApp())
      .post("/api/chairman/terminal-action")
      .send({ terminal_id: "term-1", action: "approve", message_id: "msg-1", session_id: "chat-sess" });

    expect(res.status).toBe(409);
  });

  it("returns 404 when PTY not found", async () => {
    vi.mocked(getPty).mockReturnValue(undefined);

    const res = await supertest(createApp())
      .post("/api/chairman/terminal-action")
      .send({ terminal_id: "missing", action: "approve", message_id: "msg-1", session_id: "chat-sess" });

    expect(res.status).toBe(404);
  });

  it("view: returns screen lines without writing to PTY", async () => {
    vi.mocked(getHeadless).mockReturnValue({
      getScreenLines: () => ["line 1", "line 2"],
    } as any);

    const res = await supertest(createApp())
      .post("/api/chairman/terminal-action")
      .send({ terminal_id: "term-1", action: "view", message_id: "msg-1", session_id: "chat-sess" });

    expect(res.status).toBe(200);
    expect(res.body.lines).toEqual(["line 1", "line 2"]);
  });
});
