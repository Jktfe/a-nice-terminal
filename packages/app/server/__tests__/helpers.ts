import express from "express";
import healthRoutes from "../routes/health.js";
import sessionRoutes from "../routes/sessions.js";
import messageRoutes from "../routes/messages.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { testDb } from "./setup.js";

export function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(healthRoutes);
  app.use(sessionRoutes);
  app.use(messageRoutes);
  return app;
}

export function createTestAppWithAuth(apiKey: string) {
  process.env.ANT_API_KEY = apiKey;
  const app = express();
  app.use(apiKeyAuth);
  app.use(express.json());
  app.use(healthRoutes);
  app.use(sessionRoutes);
  app.use(messageRoutes);
  return app;
}

export function seedSession(overrides: Partial<{
  id: string;
  name: string;
  type: string;
  shell: string | null;
}> = {}) {
  const id = overrides.id ?? "test-session";
  const name = overrides.name ?? "Test Session";
  const type = overrides.type ?? "conversation";
  const shell = overrides.shell ?? null;

  testDb
    .prepare("INSERT INTO sessions (id, name, type, shell) VALUES (?, ?, ?, ?)")
    .run(id, name, type, shell);

  return { id, name, type, shell };
}

export function seedMessage(overrides: Partial<{
  id: string;
  session_id: string;
  role: string;
  content: string;
  format: string;
  status: string;
}> = {}) {
  const id = overrides.id ?? "test-msg";
  const session_id = overrides.session_id ?? "test-session";
  const role = overrides.role ?? "human";
  const content = overrides.content ?? "Hello";
  const format = overrides.format ?? "markdown";
  const status = overrides.status ?? "complete";

  testDb
    .prepare(
      "INSERT INTO messages (id, session_id, role, content, format, status) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, session_id, role, content, format, status);

  return { id, session_id, role, content, format, status };
}
