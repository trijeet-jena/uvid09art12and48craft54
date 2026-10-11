/* ============================================================
   Image database tests
   Verifies that product images live in SQLite, are served from
   there, are per-product / per-colour, and are admin-only to edit.
   Self-cleaning: removes anything it creates.
   ============================================================ */
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8787";
const DATA = path.join(__dirname, "..", "data");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " — " + extra : "")); }
};

/* ---- helpers ---- */
function jar() {
  let cookie = "";
  return {
    get: () => cookie,
    absorb(res) {
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of set) {
        const kv = c.split(";")[0];
        if (kv.startsWith("uvid_session=")) cookie = kv;
      }
    },
  };
}
async function req(method, url, { body, cookie, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (body !== undefined && !raw) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  const res = await fetch(BASE + url, {
    method, headers: h,
    body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
    redirect: "manual",
  });
  return res;
}
async function jreq(method, url, opts) {
  const res = await req(method, url, opts);
  let json = null;
  try { json = await res.json(); } catch (_e) { /* non-JSON error page */ }
  return { res, json };
}

/* a real 1x1 JPEG so magic-byte sniffing passes */
function tinyJpeg() {
  const f = path.join(DATA, "uploads", "__imagetest.jpg");
  const b64 =
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
  fs.writeFileSync(f, Buffer.from(b64, "base64"));
  return f;
}
const dataUriOf = (f) => "data:image/jpeg;base64," + fs.readFileSync(f).toString("base64");

async function main() {
  const admin = jar();
  const email = process.env.ADMIN_EMAIL || "admin@uvid.store";
  const pw = process.env.ADMIN_PASSWORD || "";

  /* --- schema --- */
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(path.join(DATA, "uvid.db"), { readonly: true });

  console.log("\n[schema]");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  ok("product_images table exists", tables.includes("product_images"));
  ok("image_blobs table exists", tables.includes("image_blobs"));
  const cols = db.prepare("PRAGMA table_info(product_images)").all().map((c) => c.name);
  ok("catalog tracks the colour variant", cols.includes("variant_key"));
  ok("catalog stores the content hash", cols.includes("sha256"));
  const bcols = db.prepare("PRAGMA table_info(image_blobs)").all().map((c) => c.name);
  ok("blobs store the bytes", bcols.includes("data"));
  const nullBytes = db.prepare("SELECT COUNT(*) n FROM image_blobs WHERE data IS NULL").get().n;
  ok("no blob is empty", nullBytes === 0, `${nullBytes} empty blobs`);
  const dupes = db.prepare(
    "SELECT COUNT(*) n FROM (SELECT 1 FROM product_images GROUP BY product_id, COALESCE(variant_key,''), sha256 HAVING COUNT(*)>1)"
  ).get().n;
  ok("no duplicate image rows", dupes === 0, `${dupes} duplicates`);

  /* --- anonymous access --- */
  console.log("\n[access control]");
  const anonList = await jreq("GET", "/api/admin/products/bamboo-chopsticks/images");
  ok("anonymous cannot list a gallery", anonList.res.status === 401, `got ${anonList.res.status}`);
  const anonPost = await jreq("POST", "/api/admin/products/bamboo-chopsticks/images", { body: { image: dataUriOf(tinyJpeg()) } });
  ok("anonymous cannot add an image", anonPost.res.status === 401, `got ${anonPost.res.status}`);
  const anonDel = await jreq("DELETE", "/api/admin/images/1");
  ok("anonymous cannot delete an image", anonDel.res.status === 401, `got ${anonDel.res.status}`);

  /* --- admin session --- */
  const login = await jreq("POST", "/api/auth/admin/login", { body: { email, password: pw } });
  admin.absorb(login.res);
  ok("admin signs in", login.res.status === 200 && !!admin.get(), `got ${login.res.status}`);

  /* --- store / read back --- */
  console.log("\n[store and serve]");
  const jpg = tinyJpeg();
  const created = await jreq("POST", "/api/admin/products/bamboo-chopsticks/images", {
    cookie: admin.get(), body: { image: dataUriOf(jpg), altText: "test shot" },
  });
  ok("admin can store an image", created.res.status === 201, `got ${created.res.status} ${created.json && created.json.error}`);
  const img = created.json && created.json.image;
  ok("stored image has a public url", !!img && /^\/api\/images\/\d+$/.test(img.url), img && img.url);
  ok("stored image records its size", img && img.byteSize > 0, img && String(img.byteSize));

  const bytesRes = await req("GET", img.url);
  const buf = Buffer.from(await bytesRes.arrayBuffer());
  ok("image is served from the database", bytesRes.status === 200);
  ok("served bytes match what was stored", buf.equals(fs.readFileSync(jpg)), `${buf.length} vs ${fs.readFileSync(jpg).length}`);
  ok("served with the right content type", /image\/jpeg/.test(bytesRes.headers.get("content-type") || ""),
    bytesRes.headers.get("content-type"));
  ok("served with a long immutable cache", (bytesRes.headers.get("cache-control") || "").includes("immutable"));
  ok("served with nosniff", bytesRes.headers.get("x-content-type-options") === "nosniff");

  /* --- product row points at the stored copy --- */
  const after = db.prepare("SELECT image_url FROM products WHERE id='bamboo-chopsticks'").get();
  ok("products.image_url points into the image database", String(after.image_url).startsWith("/api/images/"), after.image_url);

  /* --- dedupe --- */
  const dupe = await jreq("POST", "/api/admin/products/bamboo-chopsticks/images", {
    cookie: admin.get(), body: { image: dataUriOf(jpg) },
  });
  ok("same photo twice does not duplicate", dupe.res.status === 201 && dupe.json.image.id === img.id,
    `got ${dupe.json && dupe.json.image && dupe.json.image.id} vs ${img.id}`);

  /* --- validation --- */
  console.log("\n[validation]");
  const svg = await jreq("POST", "/api/admin/products/bamboo-chopsticks/images", {
    cookie: admin.get(), body: { image: "data:image/svg+xml;base64,PHN2Zy8+" },
  });
  ok("SVG is rejected", svg.res.status === 400, `got ${svg.res.status}`);
  const liar = await jreq("POST", "/api/admin/products/bamboo-chopsticks/images", {
    cookie: admin.get(), body: { image: "data:image/png;base64," + fs.readFileSync(jpg).toString("base64") },
  });
  ok("mislabelled file type is rejected", liar.res.status === 400, `got ${liar.res.status}`);
  const junk = await jreq("POST", "/api/admin/products/bamboo-chopsticks/images", {
    cookie: admin.get(), body: { image: "not-an-image" },
  });
  ok("non-image payload is rejected", junk.res.status === 400, `got ${junk.res.status}`);
  const ghost = await jreq("POST", "/api/admin/products/no-such-product/images", {
    cookie: admin.get(), body: { image: dataUriOf(jpg) },
  });
  ok("unknown product is rejected", ghost.res.status === 404, `got ${ghost.res.status}`);

  /* --- per-colour galleries --- */
  console.log("\n[colour variants]");
  const child = db.prepare("SELECT id FROM products WHERE meta_json LIKE '%_vc-bamboo-chopsticks%' OR id LIKE '_vc-bamboo%' LIMIT 1").get();
  let childImg = null;
  if (child) {
    const r = await jreq("POST", `/api/admin/products/bamboo-chopsticks/images`, {
      cookie: admin.get(), body: { image: dataUriOf(jpg), variantKey: child.id },
    });
    ok("image can be attached to one colour", r.res.status === 201, `got ${r.res.status}`);
    childImg = r.json && r.json.image;
    ok("colour image records its variant", childImg && childImg.variantKey === child.id, childImg && childImg.variantKey);

    const foreign = await jreq("POST", "/api/admin/products/dotted-journal/images", {
      cookie: admin.get(), body: { image: dataUriOf(jpg), variantKey: child.id },
    });
    ok("a colour from another product is rejected", foreign.res.status === 400, `got ${foreign.res.status}`);

    /* a colour image is only removable through the admin route, and an
       unknown id must not silently succeed */
    const bogus = await jreq("DELETE", "/api/admin/images/999999", { cookie: admin.get() });
    ok("deleting an unknown image 404s", bogus.res.status === 404, `got ${bogus.res.status}`);

    await jreq("DELETE", `/api/admin/images/${childImg.id}`, { cookie: admin.get() });
    const gone = db.prepare("SELECT COUNT(*) n FROM product_images WHERE id = ?").get(childImg.id).n;
    ok("colour image deleted", gone === 0);
  } else {
    ok("colour variant row available to test", false, "no _vc-bamboo* row found");
  }

  /* --- ordering --- */
  console.log("\n[ordering]");
  const listRes = await jreq("GET", "/api/admin/products/bamboo-chopsticks/images", { cookie: admin.get() });
  const list = (listRes.json && listRes.json.images) || [];
  ok("gallery lists images", list.length > 0, `${list.length} images`);
  const reordered = await jreq("PUT", "/api/admin/products/bamboo-chopsticks/images/order", {
    cookie: admin.get(), body: { order: list.slice().reverse().map((x) => x.id) },
  });
  ok("gallery can be reordered", reordered.res.status === 200, `got ${reordered.res.status}`);
  const foreignOrder = await jreq("PUT", "/api/admin/products/bamboo-chopsticks/images/order", {
    cookie: admin.get(), body: { order: [999999] },
  });
  ok("reorder rejects foreign image ids", foreignOrder.res.status === 400, `got ${foreignOrder.res.status}`);
  /* put it back */
  await jreq("PUT", "/api/admin/products/bamboo-chopsticks/images/order", {
    cookie: admin.get(), body: { order: list.map((x) => x.id) },
  });

  /* --- storefront exposure --- */
  console.log("\n[storefront]");
  const pub = await jreq("GET", "/api/products?q=chopstick");
  const pubProduct = (pub.json.products || []).find((p) => p.id === "bamboo-chopsticks");
  ok("public catalog includes the gallery", !!(pubProduct && Array.isArray(pubProduct.images) && pubProduct.images.length),
    pubProduct && JSON.stringify(pubProduct.images));
  const pubImage = pubProduct && pubProduct.images[0];
  if (pubImage) {
    const r = await req("GET", pubImage.url);
    ok("customers can view product photos", r.status === 200, `got ${r.status}`);
  }

  /* --- cleanup --- */
  console.log("\n[cleanup]");
  await jreq("DELETE", `/api/admin/images/${img.id}`, { cookie: admin.get() });
  const left = db.prepare(
    "SELECT COUNT(*) n FROM product_images WHERE product_id='bamboo-chopsticks' AND alt_text='test shot'"
  ).get().n;
  ok("test image removed", left === 0, `${left} left`);
  const mime = db.prepare("SELECT mime FROM product_images WHERE id=?").get(img.id);
  ok("image row was deleted from the catalog", !mime);
  try { fs.unlinkSync(jpg); } catch (_e) { /* already gone */ }
  db.close();

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });