import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createTestApp, seedMessage, seedSession } from "../__tests__/helpers.js";

vi.mock("../pty-manager.js", () => ({
  createPty: vi.fn(() => ({ write: vi.fn(), kill: vi.fn() })),
  getPty: vi.fn(() => undefined),
  destroyPty: vi.fn(),
  destroyAllPtys: vi.fn(),
  getTerminalOutput: vi.fn(() => []),
  getTerminalOutputCursor: vi.fn(() => 0),
  resizePty: vi.fn(),
  searchTerminalOutput: vi.fn(() => []),
}));

describe("annotation routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  it("stores structured session ratings", async () => {
    seedSession({ id: "s1", type: "conversation" });
    seedMessage({ id: "m1", session_id: "s1", role: "agent" });

    const res = await request(app)
      .post("/api/sessions/s1/messages/m1/annotate")
      .send({
        type: "session_rating",
        by: "human",
        data: { sentiment: "up", outcome: 4, speed: 5, trust: 4 },
      });

    expect(res.status).toBe(200);
    expect(res.body.annotations).toHaveLength(1);
    expect(res.body.annotations[0].data).toEqual({
      sentiment: "up",
      outcome: 4,
      speed: 5,
      trust: 4,
    });
  });

  it("updates an existing session rating instead of toggling it off when payload changes", async () => {
    seedSession({ id: "s2", type: "conversation" });
    seedMessage({ id: "m2", session_id: "s2", role: "agent" });

    await request(app)
      .post("/api/sessions/s2/messages/m2/annotate")
      .send({ type: "session_rating", by: "human", data: { sentiment: "up", outcome: 4 } });

    const res = await request(app)
      .post("/api/sessions/s2/messages/m2/annotate")
      .send({ type: "session_rating", by: "human", data: { sentiment: "down", outcome: 2 } });

    expect(res.status).toBe(200);
    expect(res.body.annotations).toHaveLength(1);
    expect(res.body.annotations[0].data).toEqual({ sentiment: "down", outcome: 2 });
  });

  it("aggregates session ratings", async () => {
    seedSession({ id: "s3", type: "conversation" });
    seedMessage({ id: "m3", session_id: "s3", role: "agent" });
    seedMessage({ id: "m4", session_id: "s3", role: "agent" });

    await request(app)
      .post("/api/sessions/s3/messages/m3/annotate")
      .send({ type: "session_rating", by: "human", data: { sentiment: "up", outcome: 5, speed: 4, trust: 5 } });

    await request(app)
      .post("/api/sessions/s3/messages/m4/annotate")
      .send({ type: "session_rating", by: "human", data: { sentiment: "down", outcome: 2, speed: 3, trust: 2 } });

    const res = await request(app).get("/api/sessions/s3/ratings");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.positive).toBe(1);
    expect(res.body.negative).toBe(1);
    expect(res.body.averages).toEqual({
      outcome: 3.5,
      speed: 3.5,
      trust: 3.5,
    });
  });
});
