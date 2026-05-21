/**
 * Thin HTTP client around the local ANT OSS daemon.
 *
 * Defaults to `http://127.0.0.1:6174` (matches the SvelteKit dev server +
 * the LaunchAgent `com.ant.fresh` plist on Mac). Override via the
 * `ANT_SERVER_URL` environment variable.
 *
 * Authentication is opportunistic: if `ANT_DEVICE_TOKEN` is set in the
 * environment we send it as a Bearer token. The token is the device-scoped
 * bearer minted by `ant identity` (see the Mac antchat agent-bridge wiring).
 * If unset the client still works against any endpoint that resolves
 * identity from cookies or the operator pidChain — the MCP server reports
 * the resulting error verbatim so users can debug auth issues.
 *
 * Designed to be idle when nobody is calling it. No timers, no background
 * sockets — just `fetch()` calls driven by MCP tool invocations.
 */

export type AntClientOptions = {
  /** Override for the ANT base URL. Defaults to ANT_SERVER_URL env or 127.0.0.1:6174. */
  baseUrl?: string;
  /** Override for the device bearer token. Defaults to ANT_DEVICE_TOKEN env. */
  deviceToken?: string;
  /** Optional fetch impl override (used by tests). */
  fetchImpl?: typeof fetch;
};

export class AntClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly bodyText: string
  ) {
    super(message);
    this.name = 'AntClientError';
  }
}

export class AntClient {
  private readonly baseUrl: string;
  private readonly deviceToken: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AntClientOptions = {}) {
    const envBase = process.env.ANT_SERVER_URL?.trim();
    const candidate = options.baseUrl ?? (envBase && envBase.length > 0 ? envBase : 'http://127.0.0.1:6174');
    // Trim trailing slash so request() can concatenate naively.
    this.baseUrl = candidate.replace(/\/+$/, '');
    const envToken = process.env.ANT_DEVICE_TOKEN?.trim();
    this.deviceToken = options.deviceToken ?? (envToken && envToken.length > 0 ? envToken : undefined);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** Construct an absolute URL for a path that starts with `/`. */
  url(path: string): string {
    if (!path.startsWith('/')) throw new Error(`AntClient.url: path must start with '/'; got: ${path}`);
    return `${this.baseUrl}${path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const base: Record<string, string> = {
      accept: 'application/json'
    };
    if (this.deviceToken) base.authorization = `Bearer ${this.deviceToken}`;
    return { ...base, ...(extra ?? {}) };
  }

  /**
   * Perform a JSON GET against the ANT server. On non-2xx, throws
   * AntClientError with the original status + body so MCP tool handlers
   * can surface the failure to the caller.
   */
  async getJson<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
    const response = await this.fetchImpl(this.url(path), {
      method: 'GET',
      headers: this.headers(),
      ...(init?.signal && { signal: init.signal })
    });
    return this.readJsonOrThrow<T>(response);
  }

  /** Perform a JSON POST against the ANT server. Body is JSON-serialised. */
  async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(this.url(path), {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body ?? {})
    });
    return this.readJsonOrThrow<T>(response);
  }

  private async readJsonOrThrow<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AntClientError(
        `ANT request failed: ${response.status} ${response.statusText}`,
        response.status,
        text
      );
    }
    // Empty body is legal for some routes; default to {} so callers can
    // destructure without a runtime crash.
    const text = await response.text();
    if (text.length === 0) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new AntClientError(
        `ANT returned non-JSON body (status ${response.status})`,
        response.status,
        text
      );
    }
  }
}
