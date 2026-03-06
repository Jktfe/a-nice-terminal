import { describe, it, expect } from "vitest";
import { testDb } from "./__tests__/setup.js";

describe("database schema", () => {
  it("creates sessions table with correct columns", () => {
    const info = testDb.pragma("table_info(sessions)") as any[];
    const colNames = info.map((c: any) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("name");
    expect(colNames).toContain("type");
    expect(colNames).toContain("shell");
    expect(colNames).toContain("created_at");
    expect(colNames).toContain("updated_at");
  });

  it("creates messages table with correct columns", () => {
    const info = testDb.pragma("table_info(messages)") as any[];
    const colNames = info.map((c: any) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("session_id");
    expect(colNames).toContain("role");
    expect(colNames).toContain("content");
    expect(colNames).toContain("format");
    expect(colNames).toContain("status");
    expect(colNames).toContain("created_at");
  });

  it("enforces session type CHECK constraint", () => {
    expect(() => {
      testDb
        .prepare("INSERT INTO sessions (id, name, type) VALUES (?, ?, ?)")
        .run("bad", "Bad", "invalid_type");
    }).toThrow();
  });

  it("enforces message role CHECK constraint", () => {
    testDb
      .prepare("INSERT INTO sessions (id, name, type) VALUES (?, ?, ?)")
      .run("s1", "S1", "conversation");

    expect(() => {
      testDb
        .prepare(
          "INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)"
        )
        .run("m1", "s1", "invalid_role", "hello");
    }).toThrow();
  });

  it("enforces message status CHECK constraint", () => {
    testDb
      .prepare("INSERT INTO sessions (id, name, type) VALUES (?, ?, ?)")
      .run("s2", "S2", "conversation");

    expect(() => {
      testDb
        .prepare(
          "INSERT INTO messages (id, session_id, role, content, status) VALUES (?, ?, ?, ?, ?)"
        )
        .run("m2", "s2", "human", "hello", "bad_status");
    }).toThrow();
  });

  it("cascades deletes from sessions to messages", () => {
    testDb
      .prepare("INSERT INTO sessions (id, name, type) VALUES (?, ?, ?)")
      .run("s3", "S3", "conversation");
    testDb
      .prepare(
        "INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)"
      )
      .run("m3", "s3", "human", "hi");

    const before = testDb
      .prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?")
      .get("s3") as any;
    expect(before.count).toBe(1);

    testDb.prepare("DELETE FROM sessions WHERE id = ?").run("s3");

    const after = testDb
      .prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?")
      .get("s3") as any;
    expect(after.count).toBe(0);
  });

  it("enforces foreign key constraint on messages", () => {
    expect(() => {
      testDb
        .prepare(
          "INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)"
        )
        .run("m4", "nonexistent", "human", "hello");
    }).toThrow();
  });
});
