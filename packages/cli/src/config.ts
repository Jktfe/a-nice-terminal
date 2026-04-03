import { readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { Agent, setGlobalDispatcher } from "undici";

export interface Config {
  server: string;
  apiKey?: string;
  format: "human" | "json";
}

interface FileConfig {
  server?: string;
  apiKey?: string;
  defaultFormat?: "human" | "json";
}

// Load the monorepo root .env file so ANT_URL, ANT_API_KEY etc. are available
// without requiring the user to source it in their shell.
// Priority: shell env > .env file > defaults
function loadDotEnv(): void {
  const __dir = dirname(fileURLToPath(import.meta.url));
  // packages/cli/src/ → root is 3 levels up (cli → packages → root)
  const envPath = resolve(__dir, "../../../.env");
  if (!existsSync(envPath)) return;
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      // Never overwrite an existing shell export
      if (key in process.env) continue;
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch { /* ignore unreadable .env */ }
}

loadDotEnv();

function loadConfigFile(): FileConfig {
  try {
    const path = join(homedir(), ".config", "ant", "config.json");
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

export function resolveConfig(flags: {
  server?: string;
  apiKey?: string;
  json?: boolean;
}): Config {
  const file = loadConfigFile();
  const server = flags.server || process.env.ANT_URL || file.server || `http://localhost:${process.env.ANT_PORT || "6458"}`;
  const apiKey = flags.apiKey || process.env.ANT_API_KEY || file.apiKey || undefined;
  const format: "human" | "json" = flags.json ? "json" : (file.defaultFormat || "human");

  // Self-signed certs on localhost: configure undici (Node's fetch backend) to
  // skip cert verification. Scoped to local addresses only — no env var side-effects.
  if (server.startsWith("https://localhost") || server.startsWith("https://127.0.0.1")) {
    setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));
  }

  return { server, apiKey, format };
}
