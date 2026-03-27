import { describe, it, expect, beforeEach } from "vitest";
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
