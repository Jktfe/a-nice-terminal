import { beforeEach } from "vitest";
import db from "../db.js";

beforeEach(() => {
  db.exec("DELETE FROM messages");
  db.exec("DELETE FROM resume_commands");
  db.exec("DELETE FROM terminal_output_events");
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM workspaces");
  db.exec("DELETE FROM server_state");
});

export { db as testDb };
