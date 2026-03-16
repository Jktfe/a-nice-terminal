import { describe, it, expect, vi } from "vitest";
import { resolveSession } from "../resolve.js";
import type { Client } from "../client.js";

function mockClient(getMock: (...args: any[]) => any): Client {
  return {
    get: vi.fn(getMock),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
    config: { server: "http://localhost:3000" },
  };
}

describe("resolveSession", () => {
  it("resolves by ID when session exists", async () => {
    const client = mockClient(async () => ({ id: "abc123", name: "My Session", type: "conversation" }));
    const session = await resolveSession(client, "abc123");
    expect(session.id).toBe("abc123");
  });

  it("falls back to search when ID lookup fails", async () => {
    let callCount = 0;
    const client = mockClient(async (path: string) => {
      callCount++;
      if (callCount === 1) throw new Error("Not found"); // ID lookup fails
      if (path.startsWith("/api/search")) return { sessions: [{ id: "found-id", name: "Dev Notes", type: "conversation" }], messages: [] };
      return { id: "found-id", name: "Dev Notes", type: "conversation" }; // full session fetch
    });
    const session = await resolveSession(client, "Dev Notes");
    expect(session.id).toBe("found-id");
  });

  it("throws on zero matches", async () => {
    const client = mockClient(async (path: string) => {
      if (path.startsWith("/api/search")) return { sessions: [], messages: [] };
      throw new Error("Not found");
    });
    await expect(resolveSession(client, "nonexistent")).rejects.toThrow(/No session found/);
  });

  it("throws on ambiguous matches", async () => {
    const client = mockClient(async (path: string) => {
      if (path.startsWith("/api/search")) return {
        sessions: [
          { id: "s1", name: "Dev Notes", type: "conversation" },
          { id: "s2", name: "Dev Terminal", type: "terminal" },
        ],
        messages: [],
      };
      throw new Error("Not found");
    });
    await expect(resolveSession(client, "Dev")).rejects.toThrow(/Ambiguous/);
  });
});
