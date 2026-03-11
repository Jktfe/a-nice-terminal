import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, seedWorkspace, seedSession } from "../__tests__/helpers.js";

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

describe("workspaces routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces", () => {
    it("returns empty array when no workspaces", async () => {
      const res = await request(app).get("/api/workspaces");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns all workspaces", async () => {
      seedWorkspace({ id: "w1", name: "Project A" });
      seedWorkspace({ id: "w2", name: "Project B" });
      const res = await request(app).get("/api/workspaces");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });

  describe("POST /api/workspaces", () => {
    it("creates a workspace", async () => {
      const res = await request(app)
        .post("/api/workspaces")
        .send({ name: "My Workspace" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("My Workspace");
      expect(res.body.id).toBeDefined();
    });

    it("rejects empty name", async () => {
      const res = await request(app)
        .post("/api/workspaces")
        .send({ name: "" });
      expect(res.status).toBe(400);
    });

    it("rejects missing name", async () => {
      const res = await request(app)
        .post("/api/workspaces")
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/workspaces/:id", () => {
    it("renames a workspace", async () => {
      seedWorkspace({ id: "w1", name: "Old" });
      const res = await request(app)
        .patch("/api/workspaces/w1")
        .send({ name: "New Name" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
    });

    it("returns 404 for missing workspace", async () => {
      const res = await request(app)
        .patch("/api/workspaces/missing")
        .send({ name: "X" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/workspaces/:id", () => {
    it("deletes a workspace", async () => {
      seedWorkspace({ id: "w1" });
      const res = await request(app).delete("/api/workspaces/w1");
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
    });

    it("returns 404 for missing workspace", async () => {
      const res = await request(app).delete("/api/workspaces/missing");
      expect(res.status).toBe(404);
    });

    it("ungroups sessions when workspace deleted", async () => {
      seedWorkspace({ id: "w1" });
      seedSession({ id: "s1", name: "In Workspace", workspace_id: "w1" });

      await request(app).delete("/api/workspaces/w1");

      const sessionRes = await request(app).get("/api/sessions/s1");
      expect(sessionRes.status).toBe(200);
      expect(sessionRes.body.workspace_id).toBeNull();
    });
  });
});
