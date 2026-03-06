import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { apiKeyAuth } from "./auth.js";

function createApp() {
  const app = express();
  app.use(apiKeyAuth);
  app.get("/test", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("apiKeyAuth middleware", () => {
  const ORIGINAL_KEY = process.env.ANT_API_KEY;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.ANT_API_KEY;
    } else {
      process.env.ANT_API_KEY = ORIGINAL_KEY;
    }
  });

  it("passes through when no API key is configured", async () => {
    delete process.env.ANT_API_KEY;
    const res = await request(createApp()).get("/test");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("allows requests with correct X-API-Key header", async () => {
    process.env.ANT_API_KEY = "secret-123";
    const res = await request(createApp())
      .get("/test")
      .set("X-API-Key", "secret-123");
    expect(res.status).toBe(200);
  });

  it("allows requests with Bearer token", async () => {
    process.env.ANT_API_KEY = "secret-123";
    const res = await request(createApp())
      .get("/test")
      .set("Authorization", "Bearer secret-123");
    expect(res.status).toBe(200);
  });

  it("rejects requests with wrong API key", async () => {
    process.env.ANT_API_KEY = "secret-123";
    const res = await request(createApp())
      .get("/test")
      .set("X-API-Key", "wrong-key");
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("rejects requests with no API key when one is required", async () => {
    process.env.ANT_API_KEY = "secret-123";
    const res = await request(createApp()).get("/test");
    expect(res.status).toBe(401);
  });

  it("handles Bearer prefix case-insensitively", async () => {
    process.env.ANT_API_KEY = "secret-123";
    const res = await request(createApp())
      .get("/test")
      .set("Authorization", "bearer secret-123");
    expect(res.status).toBe(200);
  });

  it("handles whitespace in token values", async () => {
    process.env.ANT_API_KEY = "secret-123";
    const res = await request(createApp())
      .get("/test")
      .set("X-API-Key", "  secret-123  ");
    expect(res.status).toBe(200);
  });

  it("rejects empty API key header", async () => {
    process.env.ANT_API_KEY = "secret-123";
    const res = await request(createApp())
      .get("/test")
      .set("X-API-Key", "");
    expect(res.status).toBe(401);
  });

  it("prefers X-API-Key over Authorization header", async () => {
    process.env.ANT_API_KEY = "correct";
    const res = await request(createApp())
      .get("/test")
      .set("X-API-Key", "correct")
      .set("Authorization", "Bearer wrong");
    expect(res.status).toBe(200);
  });
});
