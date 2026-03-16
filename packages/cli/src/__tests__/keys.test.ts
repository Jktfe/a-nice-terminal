import { describe, it, expect } from "vitest";
import { parseKey, parseSequence } from "../keys.js";

describe("parseKey", () => {
  it("maps named keys to escape sequences", () => {
    expect(parseKey("enter")).toBe("\r");
    expect(parseKey("tab")).toBe("\t");
    expect(parseKey("up")).toBe("\x1b[A");
    expect(parseKey("ctrl+c")).toBe("\x03");
  });
  it("throws on unknown key", () => {
    expect(() => parseKey("unknown")).toThrow(/Unknown key/);
  });
});

describe("parseSequence", () => {
  it("parses comma-separated keys", () => {
    const result = parseSequence("down,enter");
    expect(result).toEqual([
      { type: "key", data: "\x1b[B" },
      { type: "key", data: "\r" },
    ]);
  });
  it("handles repeat shorthand", () => {
    const result = parseSequence("down:3,enter");
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ type: "key", data: "\x1b[B" });
    expect(result[3]).toEqual({ type: "key", data: "\r" });
  });
  it("handles wait delays", () => {
    const result = parseSequence("down,wait:500,enter");
    expect(result[1]).toEqual({ type: "wait", ms: 500 });
  });
});
