import type { Request, Response, NextFunction } from "express";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.ANT_API_KEY;

  if (!apiKey) return next();

  const provided =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace("Bearer ", "");

  if (provided === apiKey) return next();

  res.status(401).json({ error: "Invalid or missing API key" });
}
