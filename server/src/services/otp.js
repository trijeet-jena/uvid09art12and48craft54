/* ============================================================
   UVID — OTP service
   - 6-digit code, hashed (sha256) before storage
   - expires after OTP_TTL_SECONDS
   - max OTP_MAX_ATTEMPTS verifications per code
   - resend cooldown + hourly request cap per mobile number
   ============================================================ */
"use strict";

const crypto = require("crypto");
const { db, now } = require("../db");
const { sendSms, provider } = require("./sms");

const TTL = parseInt(process.env.OTP_TTL_SECONDS || "300", 10);
const MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || "5", 10);
const RESEND_COOLDOWN = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || "45", 10);
const HOURLY_CAP = parseInt(process.env.OTP_HOURLY_CAP || "6", 10);

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/* rate limiting: cooldown between sends + cap per rolling hour */
const qCooldown = db.prepare(
  `SELECT COUNT(*) AS n FROM otp_codes
   WHERE mobile_number = ? AND created_at > datetime('now', ?)`
);
const qLastSent = db.prepare(
  `SELECT created_at FROM otp_codes WHERE mobile_number = ? ORDER BY created_at DESC LIMIT 1`
);

function canSend(mobile) {
  const last = qLastSent.get(mobile);
  if (last) {
    const elapsed = (Date.now() - new Date(last.created_at + "Z").getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN) {
      return { ok: false, retryAfter: Math.ceil(RESEND_COOLDOWN - elapsed) };
    }
  }
  const hourly = qCooldown.get(mobile, "-60 minutes");
  if (hourly.n >= HOURLY_CAP) return { ok: false, retryAfter: 3600, capped: true };
  return { ok: true };
}

/* issue an OTP: hash it, store it, "send" it */
function issue(mobile) {
  const gate = canSend(mobile);
  if (!gate.ok) {
    const err = new Error(
      gate.capped ? "Too many OTP requests. Try again after an hour." : `Please wait ${gate.retryAfter}s before requesting another OTP.`
    );
    err.status = 429;
    err.retryAfter = gate.retryAfter;
    throw err;
  }
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare(
    `INSERT INTO otp_codes (mobile_number, code_hash, purpose, expires_at)
     VALUES (?, ?, 'LOGIN', datetime('now', '+' || ? || ' seconds'))`
  ).run(mobile, sha256(code + mobile), TTL);

  const isDev = (process.env.NODE_ENV || "development") !== "production" && provider === "console";
  return sendSms(mobile, `${code} is your UVID login code. It expires in ${Math.round(TTL / 60)} minutes. Never share it.`)
    .then(() => ({ sent: true, expiresInSeconds: TTL, ...(isDev ? { devCode: code } : {}) }));
}

/* verify: constant-ish time compare on the hash, attempt-limited */
function verify(mobile, code) {
  const row = db.prepare(
    `SELECT * FROM otp_codes
     WHERE mobile_number = ? AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(mobile);
  if (!row) { const e = new Error("No active code. Request a new OTP."); e.status = 400; throw e; }

  if (new Date(row.expires_at + "Z").getTime() < Date.now()) {
    db.prepare("UPDATE otp_codes SET consumed_at = ? WHERE id = ?").run(now(), row.id);
    const e = new Error("OTP expired. Request a new one."); e.status = 400; throw e;
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    db.prepare("UPDATE otp_codes SET consumed_at = ? WHERE id = ?").run(now(), row.id);
    const e = new Error("Too many wrong attempts. Request a new OTP."); e.status = 429; throw e;
  }
  const ok = row.code_hash === sha256(String(code) + mobile);
  if (!ok) {
    db.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    const e = new Error(left > 0 ? `Incorrect OTP. ${left} attempt${left === 1 ? "" : "s"} left.` : "Incorrect OTP. Request a new one.");
    e.status = 400; throw e;
  }
  db.prepare("UPDATE otp_codes SET consumed_at = ? WHERE id = ?").run(now(), row.id);
  return true;
}

/* housekeeping */
setInterval(() => {
  db.prepare("DELETE FROM otp_codes WHERE created_at < datetime('now', '-1 day')").run();
}, 6 * 60 * 60 * 1000).unref();

module.exports = { issue, verify, TTL };
