import { describe, it, expect, beforeEach, vi } from "vitest";
import { isAllowedHost } from "./localhost.js";

function setEnv(env: Record<string, string | undefined>) {
  for (const [key, val] of Object.entries(env)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

describe("isAllowedHost", () => {
  beforeEach(() => {
    delete process.env.ANT_TAILSCALE_ONLY;
    delete process.env.ANT_ALLOW_LOOPBACK;
    delete process.env.ANT_ALLOWLIST;
  });

  describe("when ANT_TAILSCALE_ONLY=false (open mode)", () => {
    beforeEach(() => {
      setEnv({ ANT_TAILSCALE_ONLY: "false" });
    });

    it("allows any IP", () => {
      expect(isAllowedHost("8.8.8.8")).toBe(true);
    });

    it("allows loopback", () => {
      expect(isAllowedHost("127.0.0.1")).toBe(true);
    });

    it("allows empty string", () => {
      expect(isAllowedHost("")).toBe(true);
    });
  });

  describe("default (Tailscale-only mode)", () => {
    it("allows Tailscale IP 100.64.0.1", () => {
      expect(isAllowedHost("100.64.0.1")).toBe(true);
    });

    it("allows Tailscale IP 100.100.100.100", () => {
      expect(isAllowedHost("100.100.100.100")).toBe(true);
    });

    it("allows Tailscale IP 100.127.255.255 (top of /10)", () => {
      expect(isAllowedHost("100.127.255.255")).toBe(true);
    });

    it("rejects 100.128.0.0 (just outside /10)", () => {
      expect(isAllowedHost("100.128.0.0")).toBe(false);
    });

    it("rejects 100.63.255.255 (just below /10)", () => {
      expect(isAllowedHost("100.63.255.255")).toBe(false);
    });

    it("rejects public IPs", () => {
      expect(isAllowedHost("8.8.8.8")).toBe(false);
    });

    it("rejects private RFC1918 by default", () => {
      expect(isAllowedHost("192.168.1.1")).toBe(false);
    });

    it("rejects loopback when ANT_ALLOW_LOOPBACK is not set", () => {
      expect(isAllowedHost("127.0.0.1")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isAllowedHost("")).toBe(false);
    });
  });

  describe("loopback handling", () => {
    beforeEach(() => {
      setEnv({ ANT_ALLOW_LOOPBACK: "true" });
    });

    it("allows 127.0.0.1 when loopback enabled", () => {
      expect(isAllowedHost("127.0.0.1")).toBe(true);
    });

    it("allows ::1 when loopback enabled", () => {
      expect(isAllowedHost("::1")).toBe(true);
    });

    it("allows IPv4-mapped ::ffff:127.0.0.1 when loopback enabled", () => {
      expect(isAllowedHost("::ffff:127.0.0.1")).toBe(true);
    });

    it("still rejects random IPs even with loopback enabled", () => {
      expect(isAllowedHost("8.8.8.8")).toBe(false);
    });
  });

  describe("custom allowlist (ANT_ALLOWLIST)", () => {
    it("allows IPs in a custom CIDR", () => {
      setEnv({ ANT_ALLOWLIST: "10.0.0.0/8" });
      expect(isAllowedHost("10.0.0.1")).toBe(true);
      expect(isAllowedHost("10.255.255.255")).toBe(true);
    });

    it("rejects IPs outside custom CIDR", () => {
      setEnv({ ANT_ALLOWLIST: "10.0.0.0/8" });
      expect(isAllowedHost("11.0.0.1")).toBe(false);
    });

    it("allows single IP (/32)", () => {
      setEnv({ ANT_ALLOWLIST: "192.168.1.100/32" });
      expect(isAllowedHost("192.168.1.100")).toBe(true);
      expect(isAllowedHost("192.168.1.101")).toBe(false);
    });

    it("handles comma-separated entries", () => {
      setEnv({ ANT_ALLOWLIST: "10.0.0.0/8,172.16.0.0/12" });
      expect(isAllowedHost("10.1.1.1")).toBe(true);
      expect(isAllowedHost("172.16.0.1")).toBe(true);
      expect(isAllowedHost("192.168.1.1")).toBe(false);
    });

    it("ignores invalid CIDR entries gracefully", () => {
      setEnv({ ANT_ALLOWLIST: "not-an-ip,10.0.0.0/8" });
      expect(isAllowedHost("10.0.0.1")).toBe(true);
    });

    it("still allows Tailscale alongside custom allowlist", () => {
      setEnv({ ANT_ALLOWLIST: "10.0.0.0/8" });
      expect(isAllowedHost("100.64.0.1")).toBe(true);
    });
  });

  describe("parseBool edge cases", () => {
    it("treats ANT_TAILSCALE_ONLY=1 as true", () => {
      setEnv({ ANT_TAILSCALE_ONLY: "1" });
      expect(isAllowedHost("8.8.8.8")).toBe(false);
    });

    it("treats ANT_TAILSCALE_ONLY=yes as true", () => {
      setEnv({ ANT_TAILSCALE_ONLY: "yes" });
      expect(isAllowedHost("8.8.8.8")).toBe(false);
    });

    it("treats ANT_TAILSCALE_ONLY=on as true", () => {
      setEnv({ ANT_TAILSCALE_ONLY: "on" });
      expect(isAllowedHost("8.8.8.8")).toBe(false);
    });

    it("treats ANT_TAILSCALE_ONLY=no as false (open)", () => {
      setEnv({ ANT_TAILSCALE_ONLY: "no" });
      expect(isAllowedHost("8.8.8.8")).toBe(true);
    });

    it("treats ANT_TAILSCALE_ONLY=0 as false (open)", () => {
      setEnv({ ANT_TAILSCALE_ONLY: "0" });
      expect(isAllowedHost("8.8.8.8")).toBe(true);
    });
  });
});
