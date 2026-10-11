/* UVID Store API on Cloudflare Workers + D1.
 * Customers, products, orders, categories and compressed product images share
 * the same D1 database, so edits made in /admin are visible in the storefront.
 */

const GMAIL_RE = /^[a-z0-9._%+-]+@gmail\.com$/i;
const IMAGE_LIMIT = 1_400_000; // stay below D1's 2 MB row limit with metadata
const COOKIE = "uvid_session";
const encoder = new TextEncoder();

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
});
const error = (message, status = 400) => json({ error: message }, status);
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const clean = (v, max = 2000) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const parseJson = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };

function cookieValue(request, name) {
  return (request.headers.get("Cookie") || "").split(";").map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))?.slice(name.length + 1) || "";
}
function b64url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64url(text) {
  const value = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(value + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
async function issueSession(env, user) {
  const payload = b64url(encoder.encode(JSON.stringify({ ...user, exp: Date.now() + 7 * 86400000 })));
  return payload + "." + b64url(await hmac(env.SESSION_SECRET, payload));
}
async function verifySession(env, token) {
  if (!token || !env.SESSION_SECRET || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = b64url(await hmac(env.SESSION_SECRET, parts[0]));
  if (expected.length !== parts[1].length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ parts[1].charCodeAt(i);
  if (diff) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    if (!data.exp || Date.now() >= data.exp || !["ADMIN", "CUSTOMER"].includes(data.role)) return null;
    return data;
  } catch { return null; }
}
function cookieHeader(token, maxAge = 604800) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function checkOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  let allowed = String(env.PUBLIC_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    if (allowed.includes(new URL(origin).origin)) return true;
    return new URL(origin).origin === new URL(request.url).origin;
  } catch { return false; }
}
async function bodyJson(request, max = 2_600_000) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > max) throw Object.assign(new Error("Request is too large."), { status: 413 });
  try { return await request.json(); } catch { throw Object.assign(new Error("Invalid JSON request."), { status: 400 }); }
}
function need(user, role) {
  if (!user) return error("Please sign in to continue.", 401);
  if (role && user.role !== role) return error("Admin access required.", 403);
  return null;
}
async function audit(env, request, user, action, target = null, detail = {}) {
  try {
    await env.DB.prepare("INSERT INTO audit_logs (actor_id,actor_name,role,action,target,detail,ip,user_agent) VALUES (?,?,?,?,?,?,?,?)")
      .bind(user?.id == null ? null : String(user.id), user?.name || null, user?.role || null, action, target,
        JSON.stringify(detail), request.headers.get("CF-Connecting-IP"), request.headers.get("User-Agent")?.slice(0, 250) || null).run();
  } catch { /* audit failures must not fail a product save */ }
}

function parseMeta(row) { return parseJson(row.meta_json, {}) || {}; }
function imageView(row) {
  return { id: row.id, productId: row.product_id, variantKey: row.variant_key || null,
    url: `/api/images/${row.id}`, mime: row.mime, byteSize: row.byte_size,
    width: row.width || null, height: row.height || null, altText: row.alt_text || null, sortOrder: row.sort_order };
}
function productView(row, images = []) {
  const meta = parseMeta(row);
  const variants = parseJson(row.variants_json, null);
  const variantStock = Array.isArray(variants) ? variants.reduce((n, v) => n + (Number(v.stock) || 0), 0) : null;
  return {
    id: row.id, productName: row.product_name, category: row.category, description: row.description,
    price: row.price, mrp: row.mrp, stockQuantity: row.stock_quantity,
    imageUrl: row.image_url, images: images.map(imageView), emoji: row.emoji || null,
    variantLabel: row.variant_label || null, variants: Array.isArray(variants) ? variants : undefined,
    status: row.status, inStock: row.status !== "OUT_OF_STOCK" && (variantStock === null ? row.stock_quantity > 0 : variantStock > 0),
    createdAt: row.created_at, updatedAt: row.updated_at,
    brand: meta.brand || null, rating: meta.rating ?? null, ratingCount: meta.ratingCount || 0,
    tags: Array.isArray(meta.tags) ? meta.tags : [], specs: meta.specs || null,
    highlights: Array.isArray(meta.highlights) ? meta.highlights : null,
    bg: meta.bg || null, ink: meta.ink || null, parent: meta.parent || null,
  };
}
async function productRows(env, admin = false) {
  const sql = admin ? "SELECT * FROM products ORDER BY sort_order, product_name" : "SELECT * FROM products WHERE status IN ('ACTIVE','OUT_OF_STOCK') ORDER BY sort_order, product_name";
  const rows = (await env.DB.prepare(sql).all()).results || [];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const imageRows = (await env.DB.prepare(`SELECT * FROM product_images WHERE product_id IN (${placeholders}) ORDER BY sort_order,id`).bind(...ids).all()).results || [];
  const byProduct = new Map();
  for (const im of imageRows) {
    const arr = byProduct.get(im.product_id) || [];
    arr.push(im); byProduct.set(im.product_id, arr);
  }
  return rows.map((r) => productView(r, byProduct.get(r.id) || []));
}
async function categories(env) {
  const rows = (await env.DB.prepare(
    `SELECT c.slug,c.name,c.emoji,c.blurb,c.image_url,c.sort_order,
       (SELECT COUNT(*) FROM products p WHERE p.category=c.slug AND p.status!='ARCHIVED') AS count
     FROM categories c ORDER BY c.sort_order,c.name`).all()).results || [];
  if (rows.length) return rows;
  return (await env.DB.prepare("SELECT category AS slug,category AS name,COUNT(*) AS count FROM products WHERE status!='ARCHIVED' GROUP BY category ORDER BY category").all()).results || [];
}
const slugify = (s) => clean(s, 120).toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "product";

async function uniqueProductId(env, base) {
  const cleanBase = String(base || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "product";
  let id = cleanBase, n = 2;
  while (await env.DB.prepare("SELECT id FROM products WHERE id=?").bind(id).first()) id = `${cleanBase}-${n++}`;
  return id;
}
function productInput(body, partial = false) {
  const values = {};
  if (!partial || body.productName !== undefined) {
    const v = clean(body.productName, 120); if (v.length < 2) throw Object.assign(new Error("Product name must be 2–120 characters."), { status: 400 }); values.product_name = v;
  }
  if (!partial || body.category !== undefined) {
    const v = clean(body.category, 40).toLowerCase(); if (!v) throw Object.assign(new Error("Category is required."), { status: 400 }); values.category = v;
  }
  if (!partial || body.description !== undefined) values.description = clean(body.description, 2000);
  if (!partial || body.price !== undefined) {
    const n = Number(body.price); if (!Number.isFinite(n) || n < 0 || n > 10000000) throw Object.assign(new Error("Enter a valid product price."), { status: 400 }); values.price = Math.round(n * 100) / 100;
  }
  if (body.mrp !== undefined) {
    const n = body.mrp === null || body.mrp === "" ? null : Number(body.mrp);
    if (n !== null && (!Number.isFinite(n) || n < 0)) throw Object.assign(new Error("Enter a valid MRP."), { status: 400 }); values.mrp = n === null ? null : Math.round(n * 100) / 100;
  }
  if (!partial || body.stockQuantity !== undefined) {
    const n = Number(body.stockQuantity ?? 0); if (!Number.isInteger(n) || n < 0 || n > 1000000) throw Object.assign(new Error("Stock must be a whole number 0 or higher."), { status: 400 }); values.stock_quantity = n;
  }
  if (!partial || body.imageUrl !== undefined) {
    const v = body.imageUrl == null ? null : clean(body.imageUrl, 2000);
    if (v && !/^(https?:\/\/|\/|data:image\/)/i.test(v)) throw Object.assign(new Error("Image must be a valid image URL."), { status: 400 }); values.image_url = v;
  }
  if (body.emoji !== undefined) values.emoji = clean(body.emoji, 8) || null;
  if (body.variantLabel !== undefined) values.variant_label = clean(body.variantLabel, 80) || null;
  if (body.variants !== undefined) {
    if (body.variants == null || body.variants === "") { values.variants_json = null; values.variant_label = null; }
    else if (!Array.isArray(body.variants) || body.variants.length > 12) throw Object.assign(new Error("Variants must be a list with at most 12 entries."), { status: 400 });
    else { values.variants_json = JSON.stringify(body.variants); if (body.variants[0]) values.variant_label = clean(body.variants[0].label || body.variants[0].size, 80); }
  }
  if (body.meta !== undefined) {
    if (body.meta === null) values.meta_json = null;
    else if (typeof body.meta !== "object" || Array.isArray(body.meta)) throw Object.assign(new Error("Invalid product metadata."), { status: 400 });
    else values.meta_json = JSON.stringify(body.meta);
  }
  if (body.status !== undefined) {
    const v = clean(body.status, 20).toUpperCase(); if (!["ACTIVE", "OUT_OF_STOCK", "ARCHIVED"].includes(v)) throw Object.assign(new Error("Invalid product status."), { status: 400 }); values.status = v;
  }
  return values;
}
async function getProduct(env, id) {
  const row = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
  if (!row || row.status === "ARCHIVED") return null;
  const images = (await env.DB.prepare("SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order,id").bind(id).all()).results || [];
  return productView(row, images);
}
async function createProduct(env, body) {
  const values = productInput(body);
  if (values.mrp != null && values.mrp < values.price) throw Object.assign(new Error("MRP must be equal to or higher than price."), { status: 400 });
  const id = await uniqueProductId(env, body.sku ? clean(body.sku, 80) : slugify(values.product_name));
  values.status = values.status || (values.stock_quantity > 0 ? "ACTIVE" : "OUT_OF_STOCK");
  const cols = ["id", ...Object.keys(values), "sort_order"];
  const vals = [id, ...Object.values(values), Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 1000];
  await env.DB.prepare(`INSERT INTO products (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...vals).run();
  return getProduct(env, id);
}
async function updateProduct(env, id, body) {
  const old = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
  if (!old) throw Object.assign(new Error("Product not found."), { status: 404 });
  const values = productInput(body, true);
  if (!Object.keys(values).length) throw Object.assign(new Error("Nothing to update."), { status: 400 });
  if (values.meta_json && old.meta_json) values.meta_json = JSON.stringify({ ...parseJson(old.meta_json, {}), ...JSON.parse(values.meta_json) });
  const price = values.price === undefined ? old.price : values.price;
  const mrp = values.mrp === undefined ? old.mrp : values.mrp;
  if (mrp != null && mrp < price) throw Object.assign(new Error("MRP must be equal to or higher than price."), { status: 400 });
  if (values.stock_quantity !== undefined && values.status === undefined && old.status !== "ARCHIVED") values.status = values.stock_quantity > 0 ? "ACTIVE" : "OUT_OF_STOCK";
  const sets = Object.keys(values).map((k) => `${k}=?`);
  await env.DB.prepare(`UPDATE products SET ${sets.join(",")},updated_at=? WHERE id=?`).bind(...Object.values(values), now(), id).run();
  return getProduct(env, id);
}

function mimeExtension(mime) { return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[mime] || null; }
function decodeImage(dataUri) {
  const match = /^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUri || ""));
  if (!match) throw Object.assign(new Error("Send a JPEG, PNG, WebP or GIF image."), { status: 400 });
  const declared = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  let binary;
  try { binary = atob(match[2].replace(/\s/g, "")); } catch { throw Object.assign(new Error("The image data is invalid."), { status: 400 }); }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (!bytes.length) throw Object.assign(new Error("The image is empty."), { status: 400 });
  if (bytes.length > IMAGE_LIMIT) throw Object.assign(new Error("Compressed image is too large for free D1 storage. Choose a smaller photo (under 1.4 MB)."), { status: 413 });
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length > 8 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n);
  const webp = bytes.length > 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
  const gif = String.fromCharCode(...bytes.slice(0,4)) === "GIF8";
  const detected = jpg ? "jpeg" : png ? "png" : webp ? "webp" : gif ? "gif" : null;
  if (!detected || detected !== declared) throw Object.assign(new Error("The image content does not match its file type."), { status: 400 });
  return { bytes, mime: `image/${detected}` };
}
async function hashBytes(bytes) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) => v.toString(16).padStart(2, "0")).join(""); }
async function addProductImage(env, productId, body) {
  if (!(await env.DB.prepare("SELECT id FROM products WHERE id=?").bind(productId).first())) throw Object.assign(new Error("Product not found."), { status: 404 });
  const variant = clean(body.variantKey || body.variant || "", 100) || null;
  const { bytes, mime } = decodeImage(body.image || body.dataUri);
  const sha = await hashBytes(bytes);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM product_images WHERE product_id=?").bind(productId).first();
  if (Number(count?.n || 0) >= 24) throw Object.assign(new Error("This product already has 24 images."), { status: 409 });
  const dupe = await env.DB.prepare("SELECT * FROM product_images WHERE product_id=? AND COALESCE(variant_key,'')=COALESCE(?,'') AND sha256=?").bind(productId, variant, sha).first();
  if (dupe) return imageView(dupe);
  const order = await env.DB.prepare("SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM product_images WHERE product_id=?").bind(productId).first();
  await env.DB.prepare("INSERT OR IGNORE INTO image_blobs (sha256,mime,byte_size,data) VALUES (?,?,?,?)").bind(sha, mime, bytes.length, bytes).run();
  const info = await env.DB.prepare("INSERT INTO product_images (product_id,variant_key,sha256,mime,byte_size,alt_text,sort_order) VALUES (?,?,?,?,?,?,?)")
    .bind(productId, variant, sha, mime, bytes.length, clean(body.altText, 160) || null, Number(order?.n || 0)).run();
  const imageId = info.meta?.last_row_id;
  if (Number(order?.n || 0) === 0) await env.DB.prepare("UPDATE products SET image_url=?,updated_at=? WHERE id=?").bind(`/api/images/${imageId}`, now(), productId).run();
  return imageView(await env.DB.prepare("SELECT * FROM product_images WHERE id=?").bind(imageId).first());
}
async function productImages(env, id) { return (await env.DB.prepare("SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order,id").bind(id).all()).results || []; }
async function updatePrimary(env, id) {
  const first = await env.DB.prepare("SELECT id FROM product_images WHERE product_id=? ORDER BY sort_order,id LIMIT 1").bind(id).first();
  const row = await env.DB.prepare("SELECT image_url FROM products WHERE id=?").bind(id).first();
  if (first) await env.DB.prepare("UPDATE products SET image_url=?,updated_at=? WHERE id=?").bind(`/api/images/${first.id}`, now(), id).run();
  else if (row?.image_url?.startsWith("/api/images/")) await env.DB.prepare("UPDATE products SET image_url=NULL,updated_at=? WHERE id=?").bind(now(), id).run();
}
async function stats(env) {
  const q = async (sql) => Number((await env.DB.prepare(sql).first())?.n || 0);
  const products = await q("SELECT COUNT(*) n FROM products WHERE status!='ARCHIVED'");
  const outOfStock = await q("SELECT COUNT(*) n FROM products WHERE status!='ARCHIVED' AND (status='OUT_OF_STOCK' OR stock_quantity=0)");
  const recentProducts = (await env.DB.prepare("SELECT id,product_name,category,price,stock_quantity,status,image_url,updated_at FROM products WHERE status!='ARCHIVED' ORDER BY updated_at DESC,created_at DESC LIMIT 6").all()).results || [];
  const recentOrders = (await env.DB.prepare("SELECT o.id,o.total_amount,o.status,o.created_at,u.name AS customerName,u.mobile_number FROM orders o LEFT JOIN users u ON u.id=o.customer_id ORDER BY o.created_at DESC LIMIT 6").all()).results || [];
  return { products, inStock: products - outOfStock, outOfStock,
    lowStock: await q("SELECT COUNT(*) n FROM products WHERE stock_quantity>0 AND stock_quantity<=5 AND status!='ARCHIVED'"),
    inactive: await q("SELECT COUNT(*) n FROM products WHERE status='ARCHIVED'"),
    orders: await q("SELECT COUNT(*) n FROM orders"),
    openOrders: await q("SELECT COUNT(*) n FROM orders WHERE status IN ('PLACED','PACKED','SHIPPED','OUT_FOR_DELIVERY')"),
    revenue: Number((await env.DB.prepare("SELECT COALESCE(SUM(total_amount),0) n FROM orders WHERE status!='CANCELLED'").first())?.n || 0),
    customers: await q("SELECT COUNT(*) n FROM users WHERE role='CUSTOMER'"), recentProducts, recentOrders };
}
async function orderList(env, customerId = null, status = null) {
  let sql = "SELECT * FROM orders", args = [];
  if (customerId != null) { sql += " WHERE customer_id=?"; args.push(customerId); }
  else if (status) { sql += " WHERE status=?"; args.push(status); }
  sql += " ORDER BY created_at DESC LIMIT 200";
  const orders = (await env.DB.prepare(sql).bind(...args).all()).results || [];
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const rows = (await env.DB.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).bind(...ids).all()).results || [];
  const byOrder = new Map(); for (const row of rows) { const a = byOrder.get(row.order_id) || []; a.push(row); byOrder.set(row.order_id, a); }
  return orders.map((o) => ({ ...o, items: byOrder.get(o.id) || [] }));
}
async function placeOrder(env, user, body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 40) throw Object.assign(new Error("Add 1–40 items to the order."), { status: 400 });
  const address = body.address && typeof body.address === "object" ? body.address : {};
  if (!clean(address.line, 300) || !clean(address.city, 100) || !/^\d{6}$/.test(String(address.pin || ""))) throw Object.assign(new Error("Enter a delivery address, city and 6-digit PIN."), { status: 400 });
  const wants = new Map();
  for (const item of items) {
    const id = clean(item.productId || item.id, 120); const qty = Number(item.quantity ?? item.qty);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 99) throw Object.assign(new Error("One of the cart items is invalid."), { status: 400 });
    wants.set(id, (wants.get(id) || 0) + qty);
  }
  const products = (await env.DB.prepare(`SELECT * FROM products WHERE id IN (${[...wants.keys()].map(() => "?").join(",")})`).bind(...wants.keys()).all()).results || [];
  const byId = new Map(products.map((p) => [p.id,p]));
  let subtotal = 0; const lines = [];
  for (const [id, qty] of wants) {
    const p = byId.get(id); if (!p || p.status === "ARCHIVED") throw Object.assign(new Error("A cart item is no longer available."), { status: 409 });
    if (p.status === "OUT_OF_STOCK" || p.stock_quantity < qty) throw Object.assign(new Error(`${p.product_name} does not have enough stock.`), { status: 409 });
    subtotal += p.price * qty; lines.push({ p, qty });
  }
  const coupon = clean(body.coupon, 30).toUpperCase() || null;
  let discount = 0; let freeShip = false;
  if (coupon === "PAPER10") discount = Math.min(subtotal * .1, 150);
  else if (coupon === "FIRST50" && subtotal >= 199) discount = 50;
  else if (coupon === "DESK200" && subtotal >= 999) discount = 200;
  else if (coupon === "FREESHIP") freeShip = true;
  else if (coupon) throw Object.assign(new Error("Coupon is invalid or the minimum order is not reached."), { status: 400 });
  const shipping = freeShip || subtotal >= 499 ? 0 : 49;
  const id = "UV" + Date.now().toString(36).toUpperCase() + Math.floor(100 + Math.random() * 900);
  const method = ["COD", "UPI", "CARD", "NETBANKING", "WALLET"].includes(String(body.paymentMethod || "COD").toUpperCase()) ? String(body.paymentMethod || "COD").toUpperCase() : "COD";
  const batches = [env.DB.prepare("INSERT INTO orders (id,customer_id,total_amount,status,payment_method,payment_status,address_json,eta,coupon,discount,shipping) VALUES (?,?,?,'PLACED',?,?,?,?,?,?,?)")
    .bind(id,user.id,Math.round((subtotal-discount+shipping)*100)/100,method,"PENDING",JSON.stringify(address),new Date(Date.now()+3*86400000).toISOString().slice(0,10),coupon,discount,shipping)];
  for (const line of lines) {
    batches.push(env.DB.prepare("INSERT INTO order_items (order_id,product_id,product_name,quantity,price_at_purchase,image_url) VALUES (?,?,?,?,?,?)").bind(id,line.p.id,line.p.product_name,line.qty,line.p.price,line.p.image_url));
    batches.push(env.DB.prepare("UPDATE products SET stock_quantity=stock_quantity-?,status=CASE WHEN stock_quantity-?<=0 THEN 'OUT_OF_STOCK' ELSE status END,updated_at=? WHERE id=?").bind(line.qty,line.qty,now(),line.p.id));
  }
  await env.DB.batch(batches);
  return { order: (await orderList(env,user.id)).find((o) => o.id === id), items: lines.map((l) => ({ productId:l.p.id,name:l.p.product_name,qty:l.qty,priceAtPurchase:l.p.price,imageUrl:l.p.image_url })) };
}

async function handleApi(request, env, user, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;
  let body;
  const readBody = async () => { if (body === undefined) body = await bodyJson(request); return body; };
  const adminOnly = need(user, "ADMIN");
  const customerOnly = need(user, "CUSTOMER");

  if (path === "/api/auth/me" && method === "GET") return user ? json({ user }) : error("Not logged in.", 401);
  if (path === "/api/auth/logout" && method === "POST") return json({ ok:true },200,{"Set-Cookie":cookieHeader("",0)});
  if (path === "/api/auth/email/login" && method === "POST") {
    const b = await readBody(); const email = clean(b.email, 200).toLowerCase();
    if (!GMAIL_RE.test(email)) return error("Enter a valid Gmail address, such as name@gmail.com.");
    let row = await env.DB.prepare("SELECT id,email,name,role FROM users WHERE email=? COLLATE NOCASE").bind(email).first();
    if (row && row.role !== "CUSTOMER") return error("This Gmail address is reserved for admin sign-in.",403);
    if (!row) {
      const name = email.split("@")[0].replace(/[._+%-]+/g," ").trim() || "Customer";
      const out = await env.DB.prepare("INSERT INTO users (name,email,role) VALUES (?,?,'CUSTOMER')").bind(name,email).run();
      row = { id: out.meta?.last_row_id, email, name, role:"CUSTOMER" };
    }
    const token = await issueSession(env,{id:row.id,email:row.email,name:row.name,role:row.role});
    return json({ok:true,user:{id:row.id,email:row.email,name:row.name,role:row.role}},200,{"Set-Cookie":cookieHeader(token)});
  }
  if (path === "/api/auth/admin/login" && method === "POST") {
    const b = await readBody(); const email = clean(b.email,200).toLowerCase(); const password = String(b.password || "");
    if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) return error("Admin sign-in is not configured on the backend yet.",503);
    if (email !== String(env.ADMIN_EMAIL).toLowerCase() || password !== env.ADMIN_PASSWORD) return error("Invalid admin credentials.",401);
    const token = await issueSession(env,{id:"admin",email:env.ADMIN_EMAIL,name:"UVID Admin",role:"ADMIN"});
    return json({ok:true,user:{id:"admin",email:env.ADMIN_EMAIL,name:"UVID Admin",role:"ADMIN"}},200,{"Set-Cookie":cookieHeader(token)});
  }
  if (path === "/api/auth/admin/mfa/status" && method === "GET") return adminOnly || json({enabled:false});
  if (path.startsWith("/api/auth/admin/mfa/") && method === "POST") return adminOnly || error("Two-factor setup is not available on this free Worker backend.",501);

  if (path === "/api/products" && method === "GET") {
    let rows = await productRows(env); const category = url.searchParams.get("category"); const q = (url.searchParams.get("q") || "").toLowerCase();
    if (category) rows = rows.filter((p) => p.category === category);
    if (q) rows = rows.filter((p) => (p.productName + " " + p.description).toLowerCase().includes(q));
    if (url.searchParams.get("inStock") === "1") rows = rows.filter((p) => p.inStock);
    return json({products:rows});
  }
  if (path === "/api/products/categories" && method === "GET") return json({categories:await categories(env)});
  if (path.startsWith("/api/products/") && method === "GET") {
    const p = await getProduct(env, decodeURIComponent(path.slice("/api/products/".length)));
    return p ? json({product:p}) : error("Product not found.",404);
  }
  if (path === "/api/events" && method === "GET") return new Response("event: hello\ndata: {}\n\n",{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache"}});

  if (path === "/api/admin/products" && method === "GET") return adminOnly || json({products:await productRows(env,true)});
  if (path === "/api/admin/products" && method === "POST") {
    if (adminOnly) return adminOnly; const p = await createProduct(env,await readBody()); await audit(env,request,user,"product.create",p.id,{name:p.productName}); return json({ok:true,product:p},201);
  }
  let match = path.match(/^\/api\/admin\/products\/([^/]+)(?:\/(stock|price))?$/);
  if (match && method === "PUT") {
    if (adminOnly) return adminOnly; const id = decodeURIComponent(match[1]); const b=await readBody();
    const update = match[2] === "stock" ? {stockQuantity:b.stockQuantity} : match[2] === "price" ? {price:b.price} : b;
    const p=await updateProduct(env,id,update); await audit(env,request,user,"product.update",id,{fields:Object.keys(update)}); return json({ok:true,product:p});
  }
  if (match && method === "DELETE" && !match[2]) {
    if (adminOnly) return adminOnly; const id=decodeURIComponent(match[1]);
    const sold=await env.DB.prepare("SELECT COUNT(*) AS n FROM order_items WHERE product_id=?").bind(id).first();
    if (!(await env.DB.prepare("SELECT id FROM products WHERE id=?").bind(id).first())) return error("Product not found.",404);
    if (Number(sold?.n||0)>0) await env.DB.prepare("UPDATE products SET status='ARCHIVED',updated_at=? WHERE id=?").bind(now(),id).run();
    else await env.DB.prepare("DELETE FROM products WHERE id=?").bind(id).run();
    await audit(env,request,user,"product.delete",id,{}); return json({ok:true,archived:Number(sold?.n||0)>0});
  }
  if (path === "/api/admin/categories" && method === "GET") return adminOnly || json({categories:await categories(env)});
  if (path === "/api/admin/categories" && method === "POST") {
    if (adminOnly) return adminOnly; const b=await readBody(); const name=clean(b.name,40); if(name.length<2) return error("Category name must be 2–40 characters.");
    const slug=clean(b.slug,40).toLowerCase()||slugify(name);
    try { await env.DB.prepare("INSERT INTO categories (slug,name,emoji,blurb,image_url,sort_order) VALUES (?,?,?,?,?,?)").bind(slug,name,clean(b.emoji,8)||null,clean(b.blurb,120)||null,clean(b.imageUrl,500)||null,Number(b.sortOrder)||100).run(); }
    catch { return error("A category with this name already exists.",409); }
    return json({ok:true,category:await env.DB.prepare("SELECT * FROM categories WHERE slug=?").bind(slug).first()},201);
  }
  match = path.match(/^\/api\/admin\/categories\/([^/]+)$/);
  if (match && method === "PUT") {
    if (adminOnly) return adminOnly; const slug=decodeURIComponent(match[1]), b=await readBody();
    const cols={name:"name",emoji:"emoji",blurb:"blurb",imageUrl:"image_url",sortOrder:"sort_order"}; const sets=[],args=[];
    for(const [input,col] of Object.entries(cols)) if(b[input]!==undefined){sets.push(`${col}=?`);args.push(input==="sortOrder"?Number(b[input]):clean(b[input],input==="name"?40:500)||null);}
    if(!sets.length) return error("Nothing to update."); args.push(now(),slug);
    await env.DB.prepare(`UPDATE categories SET ${sets.join(",")},updated_at=? WHERE slug=?`).bind(...args).run();
    return json({ok:true,category:await env.DB.prepare("SELECT * FROM categories WHERE slug=?").bind(slug).first()});
  }
  if (match && method === "DELETE") {
    if (adminOnly) return adminOnly; const slug=decodeURIComponent(match[1]), b=await readBody().catch(()=>({}));
    const used=await env.DB.prepare("SELECT COUNT(*) AS n FROM products WHERE category=? AND status!='ARCHIVED'").bind(slug).first();
    if(Number(used?.n||0)>0){ if(!b.reassignTo) return error("Move the category's products first.",409); await env.DB.prepare("UPDATE products SET category=?,updated_at=? WHERE category=?").bind(clean(b.reassignTo,40),now(),slug).run(); }
    await env.DB.prepare("DELETE FROM categories WHERE slug=?").bind(slug).run(); return json({ok:true,moved:Number(used?.n||0)});
  }
  if (path === "/api/admin/upload" && method === "POST") {
    if (adminOnly) return adminOnly; const b=await readBody(); const {bytes,mime}=decodeImage(b.image); const id=crypto.randomUUID();
    await env.DB.prepare("INSERT INTO uploaded_images (id,mime,byte_size,data) VALUES (?,?,?,?)").bind(id,mime,bytes.length,bytes).run();
    return json({ok:true,url:`/uploads/${id}`},201);
  }
  if (path === "/api/admin/stats" && method === "GET") return adminOnly || json({stats:await stats(env)});
  if (path === "/api/admin/orders" && method === "GET") return adminOnly || json({orders:await orderList(env,null,url.searchParams.get("status"))});
  match = path.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
  if(match && method === "PUT"){
    if(adminOnly) return adminOnly; const b=await readBody(),status=clean(b.status,30).toUpperCase();
    if(!["PLACED","PACKED","SHIPPED","OUT_FOR_DELIVERY","DELIVERED","CANCELLED"].includes(status)) return error("Invalid order status.");
    await env.DB.prepare("UPDATE orders SET status=?,updated_at=? WHERE id=?").bind(status,now(),decodeURIComponent(match[1])).run(); return json({ok:true});
  }
  if(path==="/api/admin/customers" && method==="GET") return adminOnly || json({customers:(await env.DB.prepare("SELECT id,name,email,mobile_number,created_at FROM users WHERE role='CUSTOMER' ORDER BY created_at DESC LIMIT 500").all()).results||[]});
  if(path==="/api/admin/audit" && method==="GET") return adminOnly || json({entries:(await env.DB.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?").bind(Math.min(100,Math.max(1,Number(url.searchParams.get("limit"))||25))).all()).results||[]});
  if(path==="/api/admin/seminar" && method==="GET") return adminOnly || json({seminar:await env.DB.prepare("SELECT * FROM seminar_details WHERE id=1").first(),registrations:(await env.DB.prepare("SELECT * FROM seminar_registrations ORDER BY created_at DESC LIMIT 500").all()).results||[]});
  if(path==="/api/admin/seminar/details" && method==="POST"){
    if(adminOnly) return adminOnly; const b=await readBody();
    await env.DB.prepare("UPDATE seminar_details SET title=?,description=?,event_date=?,event_time=?,location=?,meeting_url=?,speaker=?,agenda=?,contact_email=?,updated_at=? WHERE id=1")
      .bind(clean(b.title,200),clean(b.description,2000),clean(b.date,100),clean(b.time,100),clean(b.location,300),clean(b.meetingUrl,500),clean(b.speaker,200),Array.isArray(b.agenda)?b.agenda.map(x=>clean(x,200)).join("\n"):clean(b.agenda,2000),clean(b.contactEmail,200),now()).run();
    return json({ok:true});
  }

  if(path==="/api/orders" && method==="POST"){
    if(customerOnly) return customerOnly; const out=await placeOrder(env,user,await readBody()); return json({ok:true,...out},201);
  }
  if(path==="/api/orders" && method==="GET") return customerOnly || json({orders:await orderList(env,user.id)});
  match=path.match(/^\/api\/orders\/([^/]+)(?:\/cancel)?$/);
  if(match && method==="POST" && path.endsWith("/cancel")){
    if(customerOnly) return customerOnly; const id=decodeURIComponent(match[1]);
    const order=await env.DB.prepare("SELECT * FROM orders WHERE id=? AND customer_id=?").bind(id,user.id).first();
    if(!order) return error("Order not found.",404); if(order.status!=="PLACED") return error("This order can no longer be cancelled.",409);
    const items=(await env.DB.prepare("SELECT * FROM order_items WHERE order_id=?").bind(id).all()).results||[];
    const batch=[env.DB.prepare("UPDATE orders SET status='CANCELLED',updated_at=? WHERE id=?").bind(now(),id),...items.map(i=>env.DB.prepare("UPDATE products SET stock_quantity=stock_quantity+?,status='ACTIVE',updated_at=? WHERE id=?").bind(i.quantity,now(),i.product_id))];
    await env.DB.batch(batch); return json({ok:true,order:(await orderList(env,user.id)).find(o=>o.id===id)});
  }
  if(match && method==="GET"){
    if(customerOnly) return customerOnly; const id=decodeURIComponent(match[1]); const order=(await orderList(env,user.id)).find(o=>o.id===id); return order?json({order}):error("Order not found.",404);
  }

  match=path.match(/^\/api\/admin\/products\/([^/]+)\/images(?:\/order)?$/);
  if(match && path.endsWith("/images") && method==="GET"){
    if(adminOnly) return adminOnly; const rows=await productImages(env,decodeURIComponent(match[1]));
    const n=await env.DB.prepare("SELECT COUNT(*) AS imageCount,COALESCE(SUM(byte_size),0) AS storedBytes FROM product_images").first();
    return json({images:rows.map(imageView),stats:{imageCount:n.imageCount,storedBytes:n.storedBytes}});
  }
  if(match && path.endsWith("/images") && method==="POST"){
    if(adminOnly) return adminOnly; const id=decodeURIComponent(match[1]), img=await addProductImage(env,id,await readBody()); await audit(env,request,user,"product.image.add",id,{imageId:img.id,byteSize:img.byteSize});
    return json({ok:true,image:img,images:(await productImages(env,id)).map(imageView)},201);
  }
  if(match && path.endsWith("/images/order") && method==="PUT"){
    if(adminOnly) return adminOnly; const id=decodeURIComponent(match[1]), b=await readBody(), current=await productImages(env,id);
    if(!Array.isArray(b.order)||b.order.length!==current.length||new Set(b.order).size!==current.length||b.order.some((n)=>!current.some((i)=>i.id===n))) return error("Invalid image order.");
    await env.DB.batch(b.order.map((imageId,index)=>env.DB.prepare("UPDATE product_images SET sort_order=? WHERE id=? AND product_id=?").bind(index,imageId,id)));
    await updatePrimary(env,id); return json({ok:true,images:(await productImages(env,id)).map(imageView)});
  }
  match=path.match(/^\/api\/admin\/images\/([^/]+)$/);
  if(match && method==="DELETE"){
    if(adminOnly) return adminOnly; const id=Number(match[1]); const img=await env.DB.prepare("SELECT product_id FROM product_images WHERE id=?").bind(id).first();
    if(!img) return error("Image not found.",404); await env.DB.prepare("DELETE FROM product_images WHERE id=?").bind(id).run(); await updatePrimary(env,img.product_id); return json({ok:true,id});
  }
  return error("Not found.",404);
}

async function serveImage(request, env, path) {
  const imageMatch = path.match(/^\/api\/images\/(\d+)$/);
  if (imageMatch && request.method === "GET") {
    const row = await env.DB.prepare("SELECT b.mime,b.data FROM product_images i JOIN image_blobs b ON b.sha256=i.sha256 WHERE i.id=?").bind(Number(imageMatch[1])).first();
    if (!row) return error("Image not found.",404);
    return new Response(row.data,{headers:{"Content-Type":row.mime,"Cache-Control":"public,max-age=31536000,immutable","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"}});
  }
  const upload = path.match(/^\/uploads\/([0-9a-f-]{36})$/i);
  if (upload && request.method === "GET") {
    const row = await env.DB.prepare("SELECT mime,data FROM uploaded_images WHERE id=?").bind(upload[1]).first();
    if (!row) return error("Image not found.",404);
    return new Response(row.data,{headers:{"Content-Type":row.mime,"Cache-Control":"public,max-age=31536000,immutable","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"}});
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (!env.DB) return error("The D1 database is not connected to this Worker yet.",503);
      if (request.method === "OPTIONS") return new Response(null,{status:204,headers:{"Allow":"GET,POST,PUT,DELETE,OPTIONS"}});
      if (!checkOrigin(request,env) && !["GET","HEAD"].includes(request.method)) return error("Request origin is not allowed.",403);
      if (path.startsWith("/api/images/") || path.startsWith("/uploads/")) {
        const response=await serveImage(request,env,path); if(response) return response;
      }
      const token=cookieValue(request,COOKIE); const user=await verifySession(env,token);
      if (path.startsWith("/api/")) {
        if (!env.SESSION_SECRET) return error("Set the SESSION_SECRET Worker secret before using the store API.",503);
        return await handleApi(request,env,user,url);
      }
      return json({service:"UVID Store API",status:"ready"});
    } catch (e) {
      if (!e?.status) console.error("[UVID Worker]", e?.stack || e);
      return error(e?.status ? e.message : "Something went wrong on the store server.",e?.status || 500);
    }
  }
};
