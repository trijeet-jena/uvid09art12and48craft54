/* Smoke test for the new admin endpoints: category CRUD + image upload + stats */
"use strict";
const BASE = "http://localhost:8787";
const EMAIL = process.env.ADMIN_EMAIL || "admin@uvid.store";
const PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe!2026";

let cookie = "";
async function call(method, path, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  let json = null;
  try { json = await res.json(); } catch (_e) { /* no body */ }
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else { console.error("  ✗", msg); process.exitCode = 1; }
}

/* tiny 1x1 red PNG */
const PNG_1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const main = async () => {
  /* 1. admin login */
  const login = await call("POST", "/api/auth/admin/login", { email: EMAIL, password: PASSWORD });
  assert(login.status === 200 && login.json.ok, `admin login (${login.status})`);

  /* 2. category CRUD */
  const created = await call("POST", "/api/admin/categories", { name: "Smoke Test Cat", emoji: "🧪", blurb: "temp" });
  assert(created.status === 201 && created.json.category?.slug, `category created: ${created.json?.category?.slug}`);
  const slug = created.json.category.slug;

  const renamed = await call("PUT", `/api/admin/categories/${slug}`, { name: "Smoke Test Cat 2" });
  assert(renamed.status === 200 && renamed.json.category.name === "Smoke Test Cat 2", "category renamed");

  const list = await call("GET", "/api/admin/categories");
  assert(list.status === 200 && list.json.categories.some((c) => c.slug === slug), "category appears in admin list");

  const del = await call("DELETE", `/api/admin/categories/${slug}`);
  assert(del.status === 200, "empty category deleted");

  /* delete guard: category with products */
  const guard = await call("DELETE", "/api/admin/categories/pens");
  assert(guard.status === 409, `delete guard on non-empty category (${guard.status})`);

  /* 3. image upload */
  const up = await call("POST", "/api/admin/upload", { image: PNG_1x1 });
  assert(up.status === 201 && /^\/uploads\//.test(up.json.url || ""), `image upload → ${up.json?.url}`);
  if (up.json?.url) {
    const img = await fetch(BASE + up.json.url);
    assert(img.status === 200 && img.headers.get("content-type")?.includes("png"), "uploaded image publicly served");
  }

  /* 4. upload rejected for anonymous users */
  const saved = cookie; cookie = "";
  const anonUp = await call("POST", "/api/admin/upload", { image: PNG_1x1 });
  cookie = saved;
  assert(anonUp.status === 401 || anonUp.status === 403, `anonymous upload blocked (${anonUp.status})`);

  /* 5. stats shape */
  const stats = await call("GET", "/api/admin/stats");
  const s = stats.json?.stats || {};
  assert(stats.status === 200 && typeof s.products === "number" && typeof s.inStock === "number"
    && typeof s.outOfStock === "number" && typeof s.orders === "number"
    && Array.isArray(s.recentProducts) && Array.isArray(s.recentOrders), "admin stats has dashboard fields");

  /* 6. customer-visible categories now come from the table */
  cookie = "";
  const pub = await call("GET", "/api/products/categories");
  assert(pub.status === 200 && pub.json.categories[0]?.name && pub.json.categories[0]?.count !== undefined,
    "public categories include name + count");

  console.log(process.exitCode ? "\nSMOKE FAILED" : "\nSMOKE OK");
};

main().catch((e) => { console.error(e); process.exit(1); });
