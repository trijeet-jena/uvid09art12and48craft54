/* ============================================================
   UVID seminar — Cloudflare Worker
   Serves the seminar page (static assets) + a small API on the
   same origin, so the existing page works unchanged:

     GET  /api/seminar            → public event details (no PII)
     POST /api/seminar/register   → validated registration
     POST /admin/login            → owner sign-in (password from secret)
     GET  /admin                  → registration list (owner only)
     GET  /admin/export.csv       → CSV download (owner only)

   Storage: D1 (SQLite) — survives deploys and restarts.
   Secrets: ADMIN_PASSWORD (wrangler secret put ADMIN_PASSWORD)
   ============================================================ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+][0-9 ()-]{6,19}$/;
const SESSION_HOURS = 12;
const MIN_FORM_SECONDS = 3;
const MAX_PER_HOUR = 20;          /* per client IP, best-effort (isolate memory) */

/* ---------------- helpers ---------------- */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

function clientIp(request) {
  const fwd = request.headers.get("CF-Connecting-IP");
  if (fwd) return fwd;
  return request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "?";
}

/* strip control chars + cap length — never reflect raw markup */
function clean(value, max) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- password + session cookie (HMAC) ---------------- */
const enc = new TextEncoder();

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(value, secret) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function verify(token, secret) {
  const dot = String(token || "").lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = await sign(payload, secret);
  if (mac.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
async function issueToken(secret) {
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = String(expires);
  return `${payload}.${await sign(payload, secret)}`;
}
async function tokenValid(token, secret) {
  if (!token || !verify(token, secret)) return false;
  const expires = Number(String(token).split(".")[0]);
  return Number.isFinite(expires) && Date.now() < expires;
}
const readCookie = (req, name) =>
  (req.headers.get("Cookie") || "").split(";").map((c) => c.trim())
    .find((c) => c.startsWith(name + "="))?.slice(name.length + 1) || "";

/* constant-time-ish password compare */
function sameSecret(a, b) {
  const x = enc.encode(String(a || "")), y = enc.encode(String(b || ""));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ---------------- security headers ---------------- */
function withSecurity(response) {
  const h = new Headers(response.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "same-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  h.set("Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
    "form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; connect-src 'self'");
  return new Response(response.body, { status: response.status, headers: h });
}

/* reject cross-site writes (CSRF) — same-origin browser requests only */
function crossOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;                       /* same-origin fetch may omit it */
  try { return new URL(origin).host !== new URL(request.url).host; }
  catch (_e) { return true; }
}

/* ---------------- in-isolate rate limit ---------------- */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > MAX_PER_HOUR;
}

/* ---------------- public: details ---------------- */
async function getDetails(env) {
  let row = await env.DB.prepare("SELECT * FROM seminar_details WHERE id = 1").first();
  if (!row) {
    await env.DB.prepare("INSERT OR IGNORE INTO seminar_details (id) VALUES (1)").run();
    row = await env.DB.prepare("SELECT * FROM seminar_details WHERE id = 1").first();
  }
  return row || {};
}

/* ---------------- registration ---------------- */
async function register(request, env) {
  const ip = clientIp(request);
  if (rateLimited(ip)) return json({ error: "Too many registrations from this device. Please try again later." }, 429);

  let body = {};
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid request." }, 400); }

  /* spam traps: hidden honeypot field + minimum time on the form.
     Answer with a normal success so a bot learns nothing. */
  if (clean(body.website, 200)) return json({ ok: true, message: "Thanks! Your registration has been received." }, 201);
  const t0 = Number(body.formLoadedAt);
  if (Number.isFinite(t0) && t0 > 0 && Date.now() - t0 < MIN_FORM_SECONDS * 1000)
    return json({ ok: true, message: "Thanks! Your registration has been received." }, 201);

  const fullName = clean(body.fullName, 120);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 25);
  const organization = clean(body.organization, 160);
  const notes = clean(body.notes, 500);

  if (fullName.length < 2) return json({ error: "Please enter your full name." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (phone && !PHONE_RE.test(phone)) return json({ error: "Please enter a valid phone number." }, 400);

  const dupe = await env.DB.prepare("SELECT id FROM seminar_registrations WHERE lower(email) = ?").bind(email).first();
  if (dupe) return json({ error: "This email is already registered. No need to sign up twice." }, 409);

  await env.DB.prepare(
    `INSERT INTO seminar_registrations (full_name, email, phone, organization, notes, ip)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(fullName, email, phone || null, organization || null, notes || null, ip).run();

  return json({ ok: true, message: "Thanks! Your registration has been received." }, 201);
}

/* ---------------- owner admin page ---------------- */
async function registrations(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, full_name, email, phone, organization, notes, created_at FROM seminar_registrations ORDER BY created_at DESC"
  ).all();
  return results || [];
}

function csvCell(v) {
  return '"' + String(v == null ? "" : v).replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
}

function adminPage(rows, error) {
  const tr = rows.length
    ? rows.map((r) => `<tr><td><b>${esc(r.full_name)}</b></td><td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>` +
      `<td>${esc(r.phone || "—")}</td><td>${esc(r.organization || "—")}</td><td><small>${esc(r.notes || "")}</small></td>` +
      `<td><small>${esc(String(r.created_at || "").slice(0, 16))}</small></td></tr>`).join("")
    : `<tr><td colspan="6" style="text-align:center;padding:40px;color:#5c6b64">No registrations yet.</td></tr>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Seminar registrations — owner</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7faf8;color:#16241d;
font-family:"Segoe UI",Roboto,system-ui,sans-serif;line-height:1.6}
.wrap{max-width:1000px;margin:0 auto;padding:28px 18px 60px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:26px 0 10px}
p.sub{color:#5c6b64;margin:0 0 18px}
.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
input,button{font:inherit;border-radius:10px;padding:11px 13px;border:1.5px solid #dfe7e2;min-height:46px}
input{width:min(280px,60vw)}button{background:#2e7d5b;color:#fff;border:0;font-weight:700;cursor:pointer}
a.btn{display:inline-flex;align-items:center;background:#eef4f1;color:#1f5a40;text-decoration:none;
font-weight:700;border-radius:10px;padding:11px 16px;min-height:46px}
.err{color:#b02a1e;font-weight:600}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;
box-shadow:0 1px 2px rgba(16,32,24,.06);margin-top:8px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #eef2ef;font-size:14.5px;vertical-align:top}
th{background:#eef4f1;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#5c6b64}
tr:last-child td{border-bottom:0}a{color:#2e7d5b}
</style></head><body><div class="wrap">
<h1>Seminar registrations</h1>
<p class="sub">Owner-only. ${rows.length} registration${rows.length === 1 ? "" : "s"}.</p>
<div class="bar"><a class="btn" href="/">Open seminar page</a>
<a class="btn" href="/admin/export.csv">Export CSV</a></div>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Organization</th><th>Notes</th><th>Registered</th></tr></thead>
<tbody>${tr}</tbody></table>
</div></body></html>`;
}

function loginPage(error) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Owner sign-in</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f7faf8;display:grid;place-items:center;
min-height:100vh;font-family:"Segoe UI",Roboto,system-ui,sans-serif;color:#16241d}
.card{background:#fff;padding:30px;border-radius:14px;width:min(380px,92vw);
box-shadow:0 12px 32px rgba(16,32,24,.09)}
h1{font-size:21px;margin:0 0 6px}p{color:#5c6b64;font-size:14.5px;margin:0 0 18px}
input{width:100%;font:inherit;padding:12px;border:1.5px solid #dfe7e2;border-radius:10px;margin-bottom:12px}
button{width:100%;font:inherit;font-weight:700;background:#2e7d5b;color:#fff;border:0;
padding:13px;border-radius:10px;cursor:pointer}.err{color:#b02a1e;font-size:13.5px;font-weight:600}
a.back{color:#2e7d5b;font-size:13px}</style></head><body>
<form class="card" method="post" action="/admin/login">
<h1>Owner sign-in</h1><p>Registration details are visible only to the site owner.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<input type="password" name="password" placeholder="Owner password" autocomplete="current-password" required autofocus>
<button type="submit">Sign in</button>
<p style="margin:14px 0 0"><a class="back" href="/">← Back to the seminar page</a></p>
</form></body></html>`;
}

/* ---------------- router ---------------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const isWrite = !["GET", "HEAD"].includes(request.method);

    /* CSRF: block cross-origin writes outright */
    if (isWrite && crossOrigin(request)) return json({ error: "Cross-origin request blocked." }, 403);

    try {
      if (path === "/api/seminar" && request.method === "GET") {
        const d = await getDetails(env);
        return json({
          seminar: {
            title: d.title || "", description: d.description || "",
            date: d.event_date || "", time: d.event_time || "",
            location: d.location || "", meetingUrl: d.meeting_url || "",
            speaker: d.speaker || "",
            agenda: (d.agenda || "").split("\n").filter((s) => s.trim()),
            contactEmail: d.contact_email || "", updatedAt: d.updated_at || "",
          },
        });
      }

      if (path === "/api/seminar/register" && request.method === "POST") return withSecurity(await register(request, env));

      /* ---- owner area ---- */
      if (path.startsWith("/admin")) {
        const secret = env.ADMIN_PASSWORD || "";
        const token = readCookie(request, "seminar_admin");
        const authed = secret && await tokenValid(token, secret);

        if (path === "/admin/login" && request.method === "POST") {
          const form = await request.formData().catch(() => null);
          const password = form ? String(form.get("password") || "") : (await request.json().catch(() => ({}))).password;
          if (!secret) return new Response("Owner password is not set.", { status: 503 });
          if (!sameSecret(password, secret)) {
            return new Response(loginPage("Incorrect password."), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
          }
          return new Response(null, {
            status: 302,
            headers: { Location: "/admin", "Set-Cookie": `seminar_admin=${await issueToken(secret)}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}` },
          });
        }

        if (!authed) {
          if (path === "/admin/export.csv") return new Response("Not authorized.", { status: 401 });
          return new Response(loginPage(""), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
        }

        const rows = await registrations(env);

        if (path === "/admin/export.csv") {
          const csv = [
            ["Registration ID", "Registered at", "Full name", "Email", "Phone", "Organization", "Notes"].map(csvCell).join(","),
            ...rows.map((r) => [r.id, r.created_at, r.full_name, r.email, r.phone || "", r.organization || "", r.notes || ""].map(csvCell).join(",")),
          ].join("\r\n");
          return new Response("﻿" + csv, {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="seminar-registrations.csv"',
              "Cache-Control": "no-store",
            },
          });
        }

        return new Response(adminPage(rows, ""), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      }

      /* ---- static seminar page (and its assets) ---- */
      return withSecurity(await env.ASSETS.fetch(request));
    } catch (e) {
      return json({ error: "Something went wrong on our side. Please try again." }, 500);
    }
  },
};
