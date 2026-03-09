import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the .env file at the root of the project
const envPath = path.join(__dirname, "..", "..", "..", ".env");

async function readEnv(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(envPath, "utf-8");
    const env: Record<string, string> = {};
    content.split("\n").forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let key = match[1];
        let value = match[2] || "";
        // Remove quotes if present
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'" ) && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        env[key] = value;
      }
    });
    return env;
  } catch (error: any) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeEnv(updates: Record<string, string>): Promise<void> {
  let content = "";
  try {
    content = await fs.readFile(envPath, "utf-8");
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }

  const lines = content.split("\n");
  const newLines: string[] = [];
  const updatedKeys = new Set<string>();

  for (const line of lines) {
    const match = line.match(/^\s*([\w.-]+)\s*=/);
    if (match) {
      const key = match[1];
      if (key in updates) {
        newLines.push(`${key}=${updates[key]}`);
        updatedKeys.add(key);
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  // Prevent multiple trailing newlines
  const finalContent = newLines.join("\n").replace(/\n{2,}$/, "\n") + (newLines.length > 0 && !newLines[newLines.length - 1].endsWith("\n") ? "\n" : "");
  
  await fs.writeFile(envPath, finalContent, "utf-8");
}

router.get("/api/settings", async (req, res) => {
  try {
    const env = await readEnv();
    res.json({
      ANT_PORT: env.ANT_PORT || process.env.ANT_PORT || "3000",
      ANT_ROOT_DIR: env.ANT_ROOT_DIR || process.env.ANT_ROOT_DIR || "",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to read settings" });
  }
});

router.post("/api/settings", async (req, res) => {
  try {
    const { ANT_PORT, ANT_ROOT_DIR } = req.body;
    const updates: Record<string, string> = {};
    
    if (ANT_PORT !== undefined) updates.ANT_PORT = String(ANT_PORT);
    if (ANT_ROOT_DIR !== undefined) updates.ANT_ROOT_DIR = String(ANT_ROOT_DIR);

    await writeEnv(updates);
    
    // Update current process env so it's immediately available without restart for some things
    if (updates.ANT_ROOT_DIR) process.env.ANT_ROOT_DIR = updates.ANT_ROOT_DIR;

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to save settings" });
  }
});

export default router;
