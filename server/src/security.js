/* ============================================================
   UVID — shared security middleware (server-enforced)
   - security headers (CSP, framing, HSTS behind TLS, no-store API)
   - same-origin guard for state-changing API requests (CSRF/CORS)
   - in-memory rate limiter (sign-in, OTP, uploads, admin writes)
   - audit log writer for important admin/account actions
   ============================================================ */
"use strict";

const { db } = require("./db");

const IS_PROD = process.env.NODE_ENV === "production";

/* ---------------- security headers ---------------- */

/* Inline <script>/<style> are how this app is built (single-file bundles),
   so 'unsafe-inline' is required for scripts — noted as a limitation.
   Everything else is locked down to same-origin. */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join("; ");

function clientIp(req) {
  /* X-Forwarded-For is client-controlled, so only honour it when a proxy
     is explicitly trusted (TRUST_PROXY=1) — otherwise anyone could spoof a
     fresh IP per request and walk straight around the rate limiters. */
  let trustedProxy = false;
  try { trustedProxy = !!(req.app && typeof req.app.get === "function" && req.app.get("trust proxy")); } catch (_e) { /* not an express req */ }
  if (trustedProxy) {
    const fwd = req.headers["x-forwarded-for"];
    if (fwd) return String(fwd).split(",")[0].trim();
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || "?";
}

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CSP);
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  if (req.secure || proto === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
}

/* ---------------- same-origin guard (CSRF + cross-origin API access) ----------------
   The session is a cookie, so reject any API request whose Origin/Referer
   (when present) points at another host. Browsers always attach Origin to
   cross-site writes; non-browser clients (tests, curl) send neither. */
function originMismatch(req) {
  /* A Vercel external rewrite forwards the customer's original host here;
     req.headers.host may instead be the Render service host. */
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || req.headers.host;
  const check = (value) => {
    try { return new URL(value).host !== host; }
    catch (_e) { return true; }
  };
  if (req.headers.origin && req.headers.origin !== "null" && check(req.headers.origin)) return true;
  if (!req.headers.origin && req.headers.referer && check(req.headers.referer)) return true;
  return false;
}

function sameOriginGuard(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();
  if (originMismatch(req)) {
    return res.status(403).json({ error: "Cross-origin request blocked." });
  }
  next();
}

/* ---------------- rate limiting (in-memory, per client IP) ---------------- */

const buckets = new Map();
const MAX_BUCKETS = 20000;
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k);
}, 60 * 1000).unref?.();

function rateLimit(opts) {
  const windowMs = opts.windowMs;
  const max = opts.max;
  const name = opts.name || "rl";
  return function limit(req, res, next) {
    const key = name + "|" + clientIp(req);
    const t = Date.now();
    let b = buckets.get(key);
    if (!b || t > b.reset) {
      if (buckets.size >= MAX_BUCKETS) buckets.clear(); /* pathological growth guard */
      b = { count: 0, reset: t + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - b.count)));
    if (b.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((b.reset - t) / 1000))));
      return res.status(429).json({ error: opts.message || "Too many requests. Please try again later." });
    }
    next();
  };
}

/* ---------------- audit log ----------------
   Records who did what and when. Never receives passwords, tokens,
   OTP codes or payment details — callers pass curated fields only. */
const insAudit = db.prepare(
  `INSERT INTO audit_logs (actor_id, actor_name, role, action, target, detail, ip, user_agent)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

function audit(action, req, target, detail) {
  try {
    const u = (req && req.user) || null;
    const ua = String((req && req.headers && req.headers["user-agent"]) || "").slice(0, 200);
    insAudit.run(
      u ? u.id : null,
      u ? u.name || null : null,
      u ? u.role || null : null,
      String(action).slice(0, 60),
      target ? String(target).slice(0, 120) : null,
      detail ? JSON.stringify(detail).slice(0, 2000) : null,
      req ? clientIp(req) : null,
      ua || null
    );
  } catch (e) {
    console.error("[audit] failed to record", action, e.message); /* never blocks the request */
  }
}

function recentAudit(limit) {
  return db.prepare(
    "SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?"
  ).all(Math.min(200, Math.max(1, Number(limit) || 50)));
}

module.exports = { securityHeaders, sameOriginGuard, rateLimit, audit, recentAudit, clientIp, IS_PROD };
