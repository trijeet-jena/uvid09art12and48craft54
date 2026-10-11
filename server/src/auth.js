/* ============================================================
   UVID — auth: customer email sessions + admin password login
   JWT (HS256) in an httpOnly cookie per role; RBAC middleware.
   ============================================================ */
"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { db } = require("./db");
const totp = require("./services/totp");
const { rateLimit, audit } = require("./security");

const JWT_SECRET = process.env.JWT_SECRET || "uvid-dev-secret-change-me";
const COOKIE = "uvid_session";
const IS_PROD = process.env.NODE_ENV === "production";

/* ---------- token helpers ---------- */
function sign(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, name: user.name, email: user.email || null, mobile: user.mobile_number || null },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE, sign(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PROD,
    maxAge: 7 * 24 * 3600 * 1000,
    path: "/",
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

/* Short-lived second-factor challenge: set after the password passes,
   scoped to /api/auth, exchanged for the real session on TOTP verify. */
const MFA_COOKIE = "uvid_mfa";
function setMfaChallenge(res, admin) {
  const token = jwt.sign({ sub: String(admin.id), purpose: "mfa" }, JWT_SECRET, { expiresIn: "5m" });
  res.cookie(MFA_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: IS_PROD,
    maxAge: 5 * 60 * 1000, path: "/api/auth",
  });
}
function readMfaChallenge(req) {
  const raw = req.cookies && req.cookies[MFA_COOKIE];
  if (!raw) return null;
  try { const p = jwt.verify(raw, JWT_SECRET); return p.purpose === "mfa" ? p : null; }
  catch (_e) { return null; }
}

/* ---------- middleware ---------- */
function readUser(req, _res, next) {
  req.user = null;
  const raw = req.cookies && req.cookies[COOKIE];
  if (raw) {
    try {
      const payload = jwt.verify(raw, JWT_SECRET);
      const row = db.prepare("SELECT id, mobile_number, name, email, role FROM users WHERE id = ?").get(payload.sub);
      if (row) req.user = { id: String(row.id), role: row.role, name: row.name, email: row.email, mobile: row.mobile_number || null };
    } catch (_e) { /* expired/invalid token → anonymous */ }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please log in to continue." });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required." });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admin access required." });
  next();
}

/* ---------- routes ---------- */
const router = express.Router();

/* per-IP rate limits */
const loginLimiter = rateLimit({ name: "admin-login", max: 40, windowMs: 15 * 60 * 1000, message: "Too many sign-in attempts. Please wait a few minutes." });
const emailLoginLimiter = rateLimit({ name: "customer-email-login", max: 20, windowMs: 10 * 60 * 1000, message: "Too many sign-in attempts. Please wait a few minutes." });
const mfaLimiter = rateLimit({ name: "admin-mfa", max: 15, windowMs: 10 * 60 * 1000, message: "Too many code attempts. Please wait a few minutes." });

const GMAIL_RE = /^[a-z0-9._%+-]+@gmail\.com$/i;

/* POST /api/auth/email/login { email } → creates/logs in a customer */
router.post("/email/login", emailLoginLimiter, (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (!GMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid Gmail address, such as name@gmail.com." });

  let user = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
  if (user && user.role !== "CUSTOMER") return res.status(403).json({ error: "This email is reserved for admin sign-in." });
  if (!user) {
    const name = email.split("@")[0].replace(/[._+%-]+/g, " ").trim() || "Customer";
    const info = db.prepare("INSERT INTO users (mobile_number, name, email, role) VALUES (NULL, ?, ?, 'CUSTOMER')").run(name, email);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  }

  setAuthCookie(res, user);
  res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

/* POST /api/auth/admin/login  { email, password } [+ MFA step when enabled] */
router.post("/admin/login", loginLimiter, (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const password = String((req.body && req.body.password) || "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  const admin = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'ADMIN'").get(email);
  const creds = admin && db.prepare("SELECT * FROM admin_credentials WHERE admin_id = ?").get(admin.id);

  /* uniform failure + small delay to blunt enumeration/timing */
  const deny = () => {
    setTimeout(() => res.status(401).json({ error: "Invalid admin credentials." }), 350);
  };
  if (!admin || !creds) { audit("admin.login_failed", req, email, { reason: "unknown_account" }); return deny(); }

  if (creds.locked_until && new Date(creds.locked_until + "Z").getTime() > Date.now()) {
    audit("admin.login_failed", req, email, { reason: "locked" });
    return res.status(423).json({ error: "Account temporarily locked. Try again in a few minutes." });
  }
  if (!bcrypt.compareSync(password, creds.password_hash)) {
    const fails = creds.failed_attempts + 1;
    const lock = fails >= 5 ? datetimePlus(15) : null;
    db.prepare("UPDATE admin_credentials SET failed_attempts = ?, locked_until = ? WHERE admin_id = ?")
      .run(fails, lock, admin.id);
    audit("admin.login_failed", req, email, { reason: "bad_password", attempts: fails });
    return deny();
  }
  db.prepare("UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL WHERE admin_id = ?").run(admin.id);

  /* second factor: password alone must not open the panel */
  if (creds.mfa_enabled) {
    setMfaChallenge(res, admin);
    audit("admin.login_mfa_required", req, email, {});
    return res.json({ ok: true, mfa: true });
  }
  setAuthCookie(res, admin);
  audit("admin.login", req, email, { mfa: false });
  res.json({ ok: true, user: { id: admin.id, name: admin.name, role: "ADMIN" } });
});

function datetimePlus(minutes) {
  return new Date(Date.now() + minutes * 60000).toISOString().replace("T", " ").slice(0, 19);
}

/* POST /api/auth/admin/mfa/verify  { code } — exchange challenge for session */
router.post("/admin/mfa/verify", mfaLimiter, (req, res) => {
  const challenge = readMfaChallenge(req);
  if (!challenge) return res.status(401).json({ error: "Sign-in session expired. Please sign in again." });
  const admin = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'ADMIN'").get(challenge.sub);
  const creds = admin && db.prepare("SELECT * FROM admin_credentials WHERE admin_id = ?").get(admin.id);
  if (!admin || !creds || !creds.mfa_enabled || !creds.mfa_secret) {
    return res.status(401).json({ error: "Two-factor authentication is not available. Please sign in again." });
  }
  const code = String((req.body && req.body.code) || "").trim();
  if (!totp.verify(creds.mfa_secret, code)) {
    audit("admin.mfa_failed", req, admin.email || String(admin.id), {});
    return res.status(401).json({ error: "Incorrect authentication code." });
  }
  res.clearCookie(MFA_COOKIE, { path: "/api/auth" });
  setAuthCookie(res, admin);
  audit("admin.login", req, admin.email || String(admin.id), { mfa: true });
  res.json({ ok: true, user: { id: admin.id, name: admin.name, role: "ADMIN" } });
});

/* ---- MFA management (session required; every step verified server-side) ---- */
router.get("/admin/mfa/status", requireAdmin, (req, res) => {
  const creds = db.prepare("SELECT mfa_enabled FROM admin_credentials WHERE admin_id = ?").get(req.user.id);
  res.json({ enabled: !!(creds && creds.mfa_enabled) });
});

router.post("/admin/mfa/setup", requireAdmin, (req, res) => {
  const creds = db.prepare("SELECT mfa_enabled FROM admin_credentials WHERE admin_id = ?").get(req.user.id);
  if (!creds) return res.status(404).json({ error: "Admin credentials not found." });
  if (creds.mfa_enabled) return res.status(409).json({ error: "Two-factor is already enabled. Disable it first." });
  const secret = totp.newSecret();
  db.prepare("UPDATE admin_credentials SET mfa_secret = ?, mfa_enabled = 0 WHERE admin_id = ?").run(secret, req.user.id);
  const row = db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id);
  const account = (row && row.email) || "admin";
  audit("admin.mfa_setup", req, account, {});
  res.json({ ok: true, secret, otpauth: totp.otpauthUri(secret, account, "UVID") });
});

router.post("/admin/mfa/enable", requireAdmin, (req, res) => {
  const creds = db.prepare("SELECT * FROM admin_credentials WHERE admin_id = ?").get(req.user.id);
  if (!creds) return res.status(404).json({ error: "Admin credentials not found." });
  if (creds.mfa_enabled) return res.status(409).json({ error: "Two-factor is already enabled." });
  if (!creds.mfa_secret) return res.status(400).json({ error: "Run setup first." });
  const code = String((req.body && req.body.code) || "").trim();
  if (!totp.verify(creds.mfa_secret, code)) {
    audit("admin.mfa_enable_failed", req, req.user.name, {});
    return res.status(400).json({ error: "Incorrect code — check your authenticator app and try again." });
  }
  db.prepare("UPDATE admin_credentials SET mfa_enabled = 1 WHERE admin_id = ?").run(req.user.id);
  audit("admin.mfa_enabled", req, req.user.name, {});
  res.json({ ok: true });
});

router.post("/admin/mfa/disable", requireAdmin, mfaLimiter, (req, res) => {
  const creds = db.prepare("SELECT * FROM admin_credentials WHERE admin_id = ?").get(req.user.id);
  if (!creds || !creds.mfa_enabled) return res.status(409).json({ error: "Two-factor is not enabled." });
  const password = String((req.body && req.body.password) || "");
  const code = String((req.body && req.body.code) || "").trim();
  if (!password || !bcrypt.compareSync(password, creds.password_hash)) {
    audit("admin.mfa_disable_failed", req, req.user.name, { reason: "password" });
    return res.status(401).json({ error: "Password is incorrect." });
  }
  if (!creds.mfa_secret || !totp.verify(creds.mfa_secret, code)) {
    audit("admin.mfa_disable_failed", req, req.user.name, { reason: "code" });
    return res.status(400).json({ error: "Authentication code is incorrect." });
  }
  db.prepare("UPDATE admin_credentials SET mfa_enabled = 0, mfa_secret = NULL WHERE admin_id = ?").run(req.user.id);
  audit("admin.mfa_disabled", req, req.user.name, {});
  res.json({ ok: true });
});

/* POST /api/auth/logout */
router.post("/logout", (req, res) => {
  if (req.user && req.user.role === "ADMIN") audit("admin.logout", req, req.user.name, {});
  clearAuthCookie(res);
  res.json({ ok: true });
});

/* GET /api/auth/me */
router.get("/me", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not logged in." });
  res.json({ user: req.user });
});

module.exports = { router, readUser, requireAuth, requireAdmin, setAuthCookie, clearAuthCookie, sign };
