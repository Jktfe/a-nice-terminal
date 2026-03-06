import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the `api` helper and tool logic by extracting them.
// Since the MCP server auto-starts, we mock the MCP SDK and fetch.

const mockConnect = vi.fn();
const mockTool = vi.fn();

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn(() => ({
    tool: mockTool,
    connect: mockConnect,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Store original env
const originalEnv = { ...process.env };

describe("MCP server tools", () => {
  let toolHandlers: Map<string, Function>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    toolHandlers = new Map();

    // Capture tool registrations
    mockTool.mockImplementation((name: string, _desc: string, _schema: any, handler: Function) => {
      toolHandlers.set(name, handler);
    });

    // Import module to trigger tool registrations
    await import("./index.js");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  function mockJsonResponse(data: any, status = 200) {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    });
  }

  function mockErrorResponse(data: any, status: number) {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    });
  }

  it("registers all 9 tools", () => {
    expect(toolHandlers.size).toBe(9);
    expect(toolHandlers.has("ant_list_sessions")).toBe(true);
    expect(toolHandlers.has("ant_create_session")).toBe(true);
    expect(toolHandlers.has("ant_read_messages")).toBe(true);
    expect(toolHandlers.has("ant_send_message")).toBe(true);
    expect(toolHandlers.has("ant_stream_message")).toBe(true);
    expect(toolHandlers.has("ant_complete_stream")).toBe(true);
    expect(toolHandlers.has("ant_terminal_input")).toBe(true);
    expect(toolHandlers.has("ant_terminal_resize")).toBe(true);
    expect(toolHandlers.has("ant_read_terminal_output")).toBe(true);
  });

  describe("ant_list_sessions", () => {
    it("calls GET /api/sessions and returns result", async () => {
      mockJsonResponse([{ id: "s1", name: "Test" }]);
      const handler = toolHandlers.get("ant_list_sessions")!;
      const result = await handler({});
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/sessions"),
        expect.any(Object)
      );
      expect(result.content[0].text).toContain("s1");
    });
  });

  describe("ant_create_session", () => {
    it("calls POST /api/sessions with correct body", async () => {
      mockJsonResponse({ id: "new1", type: "terminal" });
      const handler = toolHandlers.get("ant_create_session")!;
      const result = await handler({ type: "terminal", name: "My Term" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/sessions"),
        expect.objectContaining({ method: "POST" })
      );
      expect(result.content[0].text).toContain("new1");
    });
  });

  describe("ant_read_messages", () => {
    it("calls GET /api/sessions/:id/messages", async () => {
      mockJsonResponse([{ id: "m1", content: "Hello" }]);
      const handler = toolHandlers.get("ant_read_messages")!;
      await handler({ sessionId: "s1" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/sessions/s1/messages"),
        expect.any(Object)
      );
    });

    it("passes since and limit as query params", async () => {
      mockJsonResponse([]);
      const handler = toolHandlers.get("ant_read_messages")!;
      await handler({ sessionId: "s1", since: "2024-01-01", limit: 50 });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("since=2024-01-01");
      expect(url).toContain("limit=50");
    });
  });

  describe("ant_send_message", () => {
    it("calls POST with content and role", async () => {
      mockJsonResponse({ id: "m1", content: "Hello", role: "human" });
      const handler = toolHandlers.get("ant_send_message")!;
      await handler({
        sessionId: "s1",
        content: "Hello",
        role: "human",
        format: "markdown",
      });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/sessions/s1/messages");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toMatchObject({
        role: "human",
        content: "Hello",
      });
    });
  });

  describe("ant_stream_message", () => {
    it("creates a streaming message", async () => {
      mockJsonResponse({ id: "m2", status: "streaming" });
      const handler = toolHandlers.get("ant_stream_message")!;
      const result = await handler({
        sessionId: "s1",
        role: "agent",
        format: "markdown",
      });
      expect(result.content[0].text).toContain("m2");
    });
  });

  describe("ant_complete_stream", () => {
    it("calls PATCH with content and status", async () => {
      mockJsonResponse({ id: "m2", status: "complete", content: "Done" });
      const handler = toolHandlers.get("ant_complete_stream")!;
      await handler({ sessionId: "s1", messageId: "m2", content: "Done" });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/sessions/s1/messages/m2");
      expect(opts.method).toBe("PATCH");
    });
  });

  describe("ant_terminal_input", () => {
    it("sends terminal input", async () => {
      mockJsonResponse({ accepted: true, cursor: 5 });
      const handler = toolHandlers.get("ant_terminal_input")!;
      const result = await handler({ sessionId: "t1", data: "ls\n" });
      expect(result.content[0].text).toContain("accepted");
    });

    it("returns structured error on API failure", async () => {
      mockErrorResponse({ error: "Terminal input failed" }, 503);
      const handler = toolHandlers.get("ant_terminal_input")!;
      const result = await handler({ sessionId: "t1", data: "ls\n" });
      expect(result.content[0].text).toContain("503");
    });
  });

  describe("ant_terminal_resize", () => {
    it("sends resize request", async () => {
      mockJsonResponse({ cols: 80, rows: 24 });
      const handler = toolHandlers.get("ant_terminal_resize")!;
      const result = await handler({ sessionId: "t1", cols: 80, rows: 24 });
      expect(result.content[0].text).toContain("80");
    });

    it("returns structured error on failure", async () => {
      mockErrorResponse({ error: "Not a terminal" }, 409);
      const handler = toolHandlers.get("ant_terminal_resize")!;
      const result = await handler({ sessionId: "c1", cols: 80, rows: 24 });
      expect(result.content[0].text).toContain("409");
    });
  });

  describe("ant_read_terminal_output", () => {
    it("reads terminal output", async () => {
      mockJsonResponse({ events: [{ index: 0, data: "hello" }], cursor: 1 });
      const handler = toolHandlers.get("ant_read_terminal_output")!;
      const result = await handler({ sessionId: "t1" });
      expect(result.content[0].text).toContain("hello");
    });

    it("passes since and limit as query params", async () => {
      mockJsonResponse({ events: [], cursor: 0 });
      const handler = toolHandlers.get("ant_read_terminal_output")!;
      await handler({ sessionId: "t1", since: 10, limit: 50 });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("since=10");
      expect(url).toContain("limit=50");
    });
  });
});
