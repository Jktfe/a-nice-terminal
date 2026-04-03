import { Router } from "express";
import type { Request } from "express";
import multer from "multer";
import { dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { nanoid } from "nanoid";
import db from "../db.js";
import type { DbSession } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, "..", "..", "public", "uploads");

const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req: any, file: any, cb: any) => {
    const ext = extname(file.originalname);
    cb(null, `${nanoid(12)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, GIF and WEBP are allowed."));
    }
  },
});

const router = Router();

router.post("/api/upload", upload.single("file"), (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const url = `/uploads/${req.file.filename}`;
  res.json({
    url,
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });
});

// ─── Session-scoped upload ───────────────────────────────────────────────────
// Saves file directly into the session's working directory so the user can
// reference it by name in terminal commands (e.g. `cat photo.jpg`).
// Falls back to UPLOADS_DIR when the session has no cwd set.

const sessionStorage = multer.diskStorage({
  destination: (req: Request, _file: any, cb: any) => {
    const session = db
      .prepare("SELECT cwd FROM sessions WHERE id = ?")
      .get((req.params as any).sessionId) as Pick<DbSession, "cwd"> | undefined;

    const dest = session?.cwd ?? UPLOADS_DIR;
    if (!existsSync(dest)) {
      try { mkdirSync(dest, { recursive: true }); } catch { /* ignore */ }
    }
    cb(null, dest);
  },
  filename: (_req: any, file: any, cb: any) => {
    // Preserve original filename; basename strips any directory traversal.
    cb(null, basename(file.originalname));
  },
});

const sessionUpload = multer({
  storage: sessionStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

router.post(
  "/api/sessions/:sessionId/upload",
  sessionUpload.single("file"),
  (req: any, res: any) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    // Return the absolute filesystem path — the iOS app pastes this into the CLI.
    res.json({ url: req.file.path });
  }
);

export default router;
