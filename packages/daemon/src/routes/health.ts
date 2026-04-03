import { Router } from "express";

const router = Router();

router.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "0.1.0" });
});

export default router;
