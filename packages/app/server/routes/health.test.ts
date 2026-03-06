import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "../__tests__/helpers.js";

describe("GET /api/health", () => {
  it("returns status ok", async () => {
    const app = createTestApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns version string", async () => {
    const app = createTestApp();
    const res = await request(app).get("/api/health");
    expect(res.body.version).toBe("0.1.0");
  });
});
