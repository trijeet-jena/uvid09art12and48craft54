/* ============================================================
   UVID — database layer (better-sqlite3, WAL)
   Single source of truth for products, users, orders.
   ============================================================ */
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

/* Render's persistent disk is mounted outside the source tree. Local runs keep
   using server/data; cloud runs set UVID_DATA_DIR=/var/data. */
const DATA_DIR = process.env.UVID_DATA_DIR
  ? path.resolve(process.env.UVID_DATA_DIR)
  : path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "uvid.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile_number TEXT UNIQUE,
  name          TEXT NOT NULL DEFAULT 'Reader',
  email         TEXT,
  role          TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','ADMIN')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_credentials (
  admin_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash  TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,            -- SKU / product id (e.g. 'bamboo-chopsticks')
  product_name   TEXT NOT NULL,
  category       TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  price          REAL NOT NULL CHECK (price >= 0),
  mrp            REAL,
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  image_url      TEXT,
  emoji          TEXT,
  variant_label  TEXT,                          -- display label when product has sizes
  variants_json  TEXT,                          -- optional size variants: [{size,label,price,stock,sku}]
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','OUT_OF_STOCK','ARCHIVED')),
  sort_order     INTEGER NOT NULL DEFAULT 1000,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status);

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  customer_id    INTEGER NOT NULL REFERENCES users(id),
  total_amount   REAL NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PLACED'
                 CHECK (status IN ('PLACED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
  payment_method TEXT NOT NULL DEFAULT 'COD',
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  address_json   TEXT,
  eta            TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

CREATE TABLE IF NOT EXISTS order_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL REFERENCES products(id),
  product_name    TEXT NOT NULL,
  variant_label   TEXT,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  price_at_purchase REAL NOT NULL,
  image_url       TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS otp_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile_number TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  purpose       TEXT NOT NULL DEFAULT 'LOGIN',
  attempts      INTEGER NOT NULL DEFAULT 0,
  expires_at    TEXT NOT NULL,
  consumed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_mobile ON otp_codes(mobile_number, created_at);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  emoji      TEXT,
  blurb      TEXT,
  image_url  TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* Email-only customer accounts do not have a phone number. Upgrade older
   databases without changing customer IDs or the rows that reference them. */
const mobileColumn = db.prepare("PRAGMA table_info(users)").all().find((column) => column.name === "mobile_number");
if (mobileColumn && mobileColumn.notnull) {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(`
      CREATE TABLE users_email_login_migration (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        mobile_number TEXT UNIQUE,
        name          TEXT NOT NULL DEFAULT 'Reader',
        email         TEXT,
        role          TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','ADMIN')),
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_email_login_migration (id, mobile_number, name, email, role, created_at, updated_at)
        SELECT id, mobile_number, name, email, role, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_email_login_migration RENAME TO users;
      CREATE UNIQUE INDEX idx_users_email_unique ON users(email COLLATE NOCASE);
    `);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch (_rollbackError) { /* transaction already ended */ }
    throw error;
  } finally {
    db.pragma("foreign_keys = ON");
  }
} else {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email COLLATE NOCASE)");
}

/* ---- forward migrations (existing DBs) ---- */
const productCols = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
if (!productCols.includes("meta_json")) {
  db.exec("ALTER TABLE products ADD COLUMN meta_json TEXT");
}
const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
if (!orderCols.includes("coupon")) db.exec("ALTER TABLE orders ADD COLUMN coupon TEXT");
if (!orderCols.includes("discount")) db.exec("ALTER TABLE orders ADD COLUMN discount REAL NOT NULL DEFAULT 0");
if (!orderCols.includes("shipping")) db.exec("ALTER TABLE orders ADD COLUMN shipping REAL NOT NULL DEFAULT 0");

/* ---- security: admin two-factor auth + audit trail (additive only) ---- */
const credCols = db.prepare("PRAGMA table_info(admin_credentials)").all().map((c) => c.name);
if (!credCols.includes("mfa_secret")) db.exec("ALTER TABLE admin_credentials ADD COLUMN mfa_secret TEXT");
if (!credCols.includes("mfa_enabled")) db.exec("ALTER TABLE admin_credentials ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0");

db.exec(`
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER,
  actor_name TEXT,
  role       TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,               -- curated JSON; never passwords/tokens/payment data
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`);

/* ---- product images: every product/variant photo lives in the database ----
   product_images = catalog (which image belongs to which product + colour variant)
   image_blobs     = the actual bytes, keyed by a content hash
   A product may have many images; `sort_order` defines the gallery order and the
   first row is the primary photo. `variant_key` ties an image to one colour. */
db.exec(`
CREATE TABLE IF NOT EXISTS product_images (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   TEXT NOT NULL,                 -- products.id (parent or variant row)
  variant_key  TEXT,                          -- colour/variant this shot belongs to
  sha256       TEXT NOT NULL,                 -- -> image_blobs.sha256 (dedupe)
  mime         TEXT NOT NULL,                 -- image/jpeg | image/png | image/webp | image/gif
  byte_size    INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  alt_text     TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pimg_product ON product_images(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pimg_variant ON product_images(product_id, variant_key);
`);

/* SQLite treats NULLs as distinct in unique indexes, so a plain
   (product_id, variant_key, sha256) index cannot stop duplicate rows where
   variant_key IS NULL. Remove any duplicates an earlier backfill run left
   behind FIRST, then install a coalescing unique index. */
db.exec(`
DELETE FROM product_images
 WHERE id NOT IN (SELECT MIN(id) FROM product_images
                   GROUP BY product_id, COALESCE(variant_key, ''), sha256);
DROP INDEX IF EXISTS idx_pimg_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pimg_uniq
  ON product_images(product_id, COALESCE(variant_key, ''), sha256);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS image_blobs (
  sha256     TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  byte_size  INTEGER NOT NULL,
  data       BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* one-time backfill: pull every existing product.image_url into the image DB.
   Idempotent — the unique index plus INSERT OR IGNORE means re-running is safe. */
(function backfillProductImages() {
  const hasBlob = db.prepare("SELECT 1 FROM image_blobs WHERE sha256 = ?");
  const putBlob = db.prepare(
    "INSERT OR IGNORE INTO image_blobs (sha256, mime, byte_size, data) VALUES (?, ?, ?, ?)"
  );
  const putImage = db.prepare(
    `INSERT OR IGNORE INTO product_images
       (product_id, variant_key, sha256, mime, byte_size, width, height, alt_text, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  /* resolve a stored image_url into raw bytes */
  function resolve(url) {
    if (!url) return null;
    const u = String(url).trim();
    const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(u);
    if (m) {
      const ext = m[1].toLowerCase();
      /* SVG is never stored: it is an active-content format that can carry
         script, and these are generated emoji placeholders rather than photos.
         The storefront keeps rendering them as art fallbacks. */
      if (ext === "svg+xml" || ext === "svg") return null;
      const buf = Buffer.from(m[2].replace(/\s/g, ""), "base64");
      if (!buf.length) return null;
      const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      return { buf, mime };
    }
    if (u.startsWith("/assets/")) {
      const p = path.join(__dirname, "..", "..", "assets", path.basename(u));
      return fs.existsSync(p) ? { buf: fs.readFileSync(p), mime: mimeFromExt(p) } : null;
    }
    if (u.startsWith("/uploads/")) {
      const p = path.join(DATA_DIR, "uploads", path.basename(u));
      return fs.existsSync(p) ? { buf: fs.readFileSync(p), mime: mimeFromExt(p) } : null;
    }
    return null; /* external http(s) URL — nothing to store locally */
  }
  function mimeFromExt(p) {
    const e = path.extname(p).toLowerCase();
    return e === ".png" ? "image/png" : e === ".webp" ? "image/webp" : e === ".gif" ? "image/gif" : "image/jpeg";
  }
  function dims(buf) {
    /* JPEG SOF / PNG IHDR — good enough for gallery layout hints */
    try {
      if (buf[0] === 0xff && buf[1] === 0xd8) {
        let o = 2;
        while (o < buf.length - 9) {
          if (buf[o] !== 0xff) { o++; continue; }
          const marker = buf[o + 1];
          const len = buf.readUInt16BE(o + 2);
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
          }
          o += 2 + len;
        }
        return null;
      }
      if (buf.length > 24 && buf.slice(12, 16).toString("ascii") === "IHDR") {
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
      }
    } catch (_e) { /* dimensions are optional */ }
    return null;
  }

  const rows = db.prepare("SELECT id, product_name, image_url, meta_json FROM products WHERE image_url IS NOT NULL AND image_url != ''").all();
  let n = 0;
  for (const r of rows) {
    const got = resolve(r.image_url);
    if (!got) continue;
    const sha = crypto.createHash("sha256").update(got.buf).digest("hex");
    if (!hasBlob.get(sha)) putBlob.run(sha, got.mime, got.buf.length, got.buf);
    const d = dims(got.buf) || {};
    /* a variant (child) row's own photo is that colour's shot; the parent row's
       photo is the generic gallery image (variant_key stays NULL) */
    let isVariant = false;
    try { isVariant = !!(r.meta_json && JSON.parse(r.meta_json).parent); } catch (_e) { isVariant = false; }
    const info = putImage.run(
      r.id,
      isVariant ? String(r.id) : null,
      sha, got.mime, got.buf.length,
      d.w || null, d.h || null,
      String(r.product_name || "").slice(0, 120),
      0
    );
    if (info.changes) n++;
  }
  if (n) console.log(`[db] migrated ${n} existing product image(s) into the image database`);

  /* point products.image_url at the stored copy so the storefront keeps working */
  const firstImage = db.prepare(
    "SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order, id LIMIT 1"
  );
  const setUrl = db.prepare("UPDATE products SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url NOT LIKE '/api/images/%')");
  let linked = 0;
  for (const r of db.prepare("SELECT DISTINCT product_id FROM product_images").all()) {
    const img = firstImage.get(r.product_id);
    if (!img) continue;
    if (setUrl.run(`/api/images/${img.id}`, r.product_id).changes) linked++;
  }
  if (linked) console.log(`[db] linked ${linked} product(s) to the image database`);
})();

/* ---- seminar: editable event details + registration list (additive) ---- */
db.exec(`
CREATE TABLE IF NOT EXISTS seminar_details (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  title         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  event_date    TEXT NOT NULL DEFAULT '',
  event_time    TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',
  meeting_url   TEXT NOT NULL DEFAULT '',
  speaker       TEXT NOT NULL DEFAULT '',
  agenda        TEXT NOT NULL DEFAULT '',      -- one item per line
  contact_email TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seminar_registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  organization  TEXT,
  notes         TEXT,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seminar_reg_created ON seminar_registrations(created_at);
CREATE INDEX IF NOT EXISTS idx_seminar_reg_email   ON seminar_registrations(lower(email));
`);

/* single editable details row — seeded with visible placeholders, never invented facts */
db.prepare(
  `INSERT OR IGNORE INTO seminar_details
     (id, title, description, event_date, event_time, location, meeting_url, speaker, agenda, contact_email)
   VALUES (1, '', '', '', '', '', '', '', '', '')`
).run();

/* ---- small helpers ---- */
const now = () => new Date().toISOString();

const touchProduct = db.prepare("UPDATE products SET updated_at = ? WHERE id = ?");
const bumpOrder = db.prepare("UPDATE orders SET updated_at = ? WHERE id = ?");

function touch(kind, id) {
  if (kind === "product") touchProduct.run(now(), id);
  else if (kind === "order") bumpOrder.run(now(), id);
}

module.exports = { db, touch, now, DATA_DIR };
