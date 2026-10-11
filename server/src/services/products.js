/* ============================================================
   UVID — product service
   Customers get catalog reads; admins get validated CRUD.
   The database is the single source of truth.
   ============================================================ */
"use strict";

const { db, touch, now } = require("../db");
const bus = require("../events");

const slugify = (s) =>
  String(s).toLowerCase().trim()
    .replace(/[^a-z0-9\u0900-\u097F]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "product";

function uniqueProductId(base) {
  let id = base, n = 2;
  while (db.prepare("SELECT 1 FROM products WHERE id = ?").get(id)) id = `${base}-${n++}`;
  return id;
}

function parseVariants(r) {
  if (!r.variants_json) return null;
  try {
    const arr = JSON.parse(r.variants_json);
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.map((v) => ({
      sku: String(v.sku || ""),
      size: String(v.size || ""),
      label: String(v.label || v.size || ""),
      price: Number(v.price),
      stock: Math.max(0, Number(v.stock) || 0),
    })).filter((v) => v.sku && Number.isFinite(v.price));
  } catch (_e) { return null; }
}

/* image gallery rows come from the image database (src/services/images.js) */
let imgSvc = null;
try { imgSvc = require("./images"); } catch (_e) { imgSvc = null; }
const galleryFor = (r) => {
  if (!imgSvc) return [];
  try {
    const all = imgSvc.listFor(r.id);
    /* a variant child row keeps its own colour shot; expose it as the single
       gallery entry so both the parent and child views resolve correctly */
    return all.map((im) => ({ id: im.id, url: im.url, altText: im.altText, variantKey: im.variantKey }));
  } catch (_e) { return []; }
};

const publicView = (r) => {
  const variants = parseVariants(r);
  const variantStock = variants ? variants.reduce((s, v) => s + v.stock, 0) : null;
  let meta = null;
  if (r.meta_json) { try { meta = JSON.parse(r.meta_json); } catch (_e) { meta = null; } }
  return {
    id: r.id,
    productName: r.product_name,
    category: r.category,
    description: r.description,
    price: r.price,
    mrp: r.mrp,
    stockQuantity: r.stock_quantity,
    imageUrl: r.image_url,
    images: galleryFor(r),
    emoji: r.emoji,
    variantLabel: r.variant_label || null,
    variants: variants || undefined,
    status: r.status,
    inStock: r.status !== "OUT_OF_STOCK" && (variants ? variantStock > 0 : r.stock_quantity > 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    /* display-only metadata (never used for money/stock decisions) */
    brand: (meta && meta.brand) || null,
    rating: meta && meta.rating != null ? meta.rating : null,
    ratingCount: (meta && meta.ratingCount) || 0,
    tags: (meta && Array.isArray(meta.tags)) ? meta.tags : [],
    specs: (meta && meta.specs) || null,
    highlights: (meta && Array.isArray(meta.highlights)) ? meta.highlights : null,
    bg: (meta && meta.bg) || null,
    ink: (meta && meta.ink) || null,
    parent: (meta && meta.parent) || null,
  };
};

/* ---------- customer reads ---------- */
function listPublic({ category, q, includeOutOfStock = true } = {}) {
  let sql = "SELECT * FROM products WHERE status IN ('ACTIVE','OUT_OF_STOCK')";
  const args = [];
  if (category) { sql += " AND category = ?"; args.push(category); }
  if (q) { sql += " AND (product_name LIKE ? OR description LIKE ?)"; args.push(`%${q}%`, `%${q}%`); }
  sql += " ORDER BY sort_order, product_name";
  const rows = db.prepare(sql).all(...args);
  const out = rows.map(publicView);
  return includeOutOfStock ? out : out.filter((p) => p.inStock);
}

function getPublic(id) {
  const r = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!r || r.status === "ARCHIVED") return null;
  return publicView(r);
}

function categories() {
  const rows = db.prepare(
    `SELECT c.slug, c.name, c.emoji, c.blurb, c.image_url, c.sort_order,
            (SELECT COUNT(*) FROM products p WHERE p.category = c.slug AND p.status != 'ARCHIVED') AS count
     FROM categories c ORDER BY c.sort_order, c.name`
  ).all();
  if (rows.length) return rows;
  /* fallback: derive from products (fresh DB not yet seeded with categories) */
  return db.prepare(
    "SELECT category AS slug, COUNT(*) AS count FROM products WHERE status != 'ARCHIVED' GROUP BY category ORDER BY category"
  ).all();
}

/* ---------- admin: category CRUD ---------- */
function slugifyCat(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9\u0900-\u097F]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "category";
}

function createCategory(body) {
  const name = String((body && body.name) || "").trim();
  if (name.length < 2 || name.length > 40) { const e = new Error("Category name must be 2–40 characters."); e.status = 400; throw e; }
  let slug = String((body && body.slug) || "").trim() || slugifyCat(name);
  if (db.prepare("SELECT 1 FROM categories WHERE slug = ?").get(slug)) {
    const e = new Error("A category with this slug already exists."); e.status = 409; throw e;
  }
  const emoji = body && body.emoji ? String(body.emoji).slice(0, 8) : null;
  const blurb = body && body.blurb ? String(body.blurb).slice(0, 120) : null;
  const imageUrl = body && body.imageUrl ? String(body.imageUrl).slice(0, 500) : null;
  const sort = Number(body && body.sortOrder);
  db.prepare(
    "INSERT INTO categories (slug, name, emoji, blurb, image_url, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(slug, name, emoji, blurb, imageUrl, Number.isFinite(sort) ? sort : 100);
  bus.publish("categories");
  return db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug);
}

function updateCategory(slug, body) {
  const existing = db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug);
  if (!existing) { const e = new Error("Category not found."); e.status = 404; throw e; }
  const sets = [], args = [];
  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (name.length < 2 || name.length > 40) { const e = new Error("Category name must be 2–40 characters."); e.status = 400; throw e; }
    sets.push("name = ?"); args.push(name);
  }
  if (body.emoji !== undefined) { sets.push("emoji = ?"); args.push(body.emoji ? String(body.emoji).slice(0, 8) : null); }
  if (body.blurb !== undefined) { sets.push("blurb = ?"); args.push(body.blurb ? String(body.blurb).slice(0, 120) : null); }
  if (body.imageUrl !== undefined) { sets.push("image_url = ?"); args.push(body.imageUrl ? String(body.imageUrl).slice(0, 500) : null); }
  if (body.sortOrder !== undefined) { const n = Number(body.sortOrder); if (Number.isFinite(n)) { sets.push("sort_order = ?"); args.push(n); } }
  if (!sets.length) { const e = new Error("Nothing to update."); e.status = 400; throw e; }
  sets.push("updated_at = ?"); args.push(now(), slug);
  db.prepare(`UPDATE categories SET ${sets.join(", ")} WHERE slug = ?`).run(...args);
  bus.publish("categories");
  return db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug);
}

function deleteCategory(slug, { reassignTo } = {}) {
  const existing = db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug);
  if (!existing) { const e = new Error("Category not found."); e.status = 404; throw e; }
  const used = db.prepare("SELECT COUNT(*) AS n FROM products WHERE category = ? AND status != 'ARCHIVED'").get(slug).n;
  if (used > 0) {
    if (!reassignTo) {
      const e = new Error(`"${existing.name}" has ${used} product(s). Move them to another category first.`);
      e.status = 409; throw e;
    }
    const target = db.prepare("SELECT slug FROM categories WHERE slug = ?").get(String(reassignTo));
    if (!target) { const e = new Error("Reassign target category not found."); e.status = 404; throw e; }
    db.prepare("UPDATE products SET category = ?, updated_at = ? WHERE category = ?").run(target.slug, now(), slug);
  }
  db.prepare("DELETE FROM categories WHERE slug = ?").run(slug);
  bus.publish("categories");
  return { ok: true, moved: used };
}

/* ---------- admin CRUD ---------- */
function validateProductInput(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (!partial || body.productName !== undefined) {
    const v = String(body.productName || "").trim();
    if (v.length < 2 || v.length > 120) errors.push("Product name must be 2–120 characters.");
    else out.product_name = v;
  }
  if (!partial || body.category !== undefined) {
    const v = String(body.category || "").trim().toLowerCase();
    if (!v || v.length > 40) errors.push("Category is required (max 40 chars).");
    else out.category = v;
  }
  if (!partial || body.description !== undefined) {
    out.description = String(body.description || "").trim().slice(0, 2000);
  }
  if (!partial || body.price !== undefined) {
    const n = Number(body.price);
    if (!Number.isFinite(n) || n < 0) errors.push("Price must be a number ≥ 0.");
    else if (n > 10000000) errors.push("Price looks too large.");
    else out.price = Math.round(n * 100) / 100;
  }
  if (body.mrp !== undefined) {
    const n = body.mrp === null || body.mrp === "" ? null : Number(body.mrp);
    if (n !== null && (!Number.isFinite(n) || n < 0)) errors.push("MRP must be a number ≥ 0.");
    else out.mrp = n === null ? null : Math.round(n * 100) / 100;
  }
  if (!partial || body.stockQuantity !== undefined) {
    const n = Number(body.stockQuantity ?? 0);
    if (!Number.isInteger(n) || n < 0) errors.push("Stock must be a whole number ≥ 0 (no negatives).");
    else if (n > 1000000) errors.push("Stock looks too large.");
    else out.stock_quantity = n;
  }
  if (!partial || body.imageUrl !== undefined) {
    const v = body.imageUrl == null ? null : String(body.imageUrl).trim();
    if (v && !/^(https?:\/\/|\/|data:image\/)/i.test(v)) errors.push("Image must be a URL, a /path, or a data:image URI.");
    else out.image_url = v;
  }
  if (body.emoji !== undefined) out.emoji = body.emoji ? String(body.emoji).slice(0, 8) : null;
  if (body.variants !== undefined) {
    if (body.variants === null || body.variants === "") {
      out.variants_json = null;
      out.variant_label = null;
    } else if (!Array.isArray(body.variants)) {
      errors.push("Variants must be a list.");
    } else if (body.variants.length > 12) {
      errors.push("At most 12 variants per product.");
    } else {
      const seen = new Set();
      const clean = [];
      for (const v of body.variants) {
        const sku = String((v && v.sku) || "").trim();
        const label = String((v && (v.label || v.size)) || "").trim();
        const price = Number(v && v.price);
        const stock = Number(v && v.stock);
        if (!sku || !label || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0 || seen.has(sku)) {
          errors.push("Each variant needs a unique sku, label, valid price and stock ≥ 0.");
          break;
        }
        seen.add(sku);
        clean.push({ sku, size: String((v && v.size) || label), label, price: Math.round(price * 100) / 100, stock });
      }
      if (clean.length) { out.variants_json = JSON.stringify(clean); out.variant_label = clean[0].label; }
    }
  }
  if (body.variantLabel !== undefined) out.variant_label = body.variantLabel ? String(body.variantLabel).slice(0, 80) : null;
  if (body.meta !== undefined) {
    if (body.meta === null) out.meta_json = null;
    else if (typeof body.meta === "object" && !Array.isArray(body.meta)) out.meta_json = JSON.stringify(body.meta);
    else errors.push("Invalid metadata payload.");
  }

  if (body.status !== undefined) {
    const v = String(body.status).toUpperCase();
    if (!["ACTIVE", "OUT_OF_STOCK", "ARCHIVED"].includes(v)) errors.push("Invalid status.");
    else out.status = v;
  }
  return { errors, values: out };
}

function create(body) {
  const { errors, values } = validateProductInput(body);
  if (errors.length) { const e = new Error(errors.join(" ")); e.status = 400; throw e; }
  if (values.mrp != null && values.price != null && values.mrp < values.price) {
    const e = new Error("MRP must be greater than or equal to the selling price."); e.status = 400; throw e;
  }

  let id = body.sku ? String(body.sku).trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") : "";
  if (!id) id = slugify(values.product_name);
  id = uniqueProductId(id);

  const status = values.status || (values.stock_quantity > 0 ? "ACTIVE" : "OUT_OF_STOCK");
  db.prepare(
    `INSERT INTO products (id, product_name, category, description, price, mrp, stock_quantity, image_url, emoji, meta_json, status, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, values.product_name, values.category, values.description || "", values.price, values.mrp ?? null,
        values.stock_quantity ?? 0, values.image_url || null, values.emoji || null, values.meta_json ?? null, status, body.sortOrder ?? 1000);
  bus.publish("catalog");
  return getPublic(id);
}

function update(id, body) {
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!existing) { const e = new Error("Product not found."); e.status = 404; throw e; }
  const { errors, values } = validateProductInput(body, { partial: true });
  if (errors.length) { const e = new Error(errors.join(" ")); e.status = 400; throw e; }
  if (!Object.keys(values).length) { const e = new Error("Nothing to update."); e.status = 400; throw e; }

  /* merge metadata with the existing row instead of replacing it blindly */
  if (values.meta_json !== undefined && values.meta_json !== null) {
    let prev = {};
    try { prev = existing.meta_json ? JSON.parse(existing.meta_json) : {}; } catch (_e) { prev = {}; }
    const patch = JSON.parse(values.meta_json);
    values.meta_json = JSON.stringify({ ...prev, ...patch });
  }

  /* validate merged money fields (price vs MRP) before touching the row */
  const finalPrice = values.price !== undefined ? values.price : existing.price;
  const finalMrp = values.mrp !== undefined ? values.mrp : (existing.mrp == null ? null : existing.mrp);
  if (finalMrp != null && finalMrp < finalPrice) {
    const e = new Error("MRP must be greater than or equal to the selling price."); e.status = 400; throw e;
  }

  const sets = Object.keys(values).map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE products SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...Object.values(values), now(), id);

  /* keep status consistent with stock — but never resurrect a deactivated product */
  if (values.status === undefined && values.stock_quantity !== undefined && existing.status !== "ARCHIVED") {
    db.prepare("UPDATE products SET status = ? WHERE id = ?")
      .run(values.stock_quantity > 0 ? "ACTIVE" : "OUT_OF_STOCK", id);
  }
  bus.publish("catalog");
  return getPublic(id);
}

function remove(id) {
  const r = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
  if (!r) { const e = new Error("Product not found."); e.status = 404; throw e; }
  const sold = db.prepare("SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?").get(id).n;
  if (sold > 0) {
    /* preserve order history: archive instead of hard delete */
    db.prepare("UPDATE products SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id);
    bus.publish("catalog");
    return { archived: true };
  }
  db.prepare("DELETE FROM products WHERE id = ?").run(id);
  bus.publish("catalog");
  return { archived: false };
}

function setStock(id, stockQuantity) {
  return update(id, { stockQuantity });
}

function setPrice(id, price) {
  return update(id, { price });
}

module.exports = {
  listPublic, getPublic, categories, create, update, remove, setStock, setPrice, publicView,
  createCategory, updateCategory, deleteCategory,
};
