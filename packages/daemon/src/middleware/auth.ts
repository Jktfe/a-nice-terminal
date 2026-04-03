// Inline minimal Express-compatible types — express is not a direct daemon dependency.
interface Request {
  headers: Record<string, string | string[] | undefined>;
}
interface Response {
  status(code: number): this;
  json(body: unknown): this;
}
type NextFunction = () => void;

function normaliseToken(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    return normaliseToken(value[0]);
  }
  return undefined;
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.ANT_API_KEY;

  if (!apiKey) return next();

  const provided =
    normaliseToken(req.headers["x-api-key"]) ??
    normaliseToken(req.headers["authorization"])?.replace(/^Bearer\s+/i, "").trim();

  if (provided === apiKey) return next();

  res.status(401).json({ error: "Invalid or missing API key" });
}
