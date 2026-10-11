/* ============================================================
   UVID — image routes
   GET  /api/images/:id            → public bytes (product photos are public)
   GET  /api/admin/products/:id/images       → catalog for a product
   POST /api/admin/products/:id/images       → attach an image (optionally to a colour)
   DELETE /api/admin/images/:id              → detach
   PUT  /api/admin/products/:id/images/order → reorder (first = primary)
   All writes require an admin session and are audited.
   ============================================================ */
"use strict";

const express = require("express");
const images = require("../services/images");
const { requireAdmin } = require("../auth");
const { audit, rateLimit } = require("../security");

const router = express.Router();

/* serving images is cheap but shouldn't be trivially abusable */
const readLimiter = rateLimit({ name: "image-read", max: 600, windowMs: 60 * 1000, message: "Too many image requests." });
const writeLimiter = rateLimit({ name: "image-write", max: 120, windowMs: 60 * 1000, message: "Too many image changes. Please wait a minute." });

/* ---------------- public: serve the bytes ---------------- */
router.get("/images/:id", readLimiter, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid image id." });
  const got = images.readBytes(id);
  if (!got) return res.status(404).json({ error: "Image not found." });
  res.setHeader("Content-Type", got.mime);
  res.setHeader("Content-Length", got.data.length);
  /* image bytes never change for a given id — cache hard */
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  /* never let a stored image be interpreted as anything but its own type */
  res.setHeader("Content-Disposition", "inline");
  res.end(got.data);
});

/* ---------------- public: serve straight from the image folder ----------------
   /api/img/<sha256>.<ext> — the exact file on disk in server/data/images/.
   Only '''[sha256].[jpg|png|webp|gif]''' names exist, so traversal is impossible:
   anything else simply 404s. */
router.get("/img/:file", readLimiter, (req, res) => {
  const f = String(req.params.file || "");
  const m = /^([a-f0-9]{64})\.(jpg|png|webp|gif)$/.exec(f);
  if (!m) return res.status(404).json({ error: "Image not found." });
  const ext = m[2];
  const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
  let data;
  try { data = require("fs").readFileSync(images.filePathFor(m[1], MIME[ext])); }
  catch (_e) { return res.status(404).json({ error: "Image not found." }); }
  res.setHeader("Content-Type", MIME[ext]);
  res.setHeader("Content-Length", data.length);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  res.end(data);
});

/* ---------------- admin: gallery management ---------------- */
router.get("/admin/products/:id/images", requireAdmin, (req, res) => {
  try {
    res.json({ images: images.listFor(String(req.params.id)), stats: images.stats() });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.post("/admin/products/:id/images", requireAdmin, writeLimiter, (req, res) => {
  const productId = String(req.params.id);
  try {
    const b = req.body || {};
    const img = images.store({
      productId,
      variantKey: b.variantKey || b.variant || null,
      dataUri: b.image || b.dataUri,
      altText: b.altText || "",
    });
    audit("product.image.add", req, productId, {
      imageId: img.id, variantKey: img.variantKey, mime: img.mime, byteSize: img.byteSize,
    });
    res.status(201).json({ ok: true, image: img, images: images.listFor(productId) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.delete("/admin/images/:id", requireAdmin, writeLimiter, (req, res) => {
  try {
    const out = images.remove(Number(req.params.id));
    audit("product.image.remove", req, String(req.params.id), {});
    res.json({ ok: true, ...out });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.put("/admin/products/:id/images/order", requireAdmin, writeLimiter, (req, res) => {
  const productId = String(req.params.id);
  try {
    const list = images.reorder(productId, (req.body || {}).order);
    audit("product.image.reorder", req, productId, { count: list.length });
    res.json({ ok: true, images: list });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = router;