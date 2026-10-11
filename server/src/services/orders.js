/* ============================================================
   UVID — orders service
   Server-side stock validation + atomic deduction in a
   transaction. priceAtPurchase is snapshotted per line.
   ============================================================ */
"use strict";

const crypto = require("crypto");
const { db, touch, now } = require("../db");
const bus = require("../events");

const PAYMENT_METHODS = ["COD", "UPI", "CARD", "NETBANKING", "WALLET"];

/* shipping + coupon rules — mirrors the storefront, enforced server-side */
const SHIP_FEE = 49;
const FREE_SHIP_MIN = 499;
const COUPONS = [
  { code: "PAPER10", type: "percent", value: 10, cap: 150, min: 0 },
  { code: "FIRST50", type: "flat", value: 50, cap: null, min: 199 },
  { code: "DESK200", type: "flat", value: 200, cap: null, min: 999 },
  { code: "FREESHIP", type: "ship", value: 0, cap: null, min: 0 },
];

function genOrderId() {
  return "UV" + Date.now().toString(36).toUpperCase() + crypto.randomInt(100, 1000);
}

function placeOrder(user, payload) {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  const method = String(payload.paymentMethod || "COD").toUpperCase();
  if (!items.length) { const e = new Error("Your cart is empty."); e.status = 400; throw e; }
  if (!PAYMENT_METHODS.includes(method)) { const e = new Error("Unsupported payment method."); e.status = 400; throw e; }
  if (items.length > 40) { const e = new Error("Too many distinct items in one order."); e.status = 400; throw e; }

  const address = payload.address && typeof payload.address === "object" ? payload.address : null;
  if (!address || !String(address.line || "").trim() || !String(address.city || "").trim() || !/^\d{6}$/.test(String(address.pin || ""))) {
    const e = new Error("A complete delivery address (line, city, 6-digit PIN) is required."); e.status = 400; throw e;
  }

  /* optional coupon — validated against server rules, never trusted from the client */
  const couponCode = payload.coupon ? String(payload.coupon).trim().toUpperCase() : null;

  /* merge duplicate lines, validate shape (productId + optional variantSku) */
  const want = new Map();
  for (const it of items) {
    const id = String(it.productId || it.id || "");
    const vSku = it.variantSku ? String(it.variantSku) : null;
    const qty = Number(it.quantity ?? it.qty);
    if (!id) { const e = new Error("Invalid item."); e.status = 400; throw e; }
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) { const e = new Error(`Invalid quantity for ${id}.`); e.status = 400; throw e; }
    const key = vSku ? id + "|" + vSku : id;
    want.set(key, { productId: id, variantSku: vSku, qty: (want.get(key) ? want.get(key).qty + qty : qty) });
  }

  /* resolve price/stock from the product row (variants_json) — never trust the client */
  function resolveLine(wantLine) {
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(wantLine.productId);
    if (!p || p.status === "ARCHIVED") { const e = new Error(`"${wantLine.productId}" is no longer available.`); e.status = 400; throw e; }
    if (!wantLine.variantSku) return { p, qty: wantLine.qty, price: p.price, label: p.variant_label || null };
    let variants = [];
    try { variants = JSON.parse(p.variants_json || "[]"); } catch (_e) { variants = []; }
    const v = variants.find((x) => x.sku === wantLine.variantSku);
    if (!v) { const e = new Error(`Unknown variant on "${p.product_name}".`); e.status = 400; throw e; }
    return { p, qty: wantLine.qty, price: Number(v.price), label: v.label, variant: v };
  }

  function availableStock(line) {
    return line.variant ? Number(line.variant.stock) : line.p.stock_quantity;
  }

  /* validate + price server-side inside a transaction */
  const tx = db.transaction(() => {
    const lines = [];
    let total = 0;
    for (const wl of want.values()) {
      const line = resolveLine(wl);
      if (line.p.status === "OUT_OF_STOCK") { const e = new Error(`"${line.p.product_name}" is out of stock.`); e.status = 409; throw e; }
      const stock = availableStock(line);
      if (!Number.isFinite(line.price) || line.price < 0) { const e = new Error("Product price is misconfigured."); e.status = 500; throw e; }
      if (stock < line.qty) {
        const e = new Error(stock === 0
          ? `"${line.p.product_name}" (${line.label || ""}) is out of stock.`
          : `Only ${stock} left of "${line.p.product_name}"${line.label ? " (" + line.label + ")" : ""}. Reduce the quantity to continue.`);
        e.status = 409; e.code = "INSUFFICIENT_STOCK"; e.productId = line.p.id; e.available = stock; throw e;
      }
      const lineTotal = Math.round(line.price * line.qty * 100) / 100;
      total += lineTotal;
      lines.push({ ...line, lineTotal });
    }
    total = Math.round(total * 100) / 100;

    /* coupon + shipping rules (mirror of the storefront, enforced here) */
    let discount = 0, shipFree = false;
    if (couponCode) {
      const coupon = COUPONS.find((c) => c.code === couponCode);
      if (!coupon) { const e = new Error("Invalid coupon code."); e.status = 400; throw e; }
      if (total < coupon.min) {
        const e = new Error(`"${coupon.code}" needs a minimum order of ₹${coupon.min}.`); e.status = 400; throw e;
      }
      if (coupon.type === "percent") discount = Math.min((total * coupon.value) / 100, coupon.cap || Infinity);
      else if (coupon.type === "flat") discount = coupon.value;
      else if (coupon.type === "ship") shipFree = true;
      discount = Math.round(discount * 100) / 100;
    }
    const shipping = shipFree || total >= FREE_SHIP_MIN ? 0 : SHIP_FEE;
    const grand = Math.round((Math.max(0, total - discount) + shipping) * 100) / 100;

    const orderId = genOrderId();
    db.prepare(
      `INSERT INTO orders (id, customer_id, total_amount, status, payment_method, payment_status, address_json, eta, coupon, discount, shipping)
       VALUES (?, ?, ?, 'PLACED', ?, ?, ?, ?, ?, ?, ?)`
    ).run(orderId, user.id, grand, method,
          method === "COD" ? "PENDING" : "PAID",
          JSON.stringify(address),
          new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
          couponCode, discount, shipping);

    const insItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, variant_label, quantity, price_at_purchase, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const decStock = db.prepare("UPDATE products SET stock_quantity = stock_quantity - ?, status = CASE WHEN stock_quantity - ? <= 0 THEN 'OUT_OF_STOCK' ELSE status END, updated_at = ? WHERE id = ?");
    const readVariants = db.prepare("SELECT variants_json FROM products WHERE id = ?");
    const writeVariants = db.prepare("UPDATE products SET variants_json = ?, updated_at = ? WHERE id = ?");
    for (const line of lines) {
      insItem.run(orderId, line.p.id, line.p.product_name, line.label, line.qty, line.price, line.p.image_url);
      if (line.variant) {
        /* deduct per-variant stock inside the JSON, then mirror on the row total */
        const arr = JSON.parse(readVariants.get(line.p.id).variants_json || "[]");
        const v = arr.find((x) => x.sku === line.variant.sku);
        v.stock = Math.max(0, Number(v.stock) - line.qty);
        writeVariants.run(JSON.stringify(arr), now(), line.p.id);
        const remaining = arr.reduce((s, x) => s + Number(x.stock || 0), 0);
        decStock.run(line.qty, remaining === 0 ? line.qty : -1, now(), line.p.id);
      } else {
        decStock.run(line.qty, line.qty, now(), line.p.id);
      }
    }
    return { orderId, total, lines };
  });

  const result = tx();
  bus.publish("catalog"); /* stock changed — push fresh data to open storefronts */
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(result.orderId);
  return {
    order,
    items: result.lines.map((l) => ({
      productId: l.p.id, name: l.p.product_name, variantLabel: l.label,
      qty: l.qty, priceAtPurchase: l.price, imageUrl: l.p.image_url,
    })),
  };
}

function listOrdersForCustomer(userId) {
  const orders = db.prepare("SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100").all(userId);
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");
  return orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) }));
}

function getOrder(orderId, user) {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!o) { const e = new Error("Order not found."); e.status = 404; throw e; }
  if (user.role !== "ADMIN" && o.customer_id !== Number(user.id)) {
    const e = new Error("You can only view your own orders."); e.status = 403; throw e;
  }
  return { ...o, items: db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(o.id) };
}

function cancelOrder(orderId, user) {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!o) { const e = new Error("Order not found."); e.status = 404; throw e; }
  if (user.role !== "ADMIN" && o.customer_id !== Number(user.id)) { const e = new Error("Not your order."); e.status = 403; throw e; }
  if (!["PLACED", "PACKED"].includes(o.status)) { const e = new Error("This order can no longer be cancelled."); e.status = 409; throw e; }

  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status = 'CANCELLED', updated_at = ? WHERE id = ?").run(now(), orderId);
    const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(orderId);
    const restock = db.prepare("UPDATE products SET stock_quantity = stock_quantity + ?, status = CASE WHEN status = 'OUT_OF_STOCK' AND stock_quantity + ? > 0 THEN 'ACTIVE' ELSE status END, updated_at = ? WHERE id = ?");
    const readVariants = db.prepare("SELECT variants_json FROM products WHERE id = ?");
    const writeVariants = db.prepare("UPDATE products SET variants_json = ?, updated_at = ? WHERE id = ?");
    for (const it of items) {
      restock.run(it.quantity, it.quantity, now(), it.product_id);
      /* if the line was a size variant, return that stock to variants_json too */
      if (it.variant_label) {
        try {
          const arr = JSON.parse(readVariants.get(it.product_id).variants_json || "[]");
          const v = arr.find((x) => x.label === it.variant_label || x.size === it.variant_label);
          if (v) {
            v.stock = Number(v.stock) + it.quantity;
            writeVariants.run(JSON.stringify(arr), now(), it.product_id);
          }
        } catch (_e) { /* row lost its variants meanwhile — row-level restock already applied */ }
        if (it.variant_label) {
          const row = db.prepare("SELECT stock_quantity, status, variants_json FROM products WHERE id = ?").get(it.product_id);
          if (row && row.status === "OUT_OF_STOCK" && row.stock_quantity > 0) {
            db.prepare("UPDATE products SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), it.product_id);
          }
        }
      }
    }
  });
  tx();
  bus.publish("catalog"); /* cancelled orders restock the shelf */
  return getOrder(orderId, user);
}

/* ---------- admin ---------- */
function listAllOrders({ status, limit = 200 } = {}) {
  let sql = "SELECT * FROM orders";
  const args = [];
  if (status) { sql += " WHERE status = ?"; args.push(String(status).toUpperCase()); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(Number(limit) || 200);
  const orders = db.prepare(sql).all(...args);
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");
  return orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) }));
}

function adminSetStatus(orderId, status) {
  const allowed = ["PLACED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];
  const v = String(status || "").toUpperCase();
  if (!allowed.includes(v)) { const e = new Error("Invalid order status."); e.status = 400; throw e; }
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!o) { const e = new Error("Order not found."); e.status = 404; throw e; }
  if (v === "CANCELLED" && o.status !== "CANCELLED") return cancelOrder(orderId, { role: "ADMIN", id: o.customer_id });
  db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(v, now(), orderId);
  return getOrder(orderId, { role: "ADMIN", id: o.customer_id });
}

function adminStats() {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const totalProducts = one("SELECT COUNT(*) AS n FROM products WHERE status != 'ARCHIVED'").n;
  const outOfStock = one("SELECT COUNT(*) AS n FROM products WHERE (status = 'OUT_OF_STOCK' OR stock_quantity = 0) AND status != 'ARCHIVED'").n;
  return {
    products: totalProducts,
    inStock: totalProducts - outOfStock,
    outOfStock,
    lowStock: one("SELECT COUNT(*) AS n FROM products WHERE stock_quantity > 0 AND stock_quantity <= 5 AND status != 'ARCHIVED'").n,
    inactive: one("SELECT COUNT(*) AS n FROM products WHERE status = 'ARCHIVED'").n,
    orders: one("SELECT COUNT(*) AS n FROM orders").n,
    openOrders: one("SELECT COUNT(*) AS n FROM orders WHERE status IN ('PLACED','PACKED','SHIPPED','OUT_FOR_DELIVERY')").n,
    revenue: one("SELECT COALESCE(SUM(total_amount),0) AS n FROM orders WHERE status != 'CANCELLED'").n,
    customers: one("SELECT COUNT(*) AS n FROM users WHERE role = 'CUSTOMER'").n,
    recentProducts: all(
      "SELECT id, product_name, category, price, stock_quantity, status, image_url, updated_at FROM products WHERE status != 'ARCHIVED' ORDER BY updated_at DESC, created_at DESC LIMIT 6"
    ),
    recentOrders: all(
      `SELECT o.id, o.total_amount, o.status, o.created_at, u.name AS customerName, u.mobile_number
       FROM orders o LEFT JOIN users u ON u.id = o.customer_id
       ORDER BY o.created_at DESC LIMIT 6`
    ),
  };
}

module.exports = { placeOrder, listOrdersForCustomer, getOrder, cancelOrder, listAllOrders, adminSetStatus, adminStats };
