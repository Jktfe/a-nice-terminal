import { describe, it, expect } from "vitest";
import db from "./db.js";

describe("message schema migrations", () => {
  it("messages table has sender_type column", () => {
    const info = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    const columns = info.map((c) => c.name);
    expect(columns).toContain("sender_type");
    expect(columns).toContain("sender_name");
    expect(columns).toContain("sender_cwd");
    expect(columns).toContain("sender_persona");
    expect(columns).toContain("thread_id");
    expect(columns).toContain("annotations");
    expect(columns).toContain("starred");
  });

  it("thread index exists", () => {
    const indices = db.prepare("PRAGMA index_list(messages)").all() as { name: string }[];
    const names = indices.map((i) => i.name);
    expect(names).toContain("idx_messages_thread");
  });

  it("existing messages get sender_type from role", () => {
    const sessionId = "test-migration-" + Date.now();
    db.prepare("INSERT INTO sessions (id, name, type) VALUES (?, ?, ?)").run(sessionId, "Test", "conversation");
    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)").run("msg-test-1-" + Date.now(), sessionId, "human", "hello");

    db.prepare("UPDATE messages SET sender_type = 'human' WHERE sender_type IS NULL AND role = 'human'").run();

    const msg = db.prepare("SELECT sender_type FROM messages WHERE session_id = ? AND role = 'human'").get(sessionId) as { sender_type: string };
    expect(msg.sender_type).toBe("human");

    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  });
});
