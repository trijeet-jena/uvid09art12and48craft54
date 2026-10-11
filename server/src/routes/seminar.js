/* ============================================================
   Seminar page API
   GET  /api/seminar            → public event details (no PII)
   POST /api/seminar/register   → validated registration (honeypot + rate limit)
   Admin-only (requireAdmin):
   GET  /api/admin/seminar/registrations        → registration list
   GET  /api/admin/seminar/registrations/export → CSV download
   POST /api/admin/seminar/details              → edit event details
   Registrations are never exposed on any public route.
   ============================================================ */
"use strict";

const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../auth");
const { rateLimit, audit, clientIp } = require("../security");

const router = express.Router();

/* ---------------- validation helpers ---------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+][0-9 ()-]{6,19}$/;

/* Trim, strip control characters, and cap length. Never returns raw script. */
function clean(value, maxLen) {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLen);
}

/* ---------------- spam protection ---------------- */
/* 1) honeypot field: real people never fill a hidden input
   2) minimum time on form: bots submit instantly
   3) per-IP rate limit (see index.js wiring)
   Submissions that trip these are accepted silently so bots
   get no signal that they were detected. */
const registerLimiter = rateLimit({
  name: "seminar-register",
  /* generous enough that a shared office IP can register a whole group,
     while still stopping scripted bursts; honeypot + timing traps do the rest */
  max: 20,
  windowMs: 60 * 60 * 1000,
  message: "Too many registrations from this device. Please try again later.",
});
const MIN_FORM_SECONDS = 3;

function spamScore(req) {
  const b = req.body || {};
  const reasons = [];
  if (clean(b.website, 200)) reasons.push("honeypot");
  const t0 = Number(b.formLoadedAt);
  if (Number.isFinite(t0) && t0 > 0 && Date.now() - t0 < MIN_FORM_SECONDS * 1000) reasons.push("too-fast");
  return reasons;
}

/* ---------------- public: event details ---------------- */
router.get("/", (_req, res) => {
  const row = db.prepare("SELECT * FROM seminar_details WHERE id = 1").get();
  /* Public payload carries event copy only — never registration data. */
  res.json({
    seminar: {
      title: row.title,
      description: row.description,
      date: row.event_date,
      time: row.event_time,
      location: row.location,
      meetingUrl: row.meeting_url,
      speaker: row.speaker,
      agenda: row.agenda ? row.agenda.split("\n").filter((s) => s.trim()) : [],
      contactEmail: row.contact_email,
      updatedAt: row.updated_at,
    },
  });
});

/* ---------------- public: register ---------------- */
router.post("/register", registerLimiter, (req, res) => {
  const b = req.body || {};
  const spam = spamScore(req);
  if (spam.length) {
    audit("seminar.register_spam", req, "-", { reasons: spam.join(",") });
    /* silent success — do not teach the bot what tripped it */
    return res.status(201).json({ ok: true, message: "Thanks! Your registration has been received." });
  }

  const fullName = clean(b.fullName, 120);
  const email = clean(b.email, 200).toLowerCase();
  const phone = clean(b.phone, 25);
  const organization = clean(b.organization, 160);
  const notes = clean(b.notes, 500);

  if (fullName.length < 2) return res.status(400).json({ error: "Please enter your full name." });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Please enter a valid email address." });
  if (phone && !PHONE_RE.test(phone)) return res.status(400).json({ error: "Please enter a valid phone number." });

  const dupe = db.prepare("SELECT id FROM seminar_registrations WHERE lower(email) = ?").get(email);
  if (dupe) return res.status(409).json({ error: "This email is already registered. No need to sign up twice." });

  try {
    const info = db
      .prepare(
        `INSERT INTO seminar_registrations (full_name, email, phone, organization, notes, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(fullName, email, phone || null, organization || null, notes || null,
           clientIp(req), String(req.headers["user-agent"] || "").slice(0, 250) || null);
    audit("seminar.register", req, email, { id: info.lastInsertRowid });
    res.status(201).json({
      ok: true,
      id: info.lastInsertRowid,
      message: "Thanks! Your registration has been received.",
    });
  } catch (e) {
    console.error("[seminar register]", e.message);
    res.status(500).json({ error: "We could not save your registration. Please try again." });
  }
});

module.exports = router;

/* ============================================================
   Admin-only seminar endpoints (mounted in routes/api.js)
   ============================================================ */
const DETAIL_FIELDS = [
  ["title", 200],
  ["description", 4000],
  ["event_date", 100],
  ["event_time", 100],
  ["location", 300],
  ["meeting_url", 500],
  ["speaker", 200],
  ["agenda", 4000],
  ["contact_email", 200],
];

function registrationRows() {
  return db.prepare("SELECT id, full_name, email, phone, organization, notes, created_at FROM seminar_registrations ORDER BY created_at DESC").all();
}

function registerAdminRoutes(admin) {
  admin.get("/admin/seminar", requireAdmin, (_req, res) => {
    const row = db.prepare("SELECT * FROM seminar_details WHERE id = 1").get();
    const regs = registrationRows();
    res.json({
      details: row,
      registrations: regs,
      stats: {
        total: regs.length,
        last7days: regs.filter((r) => Date.now() - new Date(r.created_at.replace(" ", "T") + "Z").getTime() < 7 * 864e5).length,
      },
    });
  });

  admin.get("/admin/seminar/registrations/export", requireAdmin, (req, res) => {
    const rows = registrationRows();
    const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
    const csv = [
      ["Registration ID", "Registered at", "Full name", "Email", "Phone", "Organization", "Notes"].map(cell).join(","),
      ...rows.map((r) => [r.id, r.created_at, r.full_name, r.email, r.phone || "", r.organization || "", r.notes || ""].map(cell).join(",")),
    ].join("\r\n");
    audit("seminar.export", req, "registrations", { count: rows.length });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="seminar-registrations.csv"');
    res.send("﻿" + csv);
  });

  admin.post("/admin/seminar/details", requireAdmin, (req, res) => {
    const b = req.body || {};
    const sets = [];
    const vals = [];
    for (const [field, max] of DETAIL_FIELDS) {
      if (b[field] === undefined) continue;
      sets.push(field + " = ?");
      vals.push(clean(b[field], max));
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update." });
    db.prepare(`UPDATE seminar_details SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = 1`).run(...vals);
    audit("seminar.details_updated", req, "seminar", { fields: sets.length });
    res.json({ ok: true, details: db.prepare("SELECT * FROM seminar_details WHERE id = 1").get() });
  });
}

module.exports.registerAdminRoutes = registerAdminRoutes;
