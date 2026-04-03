import net from "node:net";

// Inline minimal Express-compatible types — express is not a direct daemon dependency.
interface Request {
  ip?: string;
  socket?: { remoteAddress?: string };
}
interface Response {
  status(code: number): this;
  json(body: unknown): this;
}
type NextFunction = () => void;

interface ParsedCidr {
  family: 4 | 6;
  network: number | number[];
  prefix: number;
}

const TAILSCALE_CIDRS = ["100.64.0.0/10"];

function parseBool(value: string | undefined, defaultValue: boolean) {
  if (!value) return defaultValue;
  return ["1", "true", "yes", "on", "y"].includes(value.toLowerCase());
}

function parseIPv4(ip: string): number | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return nums.reduce((acc, value) => (acc << 8) | value, 0) >>> 0;
}

function parseIPv4Parts(part: string): number[] | null {
  const nums = part.split(".").map(Number);
  if (
    nums.length !== 4 ||
    nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)
  ) {
    return null;
  }

  return [
    ((nums[0] << 8) | nums[1]) & 0xffff,
    ((nums[2] << 8) | nums[3]) & 0xffff,
  ];
}

function parseIPv6Segment(part: string, allowIpv4: boolean): number[] | null {
  if (part.includes(".")) {
    if (!allowIpv4) return null;
    return parseIPv4Parts(part);
  }

  if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
  const value = Number.parseInt(part, 16);
  if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
  return [value];
}

function parseIPv6(ip: string): number[] | null {
  const normalised = ip.toLowerCase().trim();
  if (net.isIP(normalised) !== 6) return null;

  const segments = normalised.split("::");
  if (segments.length > 2) return null;
  const hasCompression = normalised.includes("::");

  const leftRaw = segments[0] || "";
  const rightRaw = segments[1] || "";
  const leftParts = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const rightParts = hasCompression && rightRaw ? rightRaw.split(":").filter(Boolean) : [];

  const parseSide = (parts: string[], allowIpv4: boolean): number[] | null => {
    const words: number[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      const segment = parts[i];
      const isIpv4 = segment.includes(".");
      if (isIpv4 && i !== parts.length - 1) return null;

      const parsed = parseIPv6Segment(segment, allowIpv4);
      if (!parsed) return null;
      words.push(...parsed);
    }
    return words;
  };

  const leftWords = parseSide(leftParts, true);
  if (!leftWords) return null;

  const rightWords = hasCompression
    ? parseSide(rightParts, true)
    : [] as number[];
  if (rightWords === null) return null;

  if (!hasCompression) {
    return leftWords.length === 8 ? leftWords : null;
  }

  const missing = 8 - leftWords.length - rightWords.length;
  if (missing < 0) return null;
  return [...leftWords, ...Array(missing).fill(0), ...rightWords];
}

function isIPv4InCidr(ip: string, cidr: ParsedCidr): boolean {
  if (cidr.family !== 4) return false;
  const address = parseIPv4(ip);
  if (address === null || typeof cidr.network !== "number") return false;
  const prefix = Math.max(0, Math.min(32, cidr.prefix));
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (cidr.network & mask);
}

function isIPv6InCidr(ip: string, cidr: ParsedCidr): boolean {
  if (cidr.family !== 6) return false;
  const addr = parseIPv6(ip);
  const network = Array.isArray(cidr.network) ? cidr.network : null;
  if (!addr || !network) return false;

  let bits = Math.max(0, Math.min(128, cidr.prefix));
  for (let i = 0; i < 8 && bits > 0; i += 1) {
    const remaining = Math.min(bits, 16);
    const mask = remaining === 16 ? 0xffff : (~(0xffff >> remaining)) & 0xffff;
    if ((addr[i] & mask) !== (network[i] & mask)) return false;
    bits -= remaining;
  }

  return true;
}

function parseCidr(raw: string): ParsedCidr | null {
  const [rangeRaw, prefixRaw] = raw.split("/");
  const range = rangeRaw.trim();
  if (!range) return null;

  const family = net.isIP(range);
  if (!family) return null;

  const defaultPrefix = family === 4 ? 32 : 128;
  const prefix = prefixRaw === undefined ? defaultPrefix : Number(prefixRaw.trim());
  if (Number.isNaN(prefix)) return null;

  if (family === 4) {
    if (prefix < 0 || prefix > 32) return null;
    const network = parseIPv4(range);
    if (network === null) return null;
    return { family: 4, network, prefix };
  }

  const networkParts = parseIPv6(range);
  if (!networkParts || family !== 6) return null;
  if (prefix < 0 || prefix > 128) return null;
  return { family: 6, network: networkParts, prefix };
}

function normaliseIp(ip: string): string {
  if (!ip) return ip;
  if (ip === "::ffff:127.0.0.1") return "127.0.0.1";
  if (ip.startsWith("::ffff:")) {
    const tail = ip.slice(7);
    if (net.isIP(tail) === 4) return tail;
  }
  return ip;
}

function parseAllowedCidrs(): ParsedCidr[] {
  const explicit = process.env.ANT_ALLOWLIST
    ? process.env.ANT_ALLOWLIST.split(",")
      .map((token) => token.trim())
      .filter(Boolean)
    : [];
  return [...TAILSCALE_CIDRS, ...explicit]
    .map(parseCidr)
    .filter(Boolean) as ParsedCidr[];
}

function isLoopback(ip: string): boolean {
  const candidate = normaliseIp(ip);
  if (net.isIP(candidate) === 4) {
    return candidate === "127.0.0.1";
  }
  if (candidate === "::1" || candidate === "::ffff:127.0.0.1") return true;
  if (net.isIP(candidate) === 6) return candidate === "::1";
  return false;
}

export function isAllowedHost(ip: string): boolean {
  const allowTailscale = parseBool(process.env.ANT_TAILSCALE_ONLY, true);
  if (!allowTailscale) return true;

  const allowLoopback = parseBool(process.env.ANT_ALLOW_LOOPBACK, false);
  const normalised = normaliseIp(ip);
  if (!normalised) return false;

  if (allowLoopback && isLoopback(normalised)) return true;

  const allowlist = parseAllowedCidrs();
  const family = net.isIP(normalised);
  if (family === 0) return false;

  return allowlist.some((entry) => {
    if (entry.family !== family) return false;
    if (family === 4) return isIPv4InCidr(normalised, entry);
    return isIPv6InCidr(normalised, entry);
  });
}

export function tailscaleOnly(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket?.remoteAddress || "";
  if (isAllowedHost(ip)) return next();
  res.status(403).json({ error: "ANT is restricted to the configured local network." });
}
