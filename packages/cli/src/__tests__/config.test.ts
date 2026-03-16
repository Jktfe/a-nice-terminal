import { describe, it, expect, afterEach } from "vitest";
import { resolveConfig } from "../config.js";

describe("resolveConfig", () => {
  afterEach(() => {
    delete process.env.ANT_URL;
    delete process.env.ANT_API_KEY;
    delete process.env.ANT_PORT;
  });

  it("uses defaults when no config is provided", () => {
    const config = resolveConfig({});
    expect(config.server).toBe("http://localhost:6458");
    expect(config.apiKey).toBeUndefined();
  });

  it("prefers env vars over defaults", () => {
    process.env.ANT_URL = "http://10.0.0.1:3000";
    process.env.ANT_API_KEY = "secret";
    const config = resolveConfig({});
    expect(config.server).toBe("http://10.0.0.1:3000");
    expect(config.apiKey).toBe("secret");
  });

  it("prefers CLI flags over env vars", () => {
    process.env.ANT_URL = "http://10.0.0.1:3000";
    const config = resolveConfig({ server: "http://flag.local:8080" });
    expect(config.server).toBe("http://flag.local:8080");
  });

  it("sets format to json when flag is set", () => {
    const config = resolveConfig({ json: true });
    expect(config.format).toBe("json");
  });
});
