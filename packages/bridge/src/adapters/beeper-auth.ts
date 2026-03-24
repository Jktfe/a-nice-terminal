/**
 * Beeper OAuth2 PKCE Authentication
 *
 * Handles the full OAuth2 Authorization Code flow with PKCE against
 * Beeper Desktop's local server. Tokens are cached and auto-refreshed.
 *
 * Flow:
 * 1. First connect → open browser for consent (one-time)
 * 2. Receive callback with auth code
 * 3. Exchange code for access + refresh tokens
 * 4. Cache tokens, auto-refresh on expiry
 */
import { createServer, type Server } from "http";
import { URL } from "url";
import crypto from "crypto";

export interface BeeperTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // Unix timestamp ms
}

export interface BeeperAuthConfig {
  beeperUrl: string;
  /** Read cached tokens */
  loadTokens: () => Promise<BeeperTokens | null>;
  /** Persist tokens */
  saveTokens: (tokens: BeeperTokens) => Promise<void>;
  /** Clear cached tokens */
  clearTokens: () => Promise<void>;
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

export class BeeperAuth {
  private config: BeeperAuthConfig;
  private tokens: BeeperTokens | null = null;
  private clientId: string | null = null;

  constructor(config: BeeperAuthConfig) {
    this.config = config;
  }

  /**
   * Get a valid access token. Loads from cache, refreshes if expired,
   * or initiates OAuth flow if no tokens exist.
   */
  async getAccessToken(): Promise<string> {
    // Try cached tokens
    if (!this.tokens) {
      this.tokens = await this.config.loadTokens();
    }

    if (this.tokens) {
      // Check expiry (with 60s buffer)
      if (this.tokens.expiresAt > Date.now() + 60000) {
        return this.tokens.accessToken;
      }

      // Try refresh
      if (this.tokens.refreshToken) {
        try {
          await this.refreshTokens();
          return this.tokens!.accessToken;
        } catch (err) {
          console.warn("[beeper-auth] Token refresh failed, re-authenticating:", err instanceof Error ? err.message : err);
        }
      }
    }

    // No valid tokens — run OAuth flow
    await this.authenticate();
    return this.tokens!.accessToken;
  }

  /**
   * Run the full OAuth PKCE flow. Opens browser for user consent.
   */
  async authenticate(): Promise<void> {
    // Register client dynamically
    await this.registerClient();

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Start temporary callback server
    const { code, redirectUri } = await this.waitForCallback(codeChallenge);

    // Exchange code for tokens
    const tokenRes = await fetch(`${this.config.beeperUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.clientId!,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${text.slice(0, 200)}`);
    }

    const data = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: Date.now() + ((data.expires_in || 3600) * 1000),
    };

    await this.config.saveTokens(this.tokens);
    console.log("[beeper-auth] Authentication successful — tokens cached");
  }

  /**
   * Register a dynamic OAuth client with Beeper.
   */
  private async registerClient(): Promise<void> {
    if (this.clientId) return;

    try {
      const res = await fetch(`${this.config.beeperUrl}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "ANT — A Nice Terminal",
          redirect_uris: ["http://localhost:0/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });

      if (res.ok) {
        const data = await res.json() as { client_id: string };
        this.clientId = data.client_id;
        return;
      }
    } catch {
      // Dynamic registration may not be supported — use a default client ID
    }

    this.clientId = "ant-terminal";
  }

  /**
   * Start a temporary HTTP server, open browser for OAuth consent,
   * and wait for the callback with the auth code.
   */
  private waitForCallback(codeChallenge: string): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let server: Server;
      const timeout = setTimeout(() => {
        server?.close();
        reject(new Error("OAuth callback timeout (60s)"));
      }, 60000);

      server = createServer((req, res) => {
        const url = new URL(req.url || "/", `http://localhost`);

        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`<h2>ANT</h2><p>Authentication failed: ${error}</p><script>setTimeout(()=>window.close(),2000)</script>`);
            clearTimeout(timeout);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (code) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`<h2>ANT</h2><p>Authenticated with Beeper! You can close this tab.</p><script>setTimeout(()=>window.close(),2000)</script>`);
            clearTimeout(timeout);
            const addr = server.address() as { port: number };
            const redirectUri = `http://localhost:${addr.port}/callback`;
            server.close();
            resolve({ code, redirectUri });
            return;
          }
        }

        res.writeHead(404);
        res.end();
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        const redirectUri = `http://localhost:${addr.port}/callback`;

        const authUrl = new URL(`${this.config.beeperUrl}/oauth/authorize`);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("client_id", this.clientId!);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("scope", "read write");
        authUrl.searchParams.set("code_challenge", codeChallenge);
        authUrl.searchParams.set("code_challenge_method", "S256");

        console.log(`[beeper-auth] Opening browser for Beeper authentication...`);
        console.log(`[beeper-auth] If browser doesn't open, visit: ${authUrl.toString()}`);

        // Open browser
        import("child_process").then(({ exec: cpExec }) => {
          const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
          cpExec(`${cmd} "${authUrl.toString()}"`);
        }).catch(() => {
          // Can't open browser — user will use the logged URL
        });
      });
    });
  }

  /**
   * Refresh the access token using the cached refresh token.
   */
  private async refreshTokens(): Promise<void> {
    if (!this.tokens?.refreshToken) throw new Error("No refresh token");

    const res = await fetch(`${this.config.beeperUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.clientId || "ant-terminal",
        refresh_token: this.tokens.refreshToken,
      }),
    });

    if (!res.ok) {
      await this.config.clearTokens();
      this.tokens = null;
      throw new Error(`Refresh failed: ${res.status}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.tokens.refreshToken,
      expiresAt: Date.now() + ((data.expires_in || 3600) * 1000),
    };

    await this.config.saveTokens(this.tokens);
  }

  /**
   * Make an authenticated fetch request to Beeper.
   */
  async fetch(path: string, options?: RequestInit): Promise<Response> {
    const token = await this.getAccessToken();
    return fetch(`${this.config.beeperUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options?.headers as Record<string, string>,
      },
    });
  }
}
