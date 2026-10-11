/* ============================================================
   Seminar page tests
   Run with the server up:  node test/seminar-tests.mjs
   Verifies: public details readable, registrations persist,
   validation + spam protection, and that registration data is
   admin-only (never exposed on a public route).
   Cleans up every row it creates.
   ============================================================ */
const BASE = process.env.BASE || "http://localhost:8787";
const { createRequire } = await import("module");
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra !== undefined ? extra : ""); }
};

const ADMIN_EMAIL = "admin@uvid.store";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "UvidAdmin#2026";
const stamp = Date.now();
const testEmail = `seminar.test.${stamp}@example.com`;

async function req(method, p, { body, cookie, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  const text = raw ? await res.text() : null;
  if (!raw) { try { data = await res.json(); } catch (_e) { /* no body */ } }
  const sc = res.headers.get("set-cookie");
  return { status: res.status, data, text, cookie: sc ? sc.split(";")[0] : "" };
}

(async () => {
  console.log("— 1. public seminar details —");
  const page = await req("GET", "/seminar");
  ok("seminar page loads (200 html)", page.status === 200);
  const details = await req("GET", "/api/seminar");
  ok("GET /api/seminar → 200", details.status === 200);
  ok("details payload has editable keys", details.data && details.data.seminar &&
    ["title", "description", "date", "time", "location", "meetingUrl", "speaker", "agenda"]
      .every((k) => k in details.data.seminar), JSON.stringify(details.data));

  console.log("— 2. registration data is NOT public —");
  for (const p of ["/api/admin/seminar", "/api/admin/seminar/registrations/export"]) {
    const r = await req("GET", p);
    ok(`anon GET ${p} blocked (${r.status})`, r.status === 401 || r.status === 403 || r.status === 404, String(r.status));
  }
  const publicBlob = JSON.stringify(details.data);
  const leaked = ["full_name", "phone", "organization", "notes", '"email"']
    .filter((k) => publicBlob.includes(k));
  ok("public details carry no registration fields", leaked.length === 0, JSON.stringify(leaked));

  console.log("— 3. validation —");
  const cases = [
    [{ email: testEmail }, "missing name → 400"],
    [{ fullName: "A" }, "too-short name → 400"],
    [{ fullName: "Test Person" }, "missing email → 400"],
    [{ fullName: "Test Person", email: "not-an-email" }, "bad email → 400"],
    [{ fullName: "Test Person", email: testEmail, phone: "abc" }, "bad phone → 400"],
  ];
  for (const [body, label] of cases) {
    const r = await req("POST", "/api/seminar/register", { body });
    ok(label, r.status === 400, String(r.status));
  }

  console.log("— 4. spam protection —");
  const loadedAt = Date.now() - 60000;
  const honey = await req("POST", "/api/seminar/register", {
    body: { fullName: "Bot Person", email: `bot.${stamp}@example.com`, website: "http://spam.example", formLoadedAt: loadedAt },
  });
  ok("honeypot submission returns success-shaped 201 (silent drop)", honey.status === 201, String(honey.status));
  const fast = await req("POST", "/api/seminar/register", {
    body: { fullName: "Fast Bot", email: `fast.${stamp}@example.com`, formLoadedAt: Date.now() },
  });
  ok("instant submit (honeypot empty) returns 201", fast.status === 201, String(fast.status));
  // both must NOT have been persisted
  const { db } = require("../src/db.js");
  const spamLeak = db.prepare("SELECT COUNT(*) c FROM seminar_registrations WHERE email LIKE ?").get(`%${stamp}%`);
  ok("spam submissions were not stored", spamLeak.c === 0, `found ${spamLeak.c}`);

  console.log("— 5. valid registration persists —");
  const good = await req("POST", "/api/seminar/register", {
    body: { fullName: "Seminar Tester", email: testEmail, phone: "+91 98765 43210",
            organization: "Test Org", notes: "Automated test entry", formLoadedAt: loadedAt },
  });
  ok("valid registration → 201 with confirmation", good.status === 201 && /received/i.test(good.data.message || ""),
    JSON.stringify(good.data));
  const saved = db.prepare("SELECT * FROM seminar_registrations WHERE email = ?").get(testEmail);
  ok("row persisted to SQLite", !!saved && saved.full_name === "Seminar Tester" && saved.organization === "Test Org",
    JSON.stringify(saved));
  const dupe = await req("POST", "/api/seminar/register", {
    body: { fullName: "Seminar Tester", email: testEmail, formLoadedAt: loadedAt },
  });
  ok("duplicate email rejected (409)", dupe.status === 409, String(dupe.status));

  console.log("— 6. owner/admin can read + export —");
  const login = await req("POST", "/api/auth/admin/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  ok("admin login ok (no MFA challenge expected)", login.status === 200 && login.data.ok && !login.data.mfa, JSON.stringify(login.data));
  const adminCookie = login.cookie;
  const list = await req("GET", "/api/admin/seminar", { cookie: adminCookie });
  ok("admin sees registrations list", list.status === 200 && Array.isArray(list.data.registrations) &&
    list.data.registrations.some((r) => r.email === testEmail), String(list.status));
  const csv = await req("GET", "/api/admin/seminar/registrations/export", { cookie: adminCookie, raw: true });
  ok("CSV export contains the registration", csv.status === 200 && csv.text.includes(testEmail),
    csv.status + " " + (csv.text || "").slice(0, 80));

  // details editing round-trip (then restored to blank placeholders)
  const upd = await req("POST", "/api/admin/seminar/details", { cookie: adminCookie, body: { title: "Test Seminar Title" } });
  ok("admin can save event details", upd.status === 200, String(upd.status));
  const after = await req("GET", "/api/seminar");
  ok("saved title visible publicly", after.data && after.data.seminar.title === "Test Seminar Title");
  await req("POST", "/api/admin/seminar/details", { cookie: adminCookie, body: { title: "" } });
  ok("title restored to blank placeholder", (await req("GET", "/api/seminar")).data.seminar.title === "");

  console.log("— cleanup —");
  db.prepare("DELETE FROM seminar_registrations WHERE email LIKE ?").run(`%${stamp}%`);
  const mine = db.prepare("SELECT COUNT(*) c FROM seminar_registrations WHERE email LIKE ?").get(`%${stamp}%`).c;
  const real = db.prepare("SELECT COUNT(*) c FROM seminar_registrations").get().c;
  ok("test rows removed (pre-existing entries untouched)", mine === 0, `own=${mine} real=${real}`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("fatal", e); process.exit(1); });
