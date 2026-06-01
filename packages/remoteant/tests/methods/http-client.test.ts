import { afterEach, describe, expect, it, vi } from "vitest";
import { antApiFetch, HttpError } from "../../src/methods/http-client.ts";
import { installFetchMock, restoreFetch } from "./fetch-mock.ts";

describe("method HTTP client", () => {
  afterEach(() => {
    restoreFetch();
  });

  it("sends bearer and as-handle headers to the ANT daemon", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    installFetchMock(fetchMock as unknown as typeof fetch);

    await antApiFetch("/api/health", {
      method: "GET",
      env: {
        ANT_SERVER_URL: "http://127.0.0.1:6174",
        ANT_ADMIN_TOKEN: "admin-token",
        ANT_AS_HANDLE: "@codex",
      },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:6174/api/health");
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer admin-token");
    expect(headers.get("x-ant-as-handle")).toBe("@codex");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("throws HttpError for non-2xx upstream responses", async () => {
    installFetchMock(vi.fn(async () => new Response("nope", { status: 403 })) as unknown as typeof fetch);

    await expect(antApiFetch("/api/health", {
      method: "GET",
      env: { ANT_SERVER_URL: "http://127.0.0.1:6174" },
    })).rejects.toMatchObject({ statusCode: 403, body: "nope" } satisfies Partial<HttpError>);
  });
});
