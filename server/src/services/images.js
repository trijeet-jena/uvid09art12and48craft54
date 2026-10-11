/* ============================================================
   UVID — product image database
   Every product photo lives in SQLite:
     image_blobs     — content-addressed bytes (sha256), shared across rows
     product_images  — catalog: which image belongs to which product / colour

   The same bytes are ALSO saved as a real file in server/data/images/
   named <sha256>.<ext>, so the image folder on disk always mirrors the
   database (easy backup / CDN sync / direct viewing). Serving still
   prefers the file for speed; the BLOB is the fallback of record.
   ============================================================ */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { db, now, DATA_DIR } = require("../db");
const bus = require("../events");

/* folder where every image file is persisted: server/data/images/ */
const IMAGES_DIR = path.join(DATA_DIR, "images");
const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const MAX_BYTES = 6 * 1024 * 1024;
const MAX_PER_PRODUCT = 24;
const MIME_BY_EXT = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/* declared data-URI subtype must match the sniffed file signature */
const MIME_EXT = { jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp", gif: "gif" };

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.length > 6 && buf.slice(0, 4).toString("ascii") === "GIF8") return "gif";
  return null;
}

function bad(msg, status) {
  const e = new Error(msg);
  e.status = status || 400;
  return e;
}

/* JPEG SOF / PNG IHDR — used only for gallery layout hints */
function dimensions(buf) {
  try {
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let o = 2;
      while (o < buf.length - 9) {
        if (buf[o] !== 0xff) { o++; continue; }
        const marker = buf[o + 1];
        const len = buf.readUInt16BE(o + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(o + 7), height: buf.readUInt16BE(o + 5) };
        }
        o += 2 + len;
      }
      return {};
    }
    if (buf.length > 24 && buf.slice(12, 16).toString("ascii") === "IHDR") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  } catch (_e) { /* dimensions are optional metadata */ }
  return {};
}

/* ---------- file mirror (server/data/images) ---------- */

const fileNameFor = (sha, mime) => sha + "." + (EXT_BY_MIME[mime] || "bin");

function filePathFor(sha, mime) {
  /* sha256 hex + known ext — path-safe by construction (defensive re-check) */
  if (!/^[a-f0-9]{64}$/.test(String(sha))) throw bad("Invalid image hash.");
  const ext = EXT_BY_MIME[mime] || "bin";
  if (!/^[a-z0-9]{2,5}$/.test(ext)) throw bad("Invalid image extension.");
  return path.join(IMAGES_DIR, sha + "." + ext);
}

/** write bytes to the folder (called on store + backfill) */
function writeImageFile(sha, mime, data) {
  const fp = filePathFor(sha, mime);
  if (fs.existsSync(fp)) return fp; /* deduped — same sha never rewritten */
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, fp); /* atomic-ish: readers never see a half file */
  return fp;
}

/** one-time sweep: make sure every blob in the db has its file */
function backfillFiles() {
  let n = 0;
  for (const row of db.prepare("SELECT sha256, mime, data FROM image_blobs").iterate()) {
    const fp = filePathFor(row.sha256, row.mime);
    if (!fs.existsSync(fp)) { try { writeImageFile(row.sha256, row.mime, row.data); n++; } catch (_e) { /* read-only disk etc — blob still serves */ } }
  }
  return n;
}

/* ---------- reads ---------- */

const selectImage = db.prepare(
  "SELECT id, product_id, variant_key, sha256, mime, byte_size, width, height, alt_text, sort_order FROM product_images WHERE id = ?"
);
const selectBlob = db.prepare("SELECT mime, data FROM image_blobs WHERE sha256 = ?");
const listByProduct = db.prepare(
  `SELECT id, product_id, variant_key, mime, byte_size, width, height, alt_text, sort_order
     FROM product_images WHERE product_id = ? ORDER BY sort_order, id`
);

const toPublic = (r) => ({
  id: r.id,
  productId: r.product_id,
  variantKey: r.variant_key || null,
  url: `/api/images/${r.id}`,
  mime: r.mime,
  byteSize: r.byte_size,
  width: r.width || null,
  height: r.height || null,
  altText: r.alt_text || null,
  sortOrder: r.sort_order,
});

/** all images for a product, in gallery order (newest row last) */
function listFor(productId) {
  return listByProduct.all(productId).map(toPublic);
}

/** raw bytes for serving — file first (fast), db blob as fallback of record */
function readBytes(imageId) {
  const row = selectImage.get(imageId);
  if (!row) return null;
  const blob = selectBlob.get(row.sha256);
  if (!blob) return null;
  let data = blob.data;
  let source = "db";
  try {
    const fp = filePathFor(row.sha256, blob.mime);
    if (fs.existsSync(fp)) {
      const file = fs.readFileSync(fp);
      if (file.length) { data = file; source = "file"; }
    } else {
      writeImageFile(row.sha256, blob.mime, blob.data); /* lazy backfill */
      source = "backfilled";
    }
  } catch (_e) { /* fs hiccups fall through to the db blob */ }
  return { mime: blob.mime, data, id: row.id, sha256: row.sha256, file: fileNameFor(row.sha256, blob.mime), source };
}

/* ---------- writes ---------- */

const insertBlob = db.prepare(
  "INSERT OR IGNORE INTO image_blobs (sha256, mime, byte_size, data) VALUES (?, ?, ?, ?)"
);
const findRow = db.prepare(
  "SELECT id FROM product_images WHERE product_id = ? AND COALESCE(variant_key,'') = COALESCE(?,'') AND sha256 = ?"
);
const nextOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM product_images WHERE product_id = ?");
const countFor = db.prepare("SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?");
const insertImage = db.prepare(
  `INSERT INTO product_images
     (product_id, variant_key, sha256, mime, byte_size, width, height, alt_text, sort_order)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const deleteImageRow = db.prepare("DELETE FROM product_images WHERE id = ?");

/** which product row does this variant key belong to? */
function resolveVariant(productId, variantKey) {
  if (!variantKey) return null;
  const v = String(variantKey).trim();
  if (!v) return null;
  if (v === productId) return v;
  /* the child variant is a real product row — confirm it belongs to this parent */
  const row = db.prepare("SELECT id, meta_json FROM products WHERE id = ?").get(v);
  if (!row) throw bad("That colour variant no longer exists.", 404);
  let parent = null;
  try { parent = row.meta_json ? JSON.parse(row.meta_json).parent : null; } catch (_e) { parent = null; }
  if (parent !== productId) throw bad("That colour variant does not belong to this product.", 400);
  return v;
}

/**
 * Store one image and attach it to a product (optionally to one colour variant).
 * Accepts a base64 data:image URI. Returns the stored catalog row.
 */
const store = db.transaction(({ productId, variantKey, dataUri, altText }) => {
  const pid = String(productId || "");
  const product = db.prepare("SELECT id FROM products WHERE id = ?").get(pid);
  if (!product) throw bad("Product not found.", 404);

  const vkey = resolveVariant(pid, variantKey);

  const raw = String(dataUri || "");
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
  if (!m) throw bad("Send the image as a base64 data:image URI.");
  const declared = MIME_EXT[m[1].toLowerCase()];
  if (!declared) throw bad("Only JPEG, PNG, WebP or GIF images are allowed.");

  const buf = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (!buf.length) throw bad("The uploaded image is empty.");
  if (buf.length > MAX_BYTES) throw bad(`Image is too large (max ${Math.round(MAX_BYTES / 1048576)} MB).`, 413);

  const ext = sniff(buf);
  if (!ext) throw bad("Only JPEG, PNG, WebP or GIF images are allowed.");
  if (ext !== declared) throw bad("The file content does not match the declared image type.");

  if (countFor.get(pid).n >= MAX_PER_PRODUCT) {
    throw bad(`A product can hold up to ${MAX_PER_PRODUCT} images. Remove one first.`, 409);
  }

const sha = crypto.createHash("sha256").update(buf).digest("hex");
const mime = MIME_BY_EXT[ext];

  /* same photo already attached to this product/variant → no duplicate row */
  const dup = findRow.get(pid, vkey, sha);
  if (dup) return toPublic(selectImage.get(dup.id));

  /* 1) save the file to the image folder … */
  writeImageFile(sha, mime, buf);
  /* 2) … then the deduped blob row in the database */
  insertBlob.run(sha, mime, buf.length, buf);
  const d = dimensions(buf);
  const info = insertImage.run(
    pid, vkey, sha, mime, buf.length,
    d.width || null, d.height || null,
    String(altText || "").trim().slice(0, 160) || null,
    nextOrder.get(pid).n
  );
  return toPublic(selectImage.get(info.lastInsertRowid));
});

/** delete one image row (the shared blob is kept — other rows may use it) */
function remove(imageId, productId) {
  const row = selectImage.get(imageId);
  if (!row) throw bad("Image not found.", 404);
  if (productId && row.product_id !== String(productId)) throw bad("Image not found.", 404);
  deleteImageRow.run(imageId);
  return { ok: true, id: imageId };
}

/** set the display order; the first entry becomes the primary photo */
const setOrderStmt = db.prepare("UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?");
function reorder(productId, orderedIds) {
  const pid = String(productId);
  const mine = new Set(listByProduct.all(pid).map((r) => r.id));
  if (!Array.isArray(orderedIds) || !orderedIds.length) throw bad("Provide the images in their new order.");
  const seen = new Set();
  for (const id of orderedIds) {
    if (!mine.has(id)) throw bad("That image does not belong to this product.", 400);
    if (seen.has(id)) throw bad("The same image was listed twice.", 400);
    seen.add(id);
  }
  orderedIds.forEach((id, i) => setOrderStmt.run(i, id, pid));
  bus.publish("catalog");
  return listFor(pid);
}

/** keep products.image_url pointing at the first gallery image */
function syncPrimary(productId) {
  const first = listByProduct.get(String(productId));
  const url = first ? `/api/images/${first.id}` : null;
  db.prepare("UPDATE products SET image_url = ?, updated_at = ? WHERE id = ?").run(url, now(), productId);
  return url;
}

/* ---- every gallery change keeps the product row in step and pushes live updates ---- */
function afterChange(productId) {
  syncPrimary(productId);
  bus.publish("catalog");
}

function addImage(args) {
  const row = store(args);
  afterChange(args.productId);
  return row;
}

function deleteImage(imageId, productId) {
  const row = selectImage.get(imageId);
  if (!row) throw bad("Image not found.", 404);
  const out = remove(imageId, productId);
  afterChange(row.product_id);
  return out;
}

function reorderImages(productId, orderedIds) {
  const out = reorder(productId, orderedIds);
  afterChange(productId);
  return out;
}

/* ---- db-level image totals (admin settings) ---- */
function stats() {
  const imgs = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(byte_size),0) AS bytes FROM product_images").get();
  const blobs = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(byte_size),0) AS bytes FROM image_blobs").get();
  /* bytes actually saved by content-addressing: every extra row that points at
     an already-stored blob costs nothing on disk */
  const shared = db.prepare(
    `SELECT COALESCE(SUM((refs - 1) * byte_size), 0) AS saved
       FROM (SELECT sha256, COUNT(*) AS refs, MAX(byte_size) AS byte_size
               FROM product_images GROUP BY sha256 HAVING COUNT(*) > 1)`
  );
  const saved = shared.get().saved;
  return {
    imageCount: imgs.n,
    referencedBytes: imgs.bytes,
    blobCount: blobs.n,
    storedBytes: blobs.bytes,
    deduplicatedBytes: Math.max(0, saved),
  };
}

module.exports = {
  store: addImage, remove: deleteImage, reorder: reorderImages,
  listFor, readBytes, syncPrimary, stats, MAX_PER_PRODUCT,
  IMAGES_DIR, backfillFiles, filePathFor, fileNameFor,
};
