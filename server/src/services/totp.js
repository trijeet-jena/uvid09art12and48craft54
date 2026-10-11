/* ============================================================
   UVID — TOTP (RFC 6238) for admin two-factor authentication.
   Pure Node crypto — no external dependencies.
   SHA1 / 30s step / 6 digits, ±1 window tolerance.
   ============================================================ */
"use strict";

const crypto = require("crypto");

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || "").toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* one TOTP code for a given counter/time */
function totpAt(secretB32, atMs, step, digits) {
  const counter = Math.floor(atMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[off] & 0x7f) << 24) |
    (hmac[off + 1] << 16) |
    (hmac[off + 2] << 8) |
    hmac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

function verify(secretB32, code, windowSteps) {
  const step = 30, digits = 6;
  const win = windowSteps == null ? 1 : windowSteps;
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== digits) return false;
  const now = Date.now();
  for (let w = -win; w <= win; w++) {
    if (totpAt(secretB32, now + w * step * 1000, step, digits) === clean) return true;
  }
  return false;
}

function newSecret() {
  return base32Encode(crypto.randomBytes(20)); /* 160-bit secret */
}

function otpauthUri(secretB32, account, issuer) {
  const iss = issuer || "UVID";
  return (
    "otpauth://totp/" + encodeURIComponent(iss) + ":" + encodeURIComponent(account) +
    "?secret=" + secretB32 +
    "&issuer=" + encodeURIComponent(iss) +
    "&algorithm=SHA1&digits=6&period=30"
  );
}

module.exports = { newSecret, verify, otpauthUri, base32Encode, totpAt };
