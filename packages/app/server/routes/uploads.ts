import { Router } from "express";
import type { Request } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";
import { nanoid } from "nanoid";
import db from "../db.js";
import type { DbSession } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "..", "..", "public", "uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${nanoid(12)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, GIF and WEBP are allowed."));
    }
  },
});

const router = Router();

router.post("/api/upload", upload.single("file"), (req, res) => {
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
  destination: (req: Request, _file, cb) => {
    const session = db
      .prepare("SELECT cwd FROM sessions WHERE id = ?")
      .get(req.params.sessionId) as Pick<DbSession, "cwd"> | undefined;

    const dest = session?.cwd ?? UPLOADS_DIR;
    if (!existsSync(dest)) {
      try { mkdirSync(dest, { recursive: true }); } catch { /* ignore */ }
    }
    cb(null, dest);
  },
  filename: (_req, file, cb) => {
    // Preserve original filename; path.basename strips any directory traversal.
    cb(null, path.basename(file.originalname));
  },
});

const sessionUpload = multer({
  storage: sessionStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

router.post(
  "/api/sessions/:sessionId/upload",
  sessionUpload.single("file"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    // Return the absolute filesystem path — the iOS app pastes this into the CLI.
    res.json({ url: req.file.path });
  }
);

export default router;
