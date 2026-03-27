import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// Pure logic functions extracted from terminal-monitor — import them directly
import {
  detectPrompt,
  buildPromptId,
  extractToolType,
  extractDetail,
} from "../terminal-monitor.js";

describe("detectPrompt", () => {
  it("returns true for 'Do you want to proceed'", () => {
    const lines = ["Do you want to proceed?", "❯ Yes", "  No"];
    expect(detectPrompt(lines)).toBe(true);
  });

  it("returns true for Allow + Yes selector", () => {
    const lines = ["Allow bash command?", "❯ Yes, allow", "  No, deny"];
    expect(detectPrompt(lines)).toBe(true);
  });

  it("returns true for 'Allow this action'", () => {
    const lines = ["Allow this action?", "❯ Yes"];
    expect(detectPrompt(lines)).toBe(true);
  });

  it("returns false for normal shell output", () => {
    const lines = ["$ npm test", "  Running tests...", "  PASS"];
    expect(detectPrompt(lines)).toBe(false);
  });

  it("returns false for empty screen", () => {
    expect(detectPrompt([])).toBe(false);
  });
});

describe("extractToolType", () => {
  it("extracts Bash", () => {
    const lines = ["Allow bash command?", "Command: rm -rf /tmp/test"];
    expect(extractToolType(lines)).toBe("Bash");
  });

  it("extracts Edit", () => {
    const lines = ["Allow Edit?", "File: src/index.ts"];
    expect(extractToolType(lines)).toBe("Edit");
  });

  it("defaults to Unknown", () => {
    const lines = ["Do you want to proceed?"];
    expect(extractToolType(lines)).toBe("Unknown");
  });
});

describe("extractDetail", () => {
  it("returns the line after the tool type line", () => {
    const lines = ["Allow bash command?", "rm -rf /tmp/build", "❯ Yes"];
    expect(extractDetail(lines, "Bash")).toBe("rm -rf /tmp/build");
  });

  it("truncates to 200 chars", () => {
    const long = "x".repeat(300);
    const lines = ["Allow bash command?", long];
    expect(extractDetail(lines, "Bash").length).toBeLessThanOrEqual(200);
  });

  it("returns empty string when no detail found", () => {
    const lines = ["Do you want to proceed?"];
    expect(extractDetail(lines, "Unknown")).toBe("");
  });
});

describe("buildPromptId", () => {
  it("returns a 12-char hex string", () => {
    const id = buildPromptId("sess1", "Bash", "rm -rf");
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic", () => {
    const a = buildPromptId("s", "Bash", "cmd");
    const b = buildPromptId("s", "Bash", "cmd");
    expect(a).toBe(b);
  });

  it("differs for different inputs", () => {
    expect(buildPromptId("s", "Bash", "cmd1")).not.toBe(buildPromptId("s", "Bash", "cmd2"));
  });
});
