import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isIdleOnTask,
  needsStartNudge,
  needsSilentNudge,
} from "../task-watchdog.js";

const FIVE_MIN = 5 * 60 * 1000;
const THREE_MIN = 3 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

describe("isIdleOnTask", () => {
  it("returns true when cursor unchanged for over idle threshold", () => {
    const assignedAt = new Date(Date.now() - FIVE_MIN - 1000);
    expect(isIdleOnTask(10, 10, assignedAt, FIVE_MIN)).toBe(true);
  });

  it("returns false when cursor has advanced", () => {
    const assignedAt = new Date(Date.now() - FIVE_MIN - 1000);
    expect(isIdleOnTask(10, 15, assignedAt, FIVE_MIN)).toBe(false);
  });

  it("returns false when not enough time has passed", () => {
    const assignedAt = new Date(Date.now() - 1000); // just 1 second ago
    expect(isIdleOnTask(10, 10, assignedAt, FIVE_MIN)).toBe(false);
  });
});

describe("needsStartNudge", () => {
  it("returns true for todo task assigned more than threshold ago", () => {
    const assignedAt = new Date(Date.now() - THREE_MIN - 1000);
    expect(needsStartNudge("todo", assignedAt, THREE_MIN)).toBe(true);
  });

  it("returns false for in_progress task", () => {
    const assignedAt = new Date(Date.now() - THREE_MIN - 1000);
    expect(needsStartNudge("in_progress", assignedAt, THREE_MIN)).toBe(false);
  });

  it("returns false if assigned recently", () => {
    const assignedAt = new Date(Date.now() - 1000);
    expect(needsStartNudge("todo", assignedAt, THREE_MIN)).toBe(false);
  });
});

describe("needsSilentNudge", () => {
  it("returns true when terminal active but no chat update in threshold", () => {
    const lastChatAt = new Date(Date.now() - FIFTEEN_MIN - 1000);
    expect(needsSilentNudge(10, 20, lastChatAt, FIFTEEN_MIN)).toBe(true);
  });

  it("returns false when terminal has not advanced (agent is idle)", () => {
    const lastChatAt = new Date(Date.now() - FIFTEEN_MIN - 1000);
    expect(needsSilentNudge(10, 10, lastChatAt, FIFTEEN_MIN)).toBe(false);
  });

  it("returns false when agent posted recently", () => {
    const lastChatAt = new Date(Date.now() - 1000);
    expect(needsSilentNudge(10, 20, lastChatAt, FIFTEEN_MIN)).toBe(false);
  });
});
