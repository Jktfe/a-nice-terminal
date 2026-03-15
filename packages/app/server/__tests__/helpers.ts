import express from "express";
import healthRoutes from "../routes/health.js";
import sessionRoutes from "../routes/sessions.js";
import messageRoutes from "../routes/messages.js";
import workspaceRoutes from "../routes/workspaces.js";
import annotationRoutes from "../routes/annotations.js";
import { apiKeyAuth } from "../middleware/auth.js";
import db from "../db.js";
const testDb = db;

export function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(healthRoutes);
  app.use(sessionRoutes);
  app.use(messageRoutes);
  app.use(workspaceRoutes);
  app.use(annotationRoutes);
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
  app.use(workspaceRoutes);
  app.use(annotationRoutes);
  return app;
}

export function seedSession(overrides: Partial<{
  id: string;
  name: string;
  type: string;
  shell: string | null;
  workspace_id: string | null;
  archived: number;
}> = {}) {
  const id = overrides.id ?? "test-session";
  const name = overrides.name ?? "Test Session";
  const type = overrides.type ?? "conversation";
  const shell = overrides.shell ?? null;
  const workspace_id = overrides.workspace_id ?? null;
  const archived = overrides.archived ?? 0;

  testDb
    .prepare("INSERT OR REPLACE INTO sessions (id, name, type, shell, workspace_id, archived) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, name, type, shell, workspace_id, archived);

  return { id, name, type, shell, workspace_id, archived };
}

export function seedWorkspace(overrides: Partial<{
  id: string;
  name: string;
}> = {}) {
  const id = overrides.id ?? "test-workspace";
  const name = overrides.name ?? "Test Workspace";

  testDb
    .prepare("INSERT OR REPLACE INTO workspaces (id, name) VALUES (?, ?)")
    .run(id, name);

  return { id, name };
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
      "INSERT OR REPLACE INTO messages (id, session_id, role, content, format, status) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, session_id, role, content, format, status);

  return { id, session_id, role, content, format, status };
}
