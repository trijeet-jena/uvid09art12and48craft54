/* ============================================================
   UVID — API routes
   /api/products*  → public catalog
   /api/orders*    → customer (session required)
   /api/admin/*    → admin only (RBAC enforced here, not in UI)
   ============================================================ */
"use strict";

const express = require("express");
const products = require("../services/products");
const orders = require("../services/orders");
const { requireAuth, requireAdmin } = require("../auth");
const { db } = require("../db");
const bus = require("../events");
const { audit, recentAudit } = require("../security");

const router = express.Router();

/* ---------------- live updates (SSE) ----------------
   Any catalog mutation publishes on the bus; every connected
   tab receives an event and refetches from the database. */
router.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write("event: hello\ndata: {}\n\n");
  const off = bus.subscribe((chunk) => res.write(chunk));
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(heartbeat); off(); });
});

/* ---------------- public: catalog ---------------- */
router.get("/products", (req, res) => {
  const { category, q, inStock } = req.query;
  res.json({
    products: products.listPublic({
      category: category ? String(category) : undefined,
      q: q ? String(q) : undefined,
      includeOutOfStock: inStock !== "1",
    }),
  });
});

router.get("/products/categories", (_req, res) => res.json({ categories: products.categories() }));

/* ---------------- admin: categories ---------------- */
router.get("/admin/categories", requireAdmin, (_req, res) => res.json({ categories: products.categories() }));
router.post("/admin/categories", requireAdmin, (req, res) => {
  try {
    const c = products.createCategory(req.body || {});
    audit("category.create", req, c && c.slug, { name: c && c.name });
    res.status(201).json({ ok: true, category: c });
  }
  catch (e) { res.status(e.status || 500).json({ error: e.message || "Could not create category." }); }
});
router.put("/admin/categories/:slug", requireAdmin, (req, res) => {
  try {
    const c = products.updateCategory(String(req.params.slug), req.body || {});
    audit("category.update", req, String(req.params.slug), { fields: Object.keys(req.body || {}) });
    res.json({ ok: true, category: c });
  }
  catch (e) { res.status(e.status || 500).json({ error: e.message || "Could not update category." }); }
});
router.delete("/admin/categories/:slug", requireAdmin, (req, res) => {
  try {
    const out = products.deleteCategory(String(req.params.slug), {
      reassignTo: (req.body || {}).reassignTo || req.query.reassignTo,
    });
    audit("category.delete", req, String(req.params.slug), { reassignTo: (req.body || {}).reassignTo || req.query.reassignTo || null });
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.message || "Could not delete category." }); }
});

router.get("/products/:id", (req, res) => {
  const p = products.getPublic(String(req.params.id));
  if (!p) return res.status(404).json({ error: "Product not found." });
  res.json({ product: p });
});

/* ---------------- customer: orders ---------------- */
router.post("/orders", requireAuth, (req, res) => {
  try {
    const out = orders.placeOrder(req.user, req.body || {});
    res.status(201).json({ ok: true, order: out.order, items: out.items });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Could not place order." });
  }
});

router.get("/orders", requireAuth, (req, res) => {
  res.json({ orders: orders.listOrdersForCustomer(req.user.id) });
});

router.get("/orders/:id", requireAuth, (req, res) => {
  try { res.json({ order: orders.getOrder(String(req.params.id), req.user) }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.post("/orders/:id/cancel", requireAuth, (req, res) => {
  try {
    const out = orders.cancelOrder(String(req.params.id), req.user);
    audit("order.cancel", req, String(req.params.id), { by: "customer" });
    res.json({ ok: true, order: out });
  }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

/* ---------------- admin: products ---------------- */
router.get("/admin/products", requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM products ORDER BY sort_order, product_name").all();
  res.json({ products: rows.map(products.publicView) });
});

router.get("/admin/stats", requireAdmin, (_req, res) => res.json({ stats: orders.adminStats() }));

router.post("/admin/products", requireAdmin, (req, res) => {
  try {
    const p = products.create(req.body || {});
    audit("product.create", req, p.id, { name: p.productName, price: p.price, mrp: p.mrp, stock: p.stockQuantity, status: p.status });
    res.status(201).json({ ok: true, product: p });
  }
  catch (e) { res.status(e.status || 500).json({ error: e.message || "Could not create product." }); }
});

router.put("/admin/products/:id", requireAdmin, (req, res) => {
  try {
    const p = products.update(String(req.params.id), req.body || {});
    const b = req.body || {};
    audit("product.update", req, String(req.params.id), {
      fields: Object.keys(b),
      price: b.price !== undefined ? b.price : undefined,
      stock: b.stockQuantity !== undefined ? b.stockQuantity : undefined,
      status: b.status !== undefined ? b.status : undefined,
    });
    res.json({ ok: true, product: p });
  }
  catch (e) { res.status(e.status || 500).json({ error: e.message || "Could not update product." }); }
});

router.delete("/admin/products/:id", requireAdmin, (req, res) => {
  try {
    const out = products.remove(String(req.params.id));
    audit("product.delete", req, String(req.params.id), {});
    res.json({ ok: true, ...out });
  }
  catch (e) { res.status(e.status || 500).json({ error: e.message || "Could not delete product." }); }
});

router.put("/admin/products/:id/stock", requireAdmin, (req, res) => {
  try {
    const n = Number((req.body || {}).stockQuantity);
    if (!Number.isInteger(n) || n < 0) return res.status(400).json({ error: "Stock must be a whole number ≥ 0." });
    const p = products.setStock(String(req.params.id), n);
    audit("product.stock", req, String(req.params.id), { stock: n });
    res.json({ ok: true, product: p });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.put("/admin/products/:id/price", requireAdmin, (req, res) => {
  try {
    const n = Number((req.body || {}).price);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "Price must be a number ≥ 0." });
    const p = products.setPrice(String(req.params.id), n);
    audit("product.price", req, String(req.params.id), { price: n });
    res.json({ ok: true, product: p });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

/* ---------------- admin: audit trail ---------------- */
router.get("/admin/audit", requireAdmin, (req, res) => {
  res.json({ entries: recentAudit(req.query.limit) });
});

/* ---------------- admin: orders ---------------- */
router.get("/admin/orders", requireAdmin, (req, res) => {
  res.json({ orders: orders.listAllOrders({ status: req.query.status, limit: req.query.limit }) });
});

router.put("/admin/orders/:id/status", requireAdmin, (req, res) => {
  try {
    const o = orders.adminSetStatus(String(req.params.id), (req.body || {}).status);
    audit("order.status", req, String(req.params.id), { status: (req.body || {}).status });
    res.json({ ok: true, order: o });
  }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

/* ---------------- admin: customers ---------------- */
router.get("/admin/customers", requireAdmin, (_req, res) => {
  const rows = db.prepare(
    `SELECT u.id, u.mobile_number, u.name, u.email, u.created_at,
            COUNT(o.id) AS orderCount,
            COALESCE(SUM(CASE WHEN o.status != 'CANCELLED' THEN o.total_amount END), 0) AS spend
     FROM users u LEFT JOIN orders o ON o.customer_id = u.id
     WHERE u.role = 'CUSTOMER'
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`
  ).all();
  res.json({ customers: rows });
});

/* seminar: admin-only details editing, registration list + CSV export */
require("./seminar").registerAdminRoutes(router);

module.exports = router;
