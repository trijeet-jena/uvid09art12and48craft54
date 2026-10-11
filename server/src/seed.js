/* ============================================================
   UVID — seed script
   Creates the admin account and imports the existing catalog
   from data/products.js (with embedded photos) into SQLite.
   Idempotent: upserts by product id; keeps existing prices/stock
   if the product already exists (admin's DB wins over the seed).
   Run: npm run seed
   ============================================================ */
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { db } = require("./db");

/* Real photos in stationery/assets are served to BOTH portals at
   /assets/<id>.jpg; fall back to the embedded art data-URI. */
const ASSETS_DIR = path.join(__dirname, "..", "..", "assets");
function storeImage(p) {
  if (fs.existsSync(path.join(ASSETS_DIR, p.id + ".jpg"))) return "/assets/" + p.id + ".jpg";
  if (fs.existsSync(path.join(ASSETS_DIR, p.id + ".png"))) return "/assets/" + p.id + ".png";
  return p.img || null;
}

/* ---------- admin ---------- */
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@uvid.store").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe!2026";
const ADMIN_NAME = process.env.ADMIN_NAME || "Store Admin";
const RESET_ADMIN = process.argv.includes("--reset-admin");

let admin = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'ADMIN'").get(ADMIN_EMAIL);
if (!admin) {
  const info = db.prepare("INSERT INTO users (mobile_number, name, email, role) VALUES (?, ?, ?, 'ADMIN')")
    .run("0000000000", ADMIN_NAME, ADMIN_EMAIL);
  admin = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  db.prepare("INSERT INTO admin_credentials (admin_id, password_hash) VALUES (?, ?)")
    .run(admin.id, bcrypt.hashSync(ADMIN_PASSWORD, 10));
  console.log("Admin created:", ADMIN_EMAIL);
} else {
  console.log("Admin exists:", ADMIN_EMAIL);
  if (RESET_ADMIN) {
    db.prepare("UPDATE admin_credentials SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE admin_id = ?")
      .run(bcrypt.hashSync(ADMIN_PASSWORD, 10), admin.id);
    console.log("Admin password reset from ADMIN_PASSWORD env.");
  } else {
    console.log("(run `node src/seed.js --reset-admin` to sync the password with ADMIN_PASSWORD env)");
  }
}

/* ---------- catalog ---------- */
if (typeof global.window === "undefined") global.window = global; // products.js targets a browser global
require("../../data/products.js"); // sets window.PT

function importCatalog() {
  const PT = global.window.PT;
  if (!PT) { console.log("No catalog found to import."); return; }

  /* ---------- categories ---------- */
  if (Array.isArray(PT.CATEGORIES) && PT.CATEGORIES.length) {
    const insCat = db.prepare(
      `INSERT INTO categories (slug, name, emoji, blurb, sort_order) VALUES (@slug, @name, @emoji, @blurb, @sort)
       ON CONFLICT(slug) DO UPDATE SET name = excluded.name, emoji = excluded.emoji, blurb = excluded.blurb, updated_at = datetime('now')`
    );
    PT.CATEGORIES.forEach((c, i) => insCat.run({
      slug: c.slug, name: c.label || c.name || c.slug, emoji: c.emoji || null, blurb: c.blurb || null, sort: i,
    }));
    console.log(`Categories seeded: ${PT.CATEGORIES.length}.`);
  }

  const insCat2 = db.prepare(
    "INSERT OR IGNORE INTO categories (slug, name, sort_order) VALUES (?, ?, 200)"
  );

  const upsert = db.prepare(
    `INSERT INTO products (id, product_name, category, description, price, mrp, stock_quantity, image_url, emoji, variant_label, variants_json, meta_json, status, sort_order)
     VALUES (@id, @product_name, @category, @description, @price, @mrp, @stock_quantity, @image_url, @emoji, @variant_label, @variants_json, @meta_json, @status, @sort_order)
     ON CONFLICT(id) DO UPDATE SET
       product_name = excluded.product_name,
       category     = excluded.category,
       description  = excluded.description,
       image_url    = excluded.image_url,
       emoji        = excluded.emoji,
       variant_label= excluded.variant_label,
       variants_json= excluded.variants_json,
       meta_json    = excluded.meta_json,
       updated_at   = datetime('now')`
  );
  let n = 0;
  const tx = db.transaction(() => {
    PT.PRODUCTS.forEach((p, i) => {
      const variants = Array.isArray(p.variants)
        ? p.variants.map((v) => ({ sku: v.id || v.sku, size: v.size, label: v.label, price: v.price, stock: 50 }))
        : null;
      insCat2.run(p.category, p.category);
      upsert.run({
        id: p.id,
        product_name: p.name,
        category: p.category,
        description: (p.highlights || []).join(" • "),
        price: p.price,
        mrp: p.mrp,
        stock_quantity: p.stock ?? 25,
        image_url: storeImage(p),
        emoji: p.emoji || null,
        variant_label: variants ? variants[0].label : null,
        variants_json: variants ? JSON.stringify(variants) : null,
        meta_json: JSON.stringify({
          brand: p.brand || null,
          rating: p.rating ?? null,
          ratingCount: p.ratingCount || 0,
          tags: Array.isArray(p.tags) ? p.tags : [],
          specs: p.specs || null,
          highlights: Array.isArray(p.highlights) ? p.highlights : null,
          bg: p.bg || null,
          ink: p.ink || null,
          parent: p.parent || null,
        }),
        status: "ACTIVE",
        sort_order: i,
      });
      n++;
    });
  });
  tx();
  console.log(`Catalog imported: ${n} products.`);
}

try { importCatalog(); } catch (e) { console.error("Seed error:", e.message); }

console.log("Seed complete.");
