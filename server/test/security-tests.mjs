/* ============================================================
   UVID security tests — OWASP-oriented verification
   Run with the server up:  node test/security-tests.mjs
   Covers:
     1. logged-out visitors cannot use admin APIs
     2. customers cannot act as admins or read other customers' orders
     3. browser-tampered prices/stock cannot falsify checkout
     4. invalid input and unsafe uploads are rejected
     5. existing shopping/checkout/order features still work
   Plus: lockout, TOTP MFA cycle, audit trail (no secrets logged).
   Cleans up every row/file the test itself creates.
   ============================================================ */
const BASE = process.env.BASE || "http://localhost:8787";
const { createRequire } = await import("module");
const require = createRequire(import.meta.url);
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { fileURLToPath } = await import("url");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, extra !== undefined ? extra : ""); } };

const jar = { admin: "", a: "", b: "" };
async function req(method, p, { body, jar: which, headers: extra } = {}) {
  const headers = Object.assign({}, extra || {});
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (which && jar[which]) headers.Cookie = jar[which];
  const bodyless = method === "GET" || method === "HEAD";
  const res = await fetch(BASE + p, { method, headers, body: bodyless || body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get("set-cookie");
  if (sc && which) jar[which] = sc.split(";")[0];
  let data = null;
  try { data = await res.json(); } catch (_e) { /* no body */ }
  return { status: res.status, data, res };
}

/* independent RFC-6238 TOTP (different code path than the server's) */
function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.toUpperCase().replace(/=+$/, "")) {
    const idx = A.indexOf(ch);
    if (idx === -1) throw new Error("bad b32");
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secretB32) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1e6).padStart(6, "0");
}

/* pull one named cookie out of a response's Set-Cookie header(s) */
function cookieNamed(res, name) {
  const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  const hit = all.find((c) => c.startsWith(name + "="));
  return hit ? hit.split(";")[0] : "";
}

/* raw request with arbitrary headers (for Origin tests) */
function rawPost(targetPath, originHeader) {
  return new Promise((resolve) => {
    const u = new URL(BASE + targetPath);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/json", Origin: originHeader, Cookie: jar.admin },
    }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(res.statusCode)); });
    r.end("{}");
  });
}

const PNG_1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

(async () => {
  /* normalize pre-state so the suite is safely re-runnable in dev:
     MFA off, no lockout — the cycle below re-enables/disables it itself */
  const { db: preDb } = require("../src/db.js");
  preDb.prepare("UPDATE admin_credentials SET mfa_enabled = 0, mfa_secret = NULL, failed_attempts = 0, locked_until = NULL").run();

  console.log("— 1. logged-out visitor vs admin APIs —");
  for (const [m, p] of [
    ["GET", "/api/admin/products"], ["GET", "/api/admin/stats"], ["GET", "/api/admin/orders"],
    ["GET", "/api/admin/customers"], ["GET", "/api/admin/audit"], ["GET", "/api/admin/categories"],
    ["POST", "/api/admin/products"], ["PUT", "/api/admin/products/x/stock"],
    ["DELETE", "/api/admin/products/x"], ["PUT", "/api/admin/orders/x/status"],
    ["POST", "/api/admin/categories"], ["POST", "/api/admin/upload"],
  ]) {
    const r = await req(m, p, { body: {} });
    ok(`anon ${m} ${p} → 401`, r.status === 401, String(r.status));
  }
  const shell = await fetch(BASE + "/admin/");
  ok("admin SPA shell loads (login screen only, no data)", shell.status === 200);
  const hdr = await fetch(BASE + "/api/products");
  ok("security headers present", hdr.headers.get("content-security-policy") && hdr.headers.get("x-content-type-options") === "nosniff" && hdr.headers.get("x-frame-options") === "DENY");

  console.log("— 2. customer sessions: RBAC + object-level access —");
  let r = await req("POST", "/api/auth/otp/request", { body: { mobile: "9000000001" } });
  ok("customer A otp request", r.status === 200 && r.data.devCode, JSON.stringify(r.data));
  r = await req("POST", "/api/auth/otp/verify", { body: { mobile: "9000000001", code: r.data.devCode, name: "Sec Customer A" }, jar: "a" });
  ok("customer A logged in", r.status === 200 && r.data.ok, JSON.stringify(r.data));

  r = await req("POST", "/api/auth/otp/request", { body: { mobile: "9000000002" } });
  const codeB = r.data.devCode;
  r = await req("POST", "/api/auth/otp/verify", { body: { mobile: "9000000002", code: codeB, name: "Sec Customer B" }, jar: "b" });
  ok("customer B logged in", r.status === 200 && r.data.ok, JSON.stringify(r.data));

  for (const [m, p] of [
    ["GET", "/api/admin/products"], ["GET", "/api/admin/stats"], ["GET", "/api/admin/orders"],
    ["GET", "/api/admin/customers"], ["GET", "/api/admin/audit"],
    ["POST", "/api/admin/products"], ["PUT", "/api/admin/products/dotted-journal/price"],
    ["DELETE", "/api/admin/products/x"], ["PUT", "/api/admin/orders/x/status"],
    ["POST", "/api/admin/categories"], ["POST", "/api/admin/upload"], ["GET", "/api/auth/admin/mfa/status"],
  ]) {
    const r2 = await req(m, p, { body: {}, jar: "a" });
    ok(`customer ${m} ${p} → 403`, r2.status === 403, String(r2.status));
  }

  /* customer A places a real order (feature works) */
  r = await req("POST", "/api/orders", {
    jar: "a",
    body: {
      items: [{ productId: "school-labels", quantity: 2 }],
      paymentMethod: "COD",
      address: { name: "Sec Customer A", phone: "9000000001", line: "42 Test Lane", city: "Mumbai", pin: "400001" },
    },
  });
  ok("customer A places order (existing checkout works)", r.status === 201 && r.data.order && r.data.order.id, JSON.stringify(r.data).slice(0, 200));
  const orderA = r.data && r.data.order && r.data.order.id;

  if (orderA) {
    const g = await req("GET", "/api/orders/" + orderA, { jar: "b" });
    ok("customer B cannot read A's order → 403", g.status === 403, String(g.status));
    const c = await req("POST", "/api/orders/" + orderA + "/cancel", { jar: "b", body: {} });
    ok("customer B cannot cancel A's order → 403", c.status === 403, String(c.status));
    const l = await req("GET", "/api/orders", { jar: "b" });
    ok("customer B's list does not include A's order", l.status === 200 && Array.isArray(l.data.orders) && !l.data.orders.some((o) => o.id === orderA), JSON.stringify(l.data).slice(0, 160));
    const ca = await req("POST", "/api/orders/" + orderA + "/cancel", { jar: "a", body: {} });
    ok("customer A can cancel their own order (feature works)", ca.status === 200, JSON.stringify(ca.data));
  }

  console.log("— 3. checkout tampering: server is authoritative —");
  const cat = await req("GET", "/api/products");
  const target = (cat.data.products || []).find((p) => p.id === "school-labels") || (cat.data.products || [])[0];
  const dbPrice = target.price;
  const fake = await req("POST", "/api/orders", {
    jar: "a",
    body: {
      items: [{ productId: target.id, quantity: 1, price: 1, mrp: 1, discount: 99, stockQuantity: 9999 }],
      paymentMethod: "COD",
      address: { name: "X", phone: "9000000001", line: "42 Test Lane", city: "Mumbai", pin: "400001" },
      total: 1, totals: { total: 1 },
    },
  });
  ok("faked browser prices are ignored", fake.status === 201 && fake.data.order && Number(fake.data.order.total_amount) > 1, JSON.stringify(fake.data && fake.data.order && fake.data.order.total_amount));
  ok("line price equals DB price (" + dbPrice + ")", fake.data && fake.data.items && Number(fake.data.items[0].priceAtPurchase) === dbPrice, JSON.stringify(fake.data && fake.data.items && fake.data.items[0]));
  const stock = target.stockQuantity;
  const over = await req("POST", "/api/orders", {
    jar: "a",
    body: { items: [{ productId: target.id, quantity: Math.min(99, stock + 20) }], paymentMethod: "COD",
      address: { name: "X", phone: "9000000001", line: "42 Test Lane", city: "Mumbai", pin: "400001" } },
  });
  ok("overselling stock rejected (409)", over.status === 409, String(over.status) + " " + JSON.stringify(over.data));
  const badCoupon = await req("POST", "/api/orders", {
    jar: "a",
    body: { items: [{ productId: target.id, quantity: 1 }], coupon: "TOTALLY-FAKE", paymentMethod: "COD",
      address: { name: "X", phone: "9000000001", line: "42 Test Lane", city: "Mumbai", pin: "400001" } },
  });
  ok("bogus coupon rejected (400)", badCoupon.status === 400, String(badCoupon.status));
  const noAddr = await req("POST", "/api/orders", { jar: "a", body: { items: [{ productId: target.id, quantity: 1 }], paymentMethod: "COD" } });
  ok("missing/incomplete address rejected (400)", noAddr.status === 400, String(noAddr.status));
  const noAuth = await req("POST", "/api/orders", { body: { items: [{ productId: target.id, quantity: 1 }] } });
  ok("anonymous checkout rejected (401)", noAuth.status === 401, String(noAuth.status));

  console.log("— 4. invalid input, uploads, CSRF origin —");
  const sqli = await req("POST", "/api/auth/admin/login", { body: { email: "admin' OR '1'='1' --", password: "x" } });
  ok("SQLi login attempt rejected (401, no error leak)", sqli.status === 401, String(sqli.status));
  const xss = await req("POST", "/api/auth/admin/login", { body: { email: "<script>alert(1)</script>", password: "x" } });
  ok("XSS-in-login rejected (401)", xss.status === 401, String(xss.status));

  r = await req("POST", "/api/auth/admin/login", { body: { email: "admin@uvid.store", password: process.env.ADMIN_PASSWORD || "UvidAdmin#2026" }, jar: "admin" });
  ok("admin login ok (MFA not yet enabled)", r.status === 200 && r.data.user, JSON.stringify(r.data));
  const rl = r.res.headers.get("x-ratelimit-remaining");
  ok("login rate limiter active (X-RateLimit-Remaining present)", rl !== null && Number(rl) < 40, String(rl));

  const neg = await req("POST", "/api/admin/products", { jar: "admin", body: { productName: "Neg", category: "pens", description: "x", price: -5, stockQuantity: 1 } });
  ok("negative price rejected (400)", neg.status === 400, String(neg.status));
  const badStatus = await req("POST", "/api/admin/products", { jar: "admin", body: { productName: "St", category: "pens", description: "x", price: 10, stockQuantity: 1, status: "WHATEVER" } });
  ok("invalid status rejected (400)", badStatus.status === 400, String(badStatus.status));

  /* stored XSS payload round-trips raw (escaped at output, not executed) */
  let xssId = null;
  let mfaSecretUsed = null;
  const mk = await req("POST", "/api/admin/products", { jar: "admin", body: { sku: "sec-xss-test", productName: "<script>alert(1)</script>", category: "pens", description: "<img src=x onerror=alert(2)>", price: 10, stockQuantity: 1 } });
  ok("XSS payload stored as text (no server-side rendering)", mk.status === 201, String(mk.status));
  if (mk.status === 201) {
    xssId = mk.data.product.id;
    const got = await req("GET", "/api/products/" + xssId);
    ok("XSS payload returned unchanged as data", got.status === 200 && got.data.product.productName === "<script>alert(1)</script>", JSON.stringify(got.data && got.data.product && got.data.product.productName));
  }

  /* uploads */
  const anonUp = await req("POST", "/api/admin/upload", { body: { image: PNG_1x1 } });
  ok("anonymous upload → 401", anonUp.status === 401, String(anonUp.status));
  const custUp = await req("POST", "/api/admin/upload", { jar: "a", body: { image: PNG_1x1 } });
  ok("customer upload → 403", custUp.status === 403, String(custUp.status));
  const svg = await req("POST", "/api/admin/upload", { jar: "admin", body: { image: "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64") } });
  ok("SVG upload rejected (400)", svg.status === 400, String(svg.status));
  const fakePng = await req("POST", "/api/admin/upload", { jar: "admin", body: { image: "data:image/png;base64," + Buffer.from("this is definitely not an image, just text padding padding padding").toString("base64") } });
  ok("non-image content rejected despite declared type (400)", fakePng.status === 400, String(fakePng.status));
  const mismatch = await req("POST", "/api/admin/upload", { jar: "admin", body: { image: "data:image/png;base64," + fs.readFileSync(path.join(__dirname, "..", "..", "assets", "bamboo-chopsticks.jpg")).toString("base64") } });
  ok("declared-type mismatch rejected (400)", mismatch.status === 400, String(mismatch.status));
  const big = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(7 * 1024 * 1024, 7)]).toString("base64");
  const tooBig = await req("POST", "/api/admin/upload", { jar: "admin", body: { image: big } });
  ok("oversized image rejected (413)", tooBig.status === 413, String(tooBig.status));
  const goodUp = await req("POST", "/api/admin/upload", { jar: "admin", body: { image: PNG_1x1 } });
  ok("valid PNG accepted (201) → /uploads/…", goodUp.status === 201 && /^\/uploads\/.+\.png$/.test(goodUp.data.url || ""), JSON.stringify(goodUp.data));
  if (goodUp.status === 201) {
    const pub = await fetch(BASE + goodUp.data.url);
    ok("uploaded image publicly readable (same-origin)", pub.status === 200);
  }

  /* CSRF: cross-origin write must be blocked even with a valid cookie */
  const evil = await rawPost("/api/admin/products", "https://evil.example");
  ok("cross-origin admin POST blocked (403)", evil === 403, String(evil));
  const sameOrigin = await rawPost("/api/admin/products", new URL(BASE).origin); /* browsers always send scheme://host */
  ok("same-origin POST still allowed (not 403)", sameOrigin !== 403, String(sameOrigin));

  console.log("— 5. brute-force lockout —");
  for (let i = 0; i < 5; i++) await req("POST", "/api/auth/admin/login", { body: { email: "admin@uvid.store", password: "definitely-wrong-" + i } });
  const locked = await req("POST", "/api/auth/admin/login", { body: { email: "admin@uvid.store", password: process.env.ADMIN_PASSWORD || "UvidAdmin#2026" } });
  ok("5 bad passwords → account locked (423 even with right password)", locked.status === 423, String(locked.status));

  console.log("— 6. admin TOTP MFA cycle —");
  const { db } = require("../src/db.js");
  db.prepare("UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL").run(); /* reset lockout */

  let st = await req("GET", "/api/auth/admin/mfa/status", { jar: "admin" });
  ok("mfa status readable", st.status === 200 && !!st.data && typeof st.data.enabled === "boolean", JSON.stringify(st.data));
  const wasEnabled = !!(st.data && st.data.enabled);
  if (wasEnabled) ok("MFA already enabled — skipping cycle", true);
  const setup = wasEnabled ? null : await req("POST", "/api/auth/admin/mfa/setup", { jar: "admin", body: {} });
  if (!wasEnabled) ok("mfa setup returns secret + otpauth", setup.status === 200 && setup.data.secret && String(setup.data.otpauth).startsWith("otpauth://"), JSON.stringify(setup.data).slice(0, 120));
  if (setup && setup.status === 200) {
    const wrong = await req("POST", "/api/auth/admin/mfa/enable", { jar: "admin", body: { code: "000000" } });
    ok("wrong TOTP cannot enable MFA (400)", wrong.status === 400, String(wrong.status));
    const enable = await req("POST", "/api/auth/admin/mfa/enable", { jar: "admin", body: { code: totpNow(setup.data.secret) } });
    ok("correct TOTP enables MFA", enable.status === 200, JSON.stringify(enable.data));

    /* fresh login now demands the second factor */
    const mfaJar = {};
    const login2 = await fetch(BASE + "/api/auth/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@uvid.store", password: process.env.ADMIN_PASSWORD || "UvidAdmin#2026" }),
    });
    const login2json = await login2.json();
    const challengeCookie = cookieNamed(login2, "uvid_mfa");
    ok("password-only login returns MFA challenge (no session)", login2.status === 200 && login2json.mfa === true && !((login2.headers.get("set-cookie") || "").includes("uvid_session=")), JSON.stringify(login2json));
    const noCode = await fetch(BASE + "/api/auth/admin/mfa/verify", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: challengeCookie },
      body: JSON.stringify({ code: "111111" }),
    });
    ok("wrong code cannot open session (401)", noCode.status === 401, String(noCode.status));
    /* TOTP from the setup secret still valid in-window */
    const verify = await fetch(BASE + "/api/auth/admin/mfa/verify", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: challengeCookie },
      body: JSON.stringify({ code: totpNow(setup.data.secret) }),
    });
    const verifyJson = await verify.json();
    ok("correct code issues admin session", verify.status === 200 && verifyJson.user && verifyJson.user.role === "ADMIN", JSON.stringify(verifyJson));
    const sessionCookie = cookieNamed(verify, "uvid_session");
    mfaSecretUsed = setup.data.secret;
    const adminCall = await fetch(BASE + "/api/admin/stats", { headers: { Cookie: sessionCookie } });
    ok("MFA session can call admin APIs", adminCall.status === 200, String(adminCall.status));

    const dis = await fetch(BASE + "/api/auth/admin/mfa/disable", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ password: process.env.ADMIN_PASSWORD || "UvidAdmin#2026", code: totpNow(setup.data.secret) }),
    });
    ok("MFA disabled with password + code (restore state)", dis.status === 200, String(dis.status));
  }
  st = await req("GET", "/api/auth/admin/mfa/status", { jar: "admin" });
  ok("MFA back to disabled for this environment", st.status === 200 && st.data.enabled === false, JSON.stringify(st.data));

  console.log("— 7. audit trail —");
  const audit = await req("GET", "/api/admin/audit?limit=50", { jar: "admin" });
  ok("audit log readable by admin", audit.status === 200 && Array.isArray(audit.data.entries), String(audit.status));
  const actions = (audit.data.entries || []).map((e) => e.action);
  ok("records admin login", actions.includes("admin.login"), JSON.stringify(actions.slice(0, 10)));
  ok("records failed logins", actions.includes("admin.login_failed"), "");
  ok("records MFA events", actions.some((a) => String(a).startsWith("admin.mfa")), JSON.stringify(actions.filter((a) => String(a).startsWith("admin.mfa"))));
  ok("records customer order cancel", actions.includes("order.cancel"), "");
  const dump = JSON.stringify(audit.data.entries || []);
  const credRow = require("../src/db.js").db.prepare("SELECT password_hash FROM admin_credentials WHERE admin_id = 1").get();
  const leaksPassword = dump.includes(process.env.ADMIN_PASSWORD || "UvidAdmin#2026");
  const leaksHash = credRow && credRow.password_hash && dump.includes(credRow.password_hash);
  const leaksMfaSecret = mfaSecretUsed && dump.includes(mfaSecretUsed);
  const leaksBcryptPattern = /\$2[aby]\$/.test(dump);
  ok("no passwords/secrets in audit log", !leaksPassword && !leaksHash && !leaksMfaSecret && !leaksBcryptPattern,
    JSON.stringify({ leaksPassword, leaksHash, leaksMfaSecret, leaksBcryptPattern }));
  const loggedRole = (audit.data.entries || []).every((e) => e.role === "ADMIN" || e.role === "CUSTOMER" || e.role === null);
  ok("audit rows carry actor role", loggedRole, "");

  /* ---------- cleanup: rows & files THIS TEST created ---------- */
  if (xssId) { try { await req("DELETE", "/api/admin/products/" + xssId, { jar: "admin" }); } catch (_e) { /* already gone */ } }
  if (goodUp.status === 201 && goodUp.data.url) {
    try { fs.unlinkSync(path.join(__dirname, "..", "data", "uploads", path.basename(goodUp.data.url))); } catch (_e) { /* already gone */ }
  }
  try {
    db.prepare("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN (SELECT id FROM users WHERE mobile_number IN ('9000000001','9000000002')))").run();
    db.prepare("DELETE FROM orders WHERE customer_id IN (SELECT id FROM users WHERE mobile_number IN ('9000000001','9000000002'))").run();
    db.prepare("DELETE FROM otp_codes WHERE mobile_number IN ('9000000001','9000000002')").run();
    db.prepare("DELETE FROM users WHERE mobile_number IN ('9000000001','9000000002')").run();
    db.prepare("UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL").run();
    console.log("  · cleaned up test users/orders/otp/lockout state");
  } catch (e) { console.log("  ! cleanup issue:", e.message); }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
})().catch((e) => { console.error("TEST CRASH:", e); process.exitCode = 1; });
