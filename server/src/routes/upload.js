/* ============================================================
   UVID — admin image upload
   Accepts a base64 data-URI (client downscales before sending),
   validates magic bytes, stores under data/uploads/ and returns
   a public /uploads/... URL that the customer panel loads.
   Mounted BEFORE the global 256kb JSON parser in index.js.
   ============================================================ */
"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { requireAdmin } = require("../auth");
const { DATA_DIR } = require("../db");
const { rateLimit } = require("../security");

const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = 6 * 1024 * 1024;
const router = express.Router();
router.use(express.json({ limit: "8mb" }));

/* per-IP throttle on uploads (admin-only on top of that) */
const uploadLimiter = rateLimit({ name: "upload", max: 60, windowMs: 60 * 1000, message: "Too many uploads. Please wait a minute." });

/* declared data-URI subtype must match the sniffed file signature */
const MIME_EXT = { jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp", gif: "gif" };

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.length > 6 && buf.slice(0, 4).toString("ascii") === "GIF8") return "gif";
  return null;
}

router.post("/", uploadLimiter, requireAdmin, (req, res) => {
  try {
    const raw = String((req.body && req.body.image) || "");
    const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
    if (!m) return res.status(400).json({ error: "Send the image as a base64 data:image URI." });
    const declared = MIME_EXT[m[1].toLowerCase()];
    if (!declared) return res.status(400).json({ error: "Only JPEG, PNG, WebP or GIF images are allowed." });

    const buf = Buffer.from(m[2].replace(/\s/g, ""), "base64");
    if (!buf.length) return res.status(400).json({ error: "The uploaded image is empty." });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: "Image is too large (max 6 MB after compression)." });

    const ext = sniff(buf);
    if (!ext) return res.status(400).json({ error: "Only JPEG, PNG, WebP or GIF images are allowed." });
    if (ext !== declared) return res.status(400).json({ error: "The file content does not match the declared image type." });

    const name = `img-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    res.status(201).json({ ok: true, url: `/uploads/${name}` });
  } catch (e) {
    console.error("[upload]", e);
    res.status(500).json({ error: "Could not save the image. Please try again." });
  }
});

module.exports = router;
