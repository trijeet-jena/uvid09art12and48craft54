/* ============================================================
   UVID seminar Worker — local tests
   Runs the real Worker fetch() against a mock D1 (better-sqlite3
   in-memory) and mock static assets, so the logic is verified
   before anything is deployed.

     node test/worker-test.mjs
   ============================================================ */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* better-sqlite3 is already a dependency of the main server — reuse it
   so the Worker tests need no extra install */
const serverRequire = createRequire(path.join(__dirname, "..", "..", "server", "index.js"));
const Database = serverRequire("better-sqlite3");
const worker = (await import("../src/index.js")).default;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra !== undefined ? extra : ""); }
};

/* ---------- mock D1 backed by better-sqlite3 ---------- */
const sql = fs_readFile(path.join(__dirname, "..", "schema.sql"));
const mem = new Database(":memory:");
mem.exec(sql);

function mockD1() {
  return {
    prepare(stmt) {
      let params = [];
      const runner = {
        bind(...vals) { params = vals; return runner; },
        async first() { return mem.prepare(stmt).get(...params) ?? null; },
        async all() { return { results: mem.prepare(stmt).all(...params), success: true, meta: {} }; },
        async run() { const r = mem.prepare(stmt).run(...params); return { success: true, meta: r }; },
      };
      return runner;
    },
  };
}
function fs_readFile(p) { return require("fs").readFileSync(p, "utf8"); }

const env = {
  DB: mockD1(),
  ADMIN_PASSWORD: "OwnerPass#2026",
  ASSETS: { fetch: async () => new Response("<html>seminar page</html>", { headers: { "Content-Type": "text/html" } }) },
};

const ORIGIN = "https://uvid-seminar.example.workers.dev";
let cookie = "";

function call(method, path, { body, headers = {}, form } = {}) {
  const h = { Origin: ORIGIN, ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h["Content-Type"] = "application/json";
  return worker.fetch(new Request(ORIGIN + path, {
    method,
    headers: h,
    body: form ? new URLSearchParams(form) : body !== undefined ? JSON.stringify(body) : undefined,
  }), env);
}

const loadedAt = Date.now() - 60000;
const stamp = Date.now();
const testEmail = `worker.test.${stamp}@example.com`;

(async () => {
  console.log("— 1. public details —");
  let r = await call("GET", "/api/seminar");
  const d = await r.json();
  ok("GET /api/seminar → 200 with keys", r.status === 200 &&
    ["title", "date", "agenda", "speaker"].every((k) => k in d.seminar), JSON.stringify(d).slice(0, 100));
  ok("public payload has no registration fields",
    !JSON.stringify(d).match(/full_name|organization|"notes"|"phone"/i), "leak");
  r = await call("GET", "/seminar");
  ok("static page served with security headers", r.status === 200 &&
    r.headers.get("X-Frame-Options") === "DENY" && !!r.headers.get("Content-Security-Policy"),
    String(r.headers.get("Content-Security-Policy")));

  console.log("— 2. registrations are NOT public —");
  for (const p of ["/admin", "/admin/export.csv"]) {
    const x = await call("GET", p);
    ok(`anon GET ${p} → 401`, x.status === 401, String(x.status));
  }

  console.log("— 3. validation —");
  const bad = [
    [{ email: testEmail }, "missing name"],
    [{ fullName: "A" }, "short name"],
    [{ fullName: "Test Worker" }, "missing email"],
    [{ fullName: "Test Worker", email: "bad@" }, "bad email"],
    [{ fullName: "Test Worker", email: testEmail, phone: "xyz" }, "bad phone"],
  ];
  for (const [body, label] of bad) {
    const x = await call("POST", "/api/seminar/register", { body });
    ok(`${label} → 400`, x.status === 400, String(x.status));
  }

  console.log("— 4. spam traps —");
  const honey = await call("POST", "/api/seminar/register", {
    body: { fullName: "Bot", email: `bot.${stamp}@example.com`, website: "http://spam", formLoadedAt: loadedAt },
  });
  ok("honeypot → silent 201", honey.status === 201, String(honey.status));
  const fast = await call("POST", "/api/seminar/register", {
    body: { fullName: "Fast Bot", email: `fast.${stamp}@example.com`, formLoadedAt: Date.now() },
  });
  ok("instant submit → silent 201", fast.status === 201, String(fast.status));
  const spamRows = mem.prepare("SELECT COUNT(*) c FROM seminar_registrations").get().c;
  ok("spam not stored", spamRows === 0, `rows=${spamRows}`);

  console.log("— 5. valid registration persists in D1 —");
  const good = await call("POST", "/api/seminar/register", {
    body: { fullName: "Worker Test", email: testEmail, phone: "+91 90000 11111",
            organization: "Test Org", notes: "hi", formLoadedAt: loadedAt },
  });
  const goodJson = await good.json();
  ok("valid → 201 confirmation", good.status === 201 && /received/i.test(goodJson.message || ""), JSON.stringify(goodJson));
  const row = mem.prepare("SELECT * FROM seminar_registrations WHERE email = ?").get(testEmail);
  ok("row written to D1", !!row && row.full_name === "Worker Test" && row.organization === "Test Org", JSON.stringify(row));
  const dupe = await call("POST", "/api/seminar/register", { body: { fullName: "Worker Test", email: testEmail, formLoadedAt: loadedAt } });
  ok("duplicate email → 409", dupe.status === 409, String(dupe.status));

  console.log("— 6. CSRF —");
  const csrf = await worker.fetch(new Request(ORIGIN + "/api/seminar/register", {
    method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "Evil", email: `evil.${stamp}@example.com`, formLoadedAt: loadedAt }),
  }), env);
  ok("cross-origin POST → 403", csrf.status === 403, String(csrf.status));

  console.log("— 7. owner login + export —");
  const wrong = await call("POST", "/admin/login", { form: { password: "nope" } });
  ok("wrong password → 401", wrong.status === 401, String(wrong.status));
  const right = await call("POST", "/admin/login", { form: { password: "OwnerPass#2026" } });
  cookie = (right.headers.get("Set-Cookie") || "").split(";")[0];
  ok("correct password → redirect + secure cookie", right.status === 302 &&
    /HttpOnly/.test(right.headers.get("Set-Cookie") || "") && /Secure/.test(right.headers.get("Set-Cookie") || "") &&
    /SameSite=Strict/.test(right.headers.get("Set-Cookie") || ""), right.headers.get("Set-Cookie"));
  const page = await call("GET", "/admin");
  const html = await page.text();
  ok("admin page lists the registration", page.status === 200 && html.includes(testEmail), String(page.status));
  const csv = await call("GET", "/admin/export.csv");
  const csvText = await csv.text();
  ok("CSV export includes it", csv.status === 200 && csvText.includes(testEmail) &&
    /attachment; filename/.test(csv.headers.get("Content-Disposition") || ""), String(csv.status));

  console.log("— 8. rate limit —");
  let limited = false;
  for (let i = 0; i < 30; i++) {
    const x = await call("POST", "/api/seminar/register", {
      body: { fullName: `Flood ${i}`, email: `flood.${stamp}.${i}@example.com`, formLoadedAt: loadedAt },
    });
    if (x.status === 429) { limited = true; break; }
  }
  ok("per-IP rate limit engages", limited, "never hit 429");

  console.log("— cleanup —");
  mem.prepare("DELETE FROM seminar_registrations WHERE email LIKE ?").run(`%${stamp}%`);
  ok("test rows removed", mem.prepare("SELECT COUNT(*) c FROM seminar_registrations").get().c === 0);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("fatal", e); process.exit(1); });
