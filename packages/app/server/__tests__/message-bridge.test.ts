import { describe, it, expect, vi } from "vitest";
import {
  extractMentions,
  shouldInject,
} from "../message-bridge.js";

describe("extractMentions", () => {
  it("extracts @handles from message content", () => {
    expect(extractMentions("Hey @ANTClaude fix this")).toEqual(["@ANTClaude"]);
  });

  it("extracts multiple handles", () => {
    expect(extractMentions("@ANTClaude and @ANTGem both look at this")).toEqual([
      "@ANTClaude",
      "@ANTGem",
    ]);
  });

  it("returns empty array for no mentions", () => {
    expect(extractMentions("just a plain message")).toEqual([]);
  });

  it("is case-insensitive on the @ prefix", () => {
    expect(extractMentions("hi @antclaude")).toEqual(["@antclaude"]);
  });
});

describe("shouldInject", () => {
  it("returns true when terminal cursor has not advanced", () => {
    expect(shouldInject(5, 5)).toBe(true);
  });

  it("returns false when terminal cursor has advanced (agent received it)", () => {
    expect(shouldInject(5, 10)).toBe(false);
  });
});
