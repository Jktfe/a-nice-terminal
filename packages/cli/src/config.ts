import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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
  return { server, apiKey, format };
}
