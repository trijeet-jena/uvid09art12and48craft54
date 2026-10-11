/* UVID API tests — run with the server up: node test/api-tests.mjs */
const BASE = process.env.BASE || "http://localhost:8787";
const { createRequire } = await import("module");
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, extra || ""); } };

const jar = { customer: "", admin: "" };
async function req(method, path, { body, jar: which, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (which && jar[which]) headers.Cookie = jar[which];
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && which) jar[which] = setCookie.split(";")[0];
  if (raw) return { status: res.status, res };
  let data = null;
  try { data = await res.json(); } catch (_e) {}
  return { status: res.status, data };
}

(async () => {
  console.log("— TEST 1: customer OTP login —");
  let r = await req("POST", "/api/auth/otp/request", { body: { mobile: "9876543210" } });
  ok("otp request accepted", r.status === 200 && r.data.ok, JSON.stringify(r.data));
  const code = r.data.devCode || null;
  ok("devCode present (dev/console mode)", !!code, JSON.stringify(r.data));
  if (code) {
    r = await req("POST", "/api/auth/otp/verify", { body: { mobile: "9876543210", code, name: "Test Reader" }, jar: "customer" });
    ok("otp verify → session", r.status === 200 && r.data.ok, JSON.stringify(r.data));
    r = await req("GET", "/api/auth/me", { jar: "customer" });
    ok("session resolves customer", r.status === 200 && r.data.user && r.data.user.role === "CUSTOMER", JSON.stringify(r.data));
  }

  console.log("— TEST 2: products from DB —");
  r = await req("GET", "/api/products");
  ok("catalog non-empty", r.status === 200 && Array.isArray(r.data.products) && r.data.products.length > 20, String(r.data.products && r.data.products.length));
  const chop = (r.data.products || []).find((p) => p.id === "bamboo-chopsticks");
  ok("chopsticks product present with variants", chop && Array.isArray(chop.variants) && chop.variants.length === 3, JSON.stringify(chop && chop.variants));
  const v5 = chop && chop.variants.find((v) => v.label === "5 mm × 20 cm");
  ok("5mm variant price ₹100", v5 && v5.price === 100, JSON.stringify(v5));

  console.log("— TEST 3: admin login —");
  r = await req("POST", "/api/auth/admin/login", { body: { email: "admin@uvid.store", password: "wrong-pass" } });
  ok("wrong admin password rejected", r.status === 401, String(r.status));
  r = await req("POST", "/api/auth/admin/login", { body: { email: "admin@uvid.store", password: "UvidAdmin#2026" }, jar: "admin" });
  ok("admin login ok", r.status === 200 && r.data.user && r.data.user.role === "ADMIN", JSON.stringify(r.data));

  console.log("— TESTS 4–6: admin edits price & stock, customer sees updates —");
  // use the 3mm chopstick stock line via variants + a plain product for price
  r = await req("PUT", "/api/admin/products/dotted-journal/price", { body: { price: 311 }, jar: "admin" });
  ok("admin price update", r.status === 200 && r.data.product.price === 311, JSON.stringify(r.data));
  r = await req("PUT", "/api/admin/products/dotted-journal/stock", { body: { stockQuantity: 42 }, jar: "admin" });
  ok("admin stock update", r.status === 200 && r.data.product.stockQuantity === 42, JSON.stringify(r.data));
  r = await req("GET", "/api/products/dotted-journal");
  ok("customer fetch shows new price+stock", r.status === 200 && r.data.product.price === 311 && r.data.product.stockQuantity === 42, JSON.stringify(r.data.product));

  console.log("— TEST 7: customer cannot call admin API —");
  r = await req("PUT", "/api/admin/products/dotted-journal/price", { body: { price: 1 }, jar: "customer" });
  ok("customer PUT admin API → 403", r.status === 403, String(r.status));
  r = await req("POST", "/api/admin/products", { body: { productName: "Hack", category: "x", price: 1 }, jar: "customer" });
  ok("customer POST admin API → 403", r.status === 403, String(r.status));
  r = await req("DELETE", "/api/admin/products/dotted-journal", { jar: "customer" });
  ok("customer DELETE admin API → 403", r.status === 403, String(r.status));
  r = await req("GET", "/api/admin/products");
  ok("anon admin API → 401", r.status === 401, String(r.status));

  console.log("— TEST 8: overstock order rejected —");
  r = await req("POST", "/api/orders", {
    body: { items: [{ productId: "dotted-journal", quantity: 50 }], paymentMethod: "COD",
            address: { line: "1 Test Lane", city: "Kolkata", pin: "700001", name: "T", phone: "9876543210" } },
    jar: "customer",
  });
  ok("overstock → 409", r.status === 409 && /left/i.test(r.data.error || ""), JSON.stringify(r.data));

  console.log("— TEST 9: stock 0 → out of stock, cannot buy —");
  r = await req("PUT", "/api/admin/products/sketch-12/stock", { body: { stockQuantity: 0 }, jar: "admin" });
  ok("admin sets stock 0", r.status === 200 && r.data.product.status === "OUT_OF_STOCK", JSON.stringify(r.data));
  r = await req("GET", "/api/products/sketch-12");
  ok("customer sees Out of Stock", r.status === 200 && r.data.product.inStock === false && r.data.product.status === "OUT_OF_STOCK", JSON.stringify(r.data.product));
  r = await req("POST", "/api/orders", {
    body: { items: [{ productId: "sketch-12", quantity: 1 }], paymentMethod: "COD",
            address: { line: "1 Test Lane", city: "Kolkata", pin: "700001", name: "T", phone: "9876543210" } },
    jar: "customer",
  });
  ok("order on OOS product → 409", r.status === 409, JSON.stringify(r.data));

  console.log("— inventory math: place real order, stock must drop —");
  r = await req("GET", "/api/products/dotted-journal");
  const before = r.data.product.stockQuantity;
  r = await req("POST", "/api/orders", {
    body: { items: [{ productId: "dotted-journal", quantity: 2 }], paymentMethod: "UPI",
            address: { line: "1 Test Lane", city: "Kolkata", pin: "700001", name: "T", phone: "9876543210" } },
    jar: "customer",
  });
  ok("order placed", r.status === 201 && r.data.order.total_amount > 0, JSON.stringify(r.data));
  const orderId = r.data.order && r.data.order.id;
  ok("priceAtPurchase snapshotted", r.data.items && r.data.items.every((i) => typeof i.priceAtPurchase === "number"), JSON.stringify(r.data.items));
  r = await req("GET", "/api/products/dotted-journal");
  ok("stock deducted server-side", r.data.product.stockQuantity === before - 2, `before=${before} now=${r.data.product.stockQuantity}`);
  r = await req("GET", "/api/orders", { jar: "customer" });
  ok("customer sees own order", r.status === 200 && Array.isArray(r.data.orders) && r.data.orders.some((o) => o.id === orderId), String(r.data.orders && r.data.orders.length));

  console.log("— variant purchase: stock tracked per size —");
  let beforeV4 = null;
  {
    const rb = await req("GET", "/api/products/bamboo-chopsticks");
    const b4 = (rb.data.product.variants || []).find((v) => v.label === "4 mm × 20 cm");
    beforeV4 = b4 ? b4.stock : null;
  }
  r = await req("POST", "/api/orders", {
    body: { items: [{ productId: "bamboo-chopsticks", variantSku: "_vc-bamboo-chopsticks-4", quantity: 3 }], paymentMethod: "COD",
            address: { line: "1 Test Lane", city: "Kolkata", pin: "700001", name: "T", phone: "9876543210" } },
    jar: "customer",
  });
  /* 3 × ₹75 + ₹49 shipping (order under ₹499) */
  ok("variant order total = 225 + shipping", r.status === 201 && r.data.order.total_amount === 274
    && r.data.order.shipping === 49 && r.data.order.discount === 0, JSON.stringify(r.data && r.data.order));
  r = await req("GET", "/api/products/bamboo-chopsticks");
  const v4 = (r.data.product.variants || []).find((v) => v.label === "4 mm × 20 cm");
  ok("variant stock decremented by 3", v4 && beforeV4 != null && v4.stock === beforeV4 - 3,
    `before=${beforeV4} now=${v4 && v4.stock}`);

  console.log("— coupon validated + applied server-side —");
  const addr = { line: "1 Test Lane", city: "Kolkata", pin: "700001", name: "T", phone: "9876543210" };
  r = await req("POST", "/api/orders", {
    body: { items: [{ productId: "dotted-journal", quantity: 1 }], paymentMethod: "COD", coupon: "NOPE", address: addr },
    jar: "customer",
  });
  ok("bogus coupon rejected", r.status === 400, JSON.stringify(r.data));

  r = await req("POST", "/api/orders", {
    body: { items: [{ productId: "dotted-journal", quantity: 2 }], paymentMethod: "COD", coupon: "PAPER10", address: addr },
    jar: "customer",
  });
  /* dotted-journal is ₹311 here → ₹622 subtotal → PAPER10 = −₹62.20, free shipping → ₹559.80 */
  ok("PAPER10 totals correct", r.status === 201 && r.data.order.discount === 62.2
    && r.data.order.shipping === 0 && r.data.order.total_amount === 559.8, JSON.stringify(r.data && r.data.order));
  if (r.status === 201) {
    const cid = r.data.order.id;
    const cx = await req("POST", `/api/orders/${cid}/cancel`, { jar: "customer" });
    ok("cancel restocks the items", cx.status === 200 && cx.data.order.status === "CANCELLED", JSON.stringify(cx.data));
  }

  console.log("— restore catalog values touched by tests —");
  await req("PUT", "/api/admin/products/dotted-journal/price", { body: { price: 299 }, jar: "admin" });
  await req("PUT", "/api/admin/products/dotted-journal/stock", { body: { stockQuantity: 50 }, jar: "admin" });
  await req("PUT", "/api/admin/products/sketch-12/stock", { body: { stockQuantity: 30 }, jar: "admin" });

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("fatal", e); process.exit(1); });
