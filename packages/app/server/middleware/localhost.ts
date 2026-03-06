import type { Request, Response, NextFunction } from "express";

export function localhostOnly(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "";
  const allowed = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

  if (allowed.has(ip)) {
    return next();
  }

  res.status(403).json({ error: "ANT is localhost-only" });
}
