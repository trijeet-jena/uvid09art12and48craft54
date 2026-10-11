/* ============================================================
   UVID — server entrypoint
   Serves the customer store (static) + admin app (static) + API.
   ============================================================ */
"use strict";

require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { router: authRouter, readUser } = require("./auth");
const apiRouter = require("./routes/api");
const uploadRouter = require("./routes/upload");
const seminarRouter = require("./routes/seminar");
const imageRouter = require("./routes/images");
const { DATA_DIR } = require("./db");
const { securityHeaders, sameOriginGuard, rateLimit } = require("./security");

const app = express();
const PORT_ENV = parseInt(process.env.PORT || "", 10);
const PORT = Number.isFinite(PORT_ENV) && PORT_ENV > 0 ? PORT_ENV : 8787;
const ROOT = path.join(__dirname, "..", "..");          // stationery/
const CUSTOMER_DIR = ROOT;                               // stationery/index.html (built bundle)
const ADMIN_DIR = path.join(ROOT, "admin");              // stationery/admin/index.html
const SEMINAR_DIR = path.join(ROOT, "seminar");          // stationery/seminar/index.html

app.disable("x-powered-by");

/* behind a TLS-terminating proxy set TRUST_PROXY=1 in .env (enables
   HTTPS-aware secure cookies, HSTS and real client IPs for rate limits) */
if (process.env.TRUST_PROXY) app.set("trust proxy", parseInt(process.env.TRUST_PROXY, 10) || 1);

/* security headers on every response (CSP, framing, nosniff, HSTS, no-store API) */
app.use(securityHeaders);
app.use(cookieParser());
app.use(readUser);

/* reject cross-origin API requests (CSRF / cross-site data access) */
app.use(sameOriginGuard);

/* throttle admin write operations per client IP */
const adminWriteLimiter = rateLimit({ name: "admin-write", max: 600, windowMs: 5 * 60 * 1000, message: "Too many admin requests. Please slow down and retry shortly." });
app.use("/api/admin", (req, res, next) => (req.method === "GET" ? next() : adminWriteLimiter(req, res, next)));

/* upload route carries its own (larger) JSON parser — mount before the global one */
app.use("/api/admin/upload", uploadRouter);
app.use("/api/admin/products", express.json({ limit: "12mb" }));  /* base64 image payloads */
app.use(express.json({ limit: "256kb" }));

/* API */
app.use("/api/auth", authRouter);
app.use("/api/seminar", seminarRouter);
app.use("/api", imageRouter);   /* /api/images/:id + admin image gallery */
app.use("/api", apiRouter);

/* uploaded product images (unique filenames → safe to cache forever) */
app.use("/uploads", express.static(path.join(DATA_DIR, "uploads"), { maxAge: "365d", immutable: true }));

/* App shell (html/css/js) must always revalidate so admin edits appear
   on the next page load; uploaded images stay immutable above. */
const revalidate = (res, filePath) => {
  if (/\.(html|css|js)$/i.test(filePath)) res.setHeader("Cache-Control", "no-cache");
};

/* static: admin app under /admin (no directory listing) */
app.use("/admin", express.static(ADMIN_DIR, { index: "index.html", fallthrough: true, setHeaders: revalidate }));

/* static: standalone seminar landing page (own file, untouched storefront) */
app.get("/seminar", (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(path.join(SEMINAR_DIR, "index.html")); });
app.use("/seminar", express.static(SEMINAR_DIR, { index: false, setHeaders: revalidate }));

/* static: customer site at root */
app.use(express.static(CUSTOMER_DIR, { index: "index.html", setHeaders: revalidate }));

/* SPA fallbacks */
app.get("/admin/*", (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(path.join(ADMIN_DIR, "index.html")); });
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(CUSTOMER_DIR, "index.html"));
});

/* 404 for unknown API paths + uniform error shape */
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, _req, res, _next) => {
  /* malformed/oversized bodies are client errors, not server errors */
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body." });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
  console.error("[server error]", (err && err.stack) || err); /* stack stays server-side only */
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

app.listen(PORT, () => {
  console.log(`UVID server running → http://localhost:${PORT}`);
  console.log(`  customer site : http://localhost:${PORT}/`);
  console.log(`  admin app     : http://localhost:${PORT}/admin/`);
});
