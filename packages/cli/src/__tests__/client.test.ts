import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "../client.js";

describe("createClient", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("creates a client with expected methods", () => {
    const client = createClient({ server: "http://localhost:3000" });
    expect(typeof client.get).toBe("function");
    expect(typeof client.post).toBe("function");
    expect(typeof client.patch).toBe("function");
    expect(typeof client.del).toBe("function");
  });

  it("builds correct URL and includes auth headers", async () => {
    let capturedUrl = "";
    let capturedHeaders: any = {};
    globalThis.fetch = async (url: any, opts: any) => {
      capturedUrl = url.toString();
      capturedHeaders = Object.fromEntries(new Headers(opts?.headers).entries());
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const client = createClient({ server: "http://localhost:3000", apiKey: "test-key" });
    await client.get("/api/health");
    expect(capturedUrl).toBe("http://localhost:3000/api/health");
    expect(capturedHeaders["x-api-key"]).toBe("test-key");
  });

  it("throws on non-OK response with parsed error", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    };

    const client = createClient({ server: "http://localhost:3000" });
    await expect(client.get("/api/sessions/bad")).rejects.toThrow("Not found");
  });
});
