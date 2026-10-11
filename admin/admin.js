/* ============================================================
   UVID Admin — admin panel application
   Login · dashboard · product management (with variants +
   image upload) · categories · orders · customers · settings
   All data flows through the API → SQLite (single source).
   ============================================================ */
"use strict";
(function () {
  /* ---------------- icons ---------------- */
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
  }
  const ICONS = {
    grid: svg('<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>'),
    box: svg('<path d="M21 8.5l-9-5-9 5v7l9 5 9-5v-7z"/><path d="M3 8.5l9 5 9-5"/><path d="M12 13.5v9"/>'),
    tag: svg('<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7.2-7.2A2 2 0 013 12V5a2 2 0 012-2h7a2 2 0 011.4.6l7.2 7.2a2 2 0 010 2.6z"/><circle cx="7.8" cy="7.8" r="1.4"/>'),
    receipt: svg('<path d="M6 3h12v18l-3-1.8L12 21l-3-1.8L6 21V3z"/><path d="M9.5 8h5"/><path d="M9.5 12h5"/>'),
    users: svg('<circle cx="9" cy="8" r="3.6"/><path d="M2.8 20a6.4 6.4 0 0112.4 0"/><path d="M16.2 5.2a3.6 3.6 0 010 6.9"/><path d="M17.6 14.6A6.4 6.4 0 0121.4 20"/>'),
    clip: svg('<path d="M8 4h8v3a4 4 0 01-8 0V4z"/><path d="M8 5.5H5.5A2.5 2.5 0 008 10h1"/><path d="M16 5.5h2.5A2.5 2.5 0 0116 10h-1"/><rect x="5" y="3.5" width="14" height="17.5" rx="2.6"/>'),
    down: svg('<path d="M12 3.5v12"/><path d="M7.5 11.5L12 16l4.5-4.5"/><path d="M4.5 20h15"/>'),
    gear: svg('<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4M5.9 5.9l1.7 1.7M16.4 16.4l1.7 1.7M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    trash: svg('<path d="M3.5 6h17"/><path d="M9 6V4.2A1.2 1.2 0 0110.2 3h3.6A1.2 1.2 0 0115 4.2V6"/><path d="M5.5 6l1 13.2A1.8 1.8 0 008.3 21h7.4a1.8 1.8 0 001.8-1.8L18.5 6"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    edit: svg('<path d="M12 20h8.5"/><path d="M16.7 3.8a2.1 2.1 0 013 3L7.4 19.1 3.5 20l.9-3.9L16.7 3.8z"/>'),
    layers: svg('<path d="M12 3l9 4.8-9 4.8-9-4.8L12 3z"/><path d="M3 12.5l9 4.8 9-4.8"/><path d="M3 17.2l9 4.8 9-4.8"/>'),
    search: svg('<circle cx="10.8" cy="10.8" r="6.8"/><path d="M20 20l-4.4-4.4"/>'),
    power: svg('<path d="M18.4 6.6a9 9 0 11-12.7 0"/><path d="M12 2.5v9.5"/>'),
    ext: svg('<path d="M18 13.5V19a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h5.5"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>'),
    img: svg('<rect x="3" y="4" width="18" height="16" rx="2.4"/><circle cx="8.6" cy="9.4" r="1.8"/><path d="M21 16.5l-5.2-5.2L4.5 21"/>'),
    rupee: svg('<path d="M7 4h10"/><path d="M7 8.5h10"/><path d="M13.6 4c2.8 0 4.4 1.7 4.4 4.3 0 2.4-1.6 4-4.2 4H7l7.5 7.7"/>')
  };
  function renderIcons(root) {
    (root || document).querySelectorAll("[data-ic]").forEach(function (el) {
      const k = el.getAttribute("data-ic");
      if (ICONS[k] && !el.firstChild) el.innerHTML = ICONS[k];
    });
  }

  /* ---------------- helpers ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) { return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
  function toDate(s) {
    if (!s) return null;
    const str = String(s);
    const d = new Date(/Z|[+-]\d\d:\d\d$/.test(str) || str.includes("T") ? str : str.replace(" ", "T") + "Z");
    return isNaN(d) ? null : d;
  }
  function fmtDate(s) {
    const d = toDate(s);
    return d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
  }
  function fmtDateTime(s) {
    const d = toDate(s);
    return d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
  }
  function slugify(s) {
    return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }

  /* ---------------- elements ---------------- */
  const loginView = $("#loginView"), appView = $("#appView"), content = $("#content");
  const modalRoot = $("#modalRoot"), toastRoot = $("#toastRoot");

  /* ---------------- api client ---------------- */
  function reachHelp() {
    /* opened directly from disk (file://)? the admin app needs the Node server */
    var proto = location.protocol || "";
    if (proto === "file:") return "The admin panel runs through the store server. Close this page and double-click START-STORE.bat in the zip folder, then open http://localhost:8787/admin/";
    return "Cannot reach the server. Double-click START-STORE.bat in the store folder and try again.";
  }
  async function api(method, path, body, opts) {
    opts = opts || {};
    let res;
    try {
      res = await fetch(path, {
        method: method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
      });
    } catch (_e) {
      throw new Error(reachHelp());
    }
    let data = null;
    try { data = await res.json(); } catch (_e) { /* no body */ }
    if (res.status === 401 || res.status === 403) {
      const err = new Error((data && data.error) || "Not authorized.");
      err.status = res.status;
      if (!opts.quiet) sessionExpired((data && data.error) || null);
      throw err;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || "Request failed. Please try again.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------------- toast ---------------- */
  function toast(msg, ok) {
    const t = document.createElement("div");
    t.className = "toast" + (ok === false ? " toast--err" : "");
    t.textContent = msg;
    toastRoot.appendChild(t);
    setTimeout(function () { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2800);
    setTimeout(function () { t.remove(); }, 3200);
  }

  /* ---------------- modal system ---------------- */
  let pendingResolve = null;
  function openModal(html, cls) {
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = '<div class="modal ' + (cls || "") + '" role="dialog" aria-modal="true">' + html + "</div>";
    back.addEventListener("mousedown", function (e) { if (e.target === back) closeModal(); });
    modalRoot.appendChild(back);
    document.body.classList.add("modal-open"); /* freeze background scroll */
    renderIcons(back);
    const first = back.querySelector(".modal__body input:not([type=file]), .modal__body select, .modal__body textarea, .modal__head button");
    if (first) setTimeout(function () { try { first.focus(); } catch (_e) {} }, 60);
    return back;
  }
  function closeModal() {
    if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(false); }
    modalRoot.innerHTML = "";
    if (!modalRoot.childElementCount) document.body.classList.remove("modal-open");
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modalRoot.childElementCount) closeModal();
  });
  function confirmDialog(msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      pendingResolve = resolve;
      const back = openModal(
        '<div class="modal__head"><h3>' + esc(opts.title || "Please confirm") + '</h3>' +
        '<button class="iconbtn" data-close aria-label="Close">' + ICONS.x + "</button></div>" +
        '<div class="modal__body"><p class="confirm-msg">' + esc(msg) + "</p></div>" +
        '<div class="modal__foot">' +
        '<button class="btn btn--ghost" data-close>' + esc(opts.no || "Cancel") + "</button>" +
        '<button class="btn ' + (opts.danger === false ? "btn--primary" : "btn--danger") + '" data-yes>' + esc(opts.yes || "Confirm") + "</button>" +
        "</div>");
      back.querySelector("[data-yes]").addEventListener("click", function () {
        pendingResolve = null; modalRoot.innerHTML = ""; resolve(true);
      });
    });
  }
  function busy(btn, label) {
    if (!btn) return function () {};
    const old = btn.innerHTML;
    btn.disabled = true; btn.textContent = label || "Working…";
    return function () { btn.disabled = false; btn.innerHTML = old; };
  }

  /* ---------------- auth ---------------- */
  const state = {
    route: "dashboard",
    user: null,
    products: [],
    categories: [],
    stats: null,
    orders: [],
    customers: [],
    filters: { q: "", cat: "", status: "" },
    orderFilter: "",
  };

  function showLogin(msg) {
    loginView.hidden = false;
    appView.hidden = true;
    resetLoginStep();
    const err = $("#loginError");
    if (msg) { err.textContent = msg; err.hidden = false; } else { err.hidden = true; }
    setLive(false);
  }
  function sessionExpired(msg) {
    if (!appView.hidden) { showLogin(msg || "Session expired. Please sign in again."); toast("Session expired", false); }
  }
  function startApp(user) {
    state.user = user;
    loginView.hidden = true;
    appView.hidden = false;
    $("#adminChip").textContent = user.name || "Admin";
    connectEvents();
    router();
  }

  /* ---- sign-in with optional TOTP second factor ---- */
  let mfaPending = null; /* email awaiting the second factor */

  function resetLoginStep() {
    mfaPending = null;
    const pw = $("#pwField"), mfa = $("#mfaField"), btn = $("#loginBtn"), input = $("#loginMfa");
    if (pw) pw.hidden = false;
    if (mfa) mfa.hidden = true;
    if (input) input.value = "";
    if (btn) btn.textContent = "Sign in to dashboard";
  }

  $("#loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const err = $("#loginError"); err.hidden = true;

    if (!mfaPending) {
      const email = $("#loginEmail").value.trim();
      const password = $("#loginPassword").value;
      if (!email || !password) { err.textContent = "Email and password are required."; err.hidden = false; return; }
    }

    const undo = busy($("#loginBtn"), mfaPending ? "Verifying…" : "Signing in…");
    try {
      if (mfaPending) {
        const code = String($("#loginMfa").value || "").trim();
        if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code from your authenticator app.");
        const out = await api("POST", "/api/auth/admin/mfa/verify", { code: code }, { quiet: true });
        undo(); resetLoginStep();
        toast("Welcome back, " + (out.user.name || "Admin"), true);
        startApp(out.user);
        return;
      }
      const email2 = $("#loginEmail").value.trim();
      const out = await api("POST", "/api/auth/admin/login", { email: email2, password: $("#loginPassword").value }, { quiet: true });
      undo();
      if (out && out.mfa) {
        /* password passed — second factor required before a session is issued */
        mfaPending = email2;
        $("#pwField").hidden = true;
        $("#mfaField").hidden = false;
        $("#loginBtn").textContent = "Verify code & sign in";
        toast("Enter your 6-digit authenticator code", true);
        $("#loginMfa").focus();
        return;
      }
      toast("Welcome back, " + (out.user.name || "Admin"), true);
      startApp(out.user);
    } catch (ex) {
      undo();
      err.textContent = ex.message || "Invalid admin credentials.";
      err.hidden = false;
    }
  });

  $("#logoutBtn").addEventListener("click", async function () {
    try { await api("POST", "/api/auth/logout", {}, { quiet: true }); } catch (_e) { /* already gone */ }
    showLogin("");
    toast("Logged out.", true);
  });

  async function boot() {
    renderIcons();
    try {
      const me = await api("GET", "/api/auth/me", undefined, { quiet: true });
      if (me && me.user && me.user.role === "ADMIN") return startApp(me.user);
      showLogin(me && me.user ? "This account is a customer, not an admin." : "");
    } catch (_e) {
      showLogin("");
    }
  }

  /* ---------------- router ---------------- */
  const TITLES = {
    dashboard: "Dashboard", products: "Product management", categories: "Categories",
    orders: "Orders", customers: "Customers", settings: "Settings",
    seminar: "Seminar",
  };
  function currentRoute() {
    const r = (location.hash || "#/dashboard").replace(/^#\/?/, "").split("?")[0];
    return TITLES[r] ? r : "dashboard";
  }
  async function router() {
    const r = currentRoute();
    state.route = r;
    $("#pageTitle").textContent = TITLES[r];
    $$("#sideNav a").forEach(function (a) { a.classList.toggle("active", a.dataset.route === r); });
    closeDrawer();
    try { await VIEWS[r](); } catch (e) {
      content.innerHTML = errorCard(e);
      renderIcons(content);
    }
  }
  window.addEventListener("hashchange", router);

  function errorCard(e) {
    return '<div class="panel"><div class="panel__body empty"><b>Something went wrong</b>' +
      esc(e.message || "Unknown error") +
      '<p style="margin-top:14px"><button class="btn btn--primary" onclick="location.reload()">Retry</button></p></div></div>';
  }
  function loadingCard() { return '<div class="panel"><div class="panel__body empty">Loading from database…</div></div>'; }

  /* repaint preserving focus (for live updates) */
  async function repaint(viewFn) {
    const ae = document.activeElement;
    const fid = ae && ae.id && content.contains(ae) ? ae.id : null;
    let sel = null;
    try { sel = ae && ae.selectionStart; } catch (_e) { /* number input */ }
    try { await viewFn(); } catch (e) { content.innerHTML = errorCard(e); renderIcons(content); }
    if (fid) {
      const el = document.getElementById(fid);
      if (el && el.focus) {
        el.focus();
        try { if (sel != null) el.setSelectionRange(sel, sel); } catch (_e) {}
      }
    }
  }

  /* ---------------- drawer ---------------- */
  function closeDrawer() {
    $("#sidebar").classList.remove("open");
    $("#sideBackdrop").hidden = true;
  }
  $("#menuBtn").addEventListener("click", function () {
    $("#sidebar").classList.add("open");
    $("#sideBackdrop").hidden = false;
  });
  $("#sideBackdrop").addEventListener("click", closeDrawer);

  /* ---------------- live updates (SSE) ---------------- */
  let pollT = null, refreshT = null;
  function setLive(on) {
    const p = $("#livePill");
    if (!p) return;
    p.classList.toggle("off", !on);
    p.innerHTML = "<i></i> " + (on ? "Live" : "Offline");
  }
  function connectEvents() {
    /* Netlify's proxy to the Cloudflare Worker is request/response based.
       Poll instead of opening an SSE connection that would keep reconnecting. */
    if (pollT) return;
    setLive(true);
    pollT = setInterval(async function () {
      if (modalRoot.childElementCount > 0) return;
      const ae = document.activeElement;
      if (ae && content.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
      try {
        await loadState(state.route);
        await repaint(function () { return VIEWS[state.route](); });
        setLive(true);
      } catch (_e) { setLive(false); }
    }, 30000);
  }

  async function loadState(route) {
    if (route === "products") {
      const [p, c] = await Promise.all([api("GET", "/api/admin/products"), api("GET", "/api/admin/categories")]);
      state.products = p.products; state.categories = c.categories;
    } else if (route === "categories") {
      const c = await api("GET", "/api/admin/categories"); state.categories = c.categories;
    } else if (route === "orders") {
      const o = await api("GET", "/api/admin/orders" + (state.orderFilter ? "?status=" + state.orderFilter : ""));
      state.orders = o.orders;
    } else if (route === "dashboard") {
      const s = await api("GET", "/api/admin/stats"); state.stats = s.stats;
    }
  }

  /* ---------------- shared bits ---------------- */
  function pBadge(p) {
    if (p.status === "ARCHIVED") return '<span class="badge badge--grey">Inactive</span>';
    if (!p.inStock || effStock(p) <= 0) return '<span class="badge badge--amber">Out of stock</span>';
    return '<span class="badge badge--green">Active</span>';
  }
  function kids(p) { return state.products.filter(function (c) { return c.parent === p.id; }); }
  function effStock(p) {
    const k = kids(p);
    if (!k.length) return p.stockQuantity;
    return k.reduce(function (s, c) { return s + c.stockQuantity; }, 0);
  }
  function pImg(p, size) {
    const s = size || 46;
    if (p.imageUrl) return '<img src="' + esc(p.imageUrl) + '" alt="" loading="lazy" style="width:' + s + "px;height:" + s + 'px">';
    return '<span style="width:' + s + "px;height:" + s + 'px;border-radius:10px;background:var(--brand-soft);display:grid;place-items:center;font-size:' + Math.round(s / 2.2) + 'px;flex:none">' + esc(p.emoji || "📦") + "</span>";
  }
  const ORDER_STATUSES = [["PLACED", "Placed"], ["PACKED", "Packed"], ["SHIPPED", "Shipped"], ["OUT_FOR_DELIVERY", "Out for delivery"], ["DELIVERED", "Delivered"], ["CANCELLED", "Cancelled"]];
  function orderLabel(s) { const f = ORDER_STATUSES.find(function (x) { return x[0] === s; }); return f ? f[1] : s; }
  function orderBadge(s) {
    const tone = { PLACED: "green", PACKED: "green", SHIPPED: "amber", OUT_FOR_DELIVERY: "amber", DELIVERED: "green", CANCELLED: "red" }[s] || "grey";
    return '<span class="badge badge--' + tone + '">' + orderLabel(s) + "</span>";
  }

  /* ============================================================
     VIEWS
     ============================================================ */
  const VIEWS = {};

  /* ---------------- dashboard ---------------- */
  VIEWS.dashboard = async function () {
    content.innerHTML = loadingCard();
    await loadState("dashboard");
    const s = state.stats;
    content.innerHTML =
      '<div class="page-head"><div><h3>Store overview</h3><p>Live numbers from the database · ' + esc(fmtDateTime(new Date().toISOString())) + "</p></div>" +
      '<a class="btn btn--primary" href="#/products">' + ICONS.plus + " Manage products</a></div>" +
      '<div class="stats">' +
      statCard("box", "", s.products, "Total products") +
      statCard("layers", "", s.inStock, "Products in stock") +
      statCard("x", "red", s.outOfStock, "Out of stock") +
      statCard("receipt", "tang", s.orders, "Total orders") +
      statCard("rupee", "amber", money(s.revenue), "Revenue") +
      statCard("users", "", s.customers, "Customers") +
      "</div>" +
      '<div class="dash-grid">' +
      '<section class="panel"><div class="panel__head"><h4>Recent products</h4><a href="#/products">View all →</a></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Product</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th></tr></thead><tbody>' +
      (s.recentProducts.length ? s.recentProducts.map(function (p) {
        return "<tr><td><div class=\"pcell\">" + pImg(p, 40) + "<div><b>" + esc(p.product_name) + "</b><small>" + esc(p.category) + " · " + esc(fmtDateTime(p.updated_at)) + "</b></small></div></div></td>" +
          '<td class="num">' + money(p.price) + '</td><td class="num">' + p.stock_quantity + "</td><td>" +
          (p.status === "ARCHIVED" ? '<span class="badge badge--grey">Inactive</span>' : p.stock_quantity > 0 ? '<span class="badge badge--green">Active</span>' : '<span class="badge badge--amber">Out of stock</span>') +
          "</td></tr>";
      }).join("") : '<tr><td colspan="4" class="empty">No products yet</td></tr>') +
      "</tbody></table></div></section>" +
      '<section class="panel"><div class="panel__head"><h4>Recent orders</h4><a href="#/orders">View all →</a></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Customer</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>' +
      (s.recentOrders.length ? s.recentOrders.map(function (o) {
        return "<tr><td><b>" + esc(o.id) + "</b><br><small>" + esc(fmtDateTime(o.created_at)) + "</small></td>" +
          "<td>" + esc(o.customerName || "—") + "<br><small>" + esc(o.mobile_number || "") + "</small></td>" +
          '<td class="num">' + money(o.total_amount) + "</td><td>" + orderBadge(o.status) + "</td></tr>";
      }).join("") : '<tr><td colspan="4" class="empty">No orders yet</td></tr>') +
      "</tbody></table></div></section></div>";
    renderIcons(content);
  };
  function statCard(ic, tone, val, label) {
    return '<div class="stat"><span class="stat__ic ' + (tone || "") + '">' + ICONS[ic] + "</span><div><b>" + esc(String(val)) + "</b><span>" + esc(label) + "</span></div></div>";
  }

  /* ---------------- products ---------------- */
  VIEWS.products = async function () {
    content.innerHTML = loadingCard();
    await loadState("products");
    content.innerHTML =
      '<div class="page-head"><div><h3>Products</h3><p>' + state.products.filter(function (p) { return !p.parent; }).length +
      ' products · changes appear on the storefront instantly</p></div>' +
      '<button class="btn btn--primary" id="addProdBtn">' + ICONS.plus + " Add product</button></div>" +
      '<section class="panel"><div class="panel__head"><div class="filters">' +
      '<input id="prodSearch" type="search" placeholder="Search products…" value="' + esc(state.filters.q) + '" aria-label="Search products">' +
      '<select id="prodCat" aria-label="Category"><option value="">All categories</option>' +
      state.categories.map(function (c) {
        return '<option value="' + esc(c.slug) + '"' + (state.filters.cat === c.slug ? " selected" : "") + ">" + esc(c.name) + "</option>";
      }).join("") + "</select>" +
      '<select id="prodStatus" aria-label="Status"><option value="">Any status</option>' +
      ["active", "out", "inactive"].map(function (v) {
        const lbl = { active: "Active", out: "Out of stock", inactive: "Inactive" }[v];
        return '<option value="' + v + '"' + (state.filters.status === v ? " selected" : "") + ">" + lbl + "</option>";
      }).join("") + "</select>" +
      "</div></div>" +
      '<div class="table-wrap"><table class="tbl" style="min-width:860px"><thead><tr>' +
      "<th>Product</th><th>Category</th><th class=\"num\">Price</th><th class=\"num\">Stock</th><th>Status</th><th style=\"text-align:right\">Actions</th>" +
      '</tr></thead><tbody id="prodRows"></tbody></table></div></section>';
    renderIcons(content);
    $("#addProdBtn").addEventListener("click", function () { openProductModal(null); });
    $("#prodSearch").addEventListener("input", function (e) { state.filters.q = e.target.value; paintProductRows(); });
    $("#prodCat").addEventListener("change", function (e) { state.filters.cat = e.target.value; paintProductRows(); });
    $("#prodStatus").addEventListener("change", function (e) { state.filters.status = e.target.value; paintProductRows(); });
    paintProductRows();
  };

  function filteredProducts() {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    return state.products.filter(function (p) {
      if (p.parent) return false; /* size variants are edited inside their parent */
      if (q && (p.productName + " " + p.id + " " + p.description).toLowerCase().indexOf(q) === -1) return false;
      if (f.cat && p.category !== f.cat) return false;
      if (f.status === "active" && !(p.status !== "ARCHIVED" && effStock(p) > 0)) return false;
      if (f.status === "out" && (p.status === "ARCHIVED" || effStock(p) > 0)) return false;
      if (f.status === "inactive" && p.status !== "ARCHIVED") return false;
      return true;
    });
  }

  function paintProductRows() {
    const tbody = $("#prodRows");
    if (!tbody) return;
    const rows = filteredProducts();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty"><b>No products found</b>Try a different search, or add a new product.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (p) {
      const k = kids(p);
      const stock = effStock(p);
      const off = p.mrp != null && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
      return "<tr>" +
        '<td><div class="pcell">' + pImg(p) + "<div><b>" + esc(p.productName) + "</b><small>" + esc(p.id) + (k.length ? " · " + k.length + " sizes" : "") + "</small></div></div></td>" +
        "<td>" + esc(p.category) + "</td>" +
        '<td class="num"><b>' + money(p.price) + "</b>" + (off ? ' <s style="color:var(--muted);font-size:12.5px">' + money(p.mrp) + "</s> <small style=\"color:var(--tang)\">-" + off + "%</small>" : "") + "</td>" +
        '<td class="num">' + stock + "</td>" +
        "<td>" + pBadge(p) + "</td>" +
        '<td><div class="row-actions">' +
        '<button class="btn btn--ghost btn--sm" data-act="edit" data-id="' + esc(p.id) + '">Edit</button>' +
        '<button class="btn btn--ghost btn--sm" data-act="stock" data-id="' + esc(p.id) + '">Stock</button>' +
        '<button class="btn btn--ghost btn--sm" data-act="toggle" data-id="' + esc(p.id) + '">' + (p.status === "ARCHIVED" ? "Activate" : "Deactivate") + "</button>" +
        '<button class="btn btn--ghost btn--sm" data-act="del" data-id="' + esc(p.id) + '" style="color:var(--red)">Delete</button>' +
        "</div></td></tr>";
    }).join("");
  }

  content.addEventListener("click", async function (e) {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const p = state.products.find(function (x) { return x.id === btn.dataset.id; });
    if (!p) return;
    try {
      if (btn.dataset.act === "edit") openProductModal(p);
      else if (btn.dataset.act === "stock") openStockModal(p);
      else if (btn.dataset.act === "toggle") {
        if (p.status === "ARCHIVED") {
          await api("PUT", "/api/admin/products/" + encodeURIComponent(p.id), { status: "ACTIVE" });
          toast('"' + p.productName + '" is live again', true);
        } else {
          await api("PUT", "/api/admin/products/" + encodeURIComponent(p.id), { status: "ARCHIVED" });
          toast('"' + p.productName + '" deactivated — hidden from customers', true);
        }
        await repaint(VIEWS.products);
      } else if (btn.dataset.act === "del") {
        const ok = await confirmDialog('Delete "' + p.productName + '"? This cannot be undone.', { yes: "Delete product" });
        if (!ok) return;
        const k = kids(p);
        const out = await api("DELETE", "/api/admin/products/" + encodeURIComponent(p.id));
        for (const child of k) {
          try { await api("DELETE", "/api/admin/products/" + encodeURIComponent(child.id)); } catch (_e) { /* already archived */ }
        }
        toast(out && out.archived ? "Product removed from sale (order history kept)" : "Product deleted", true);
        await repaint(VIEWS.products);
      }
    } catch (ex) { toast(ex.message, false); }
  });

  /* stock quick modal */
  function openStockModal(p) {
    const back = openModal(
      '<div class="modal__head"><h3>Update stock — ' + esc(p.productName) + "</h3>" +
      '<button class="iconbtn" data-close aria-label="Close">' + ICONS.x + "</button></div>" +
      '<form id="stockForm"><div class="modal__body">' +
      '<label class="fld"><span>Stock quantity</span><input id="stockVal" type="number" min="0" step="1" value="' + p.stockQuantity + '" required>' +
      "<small>Set 0 and the storefront will show “Out of stock” and block purchases automatically.</small></label>" +
      '<p class="form-error" id="stockErr" hidden></p></div>' +
      '<div class="modal__foot"><button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn--primary" id="stockSave">Save stock</button></div></form>');
    $("#stockForm", back).addEventListener("submit", async function (e) {
      e.preventDefault();
      const err = $("#stockErr", back); err.hidden = true;
      const n = Number($("#stockVal", back).value);
      if (!Number.isInteger(n) || n < 0) { err.textContent = "Stock must be a whole number ≥ 0."; err.hidden = false; return; }
      const undo = busy($("#stockSave", back), "Saving…");
      try {
        await api("PUT", "/api/admin/products/" + encodeURIComponent(p.id) + "/stock", { stockQuantity: n });
        undo(); closeModal();
        toast("Stock updated to " + n, true);
        await repaint(VIEWS.products);
      } catch (ex) { undo(); err.textContent = ex.message; err.hidden = false; }
    });
  }

  /* ---------------- product add/edit modal ---------------- */
  async function openProductModal(p) {
    if (!state.categories.length) {
      try { const c = await api("GET", "/api/admin/categories"); state.categories = c.categories; } catch (_e) { /* handled by form */ }
    }
    const editing = !!p;
    const children = editing ? state.products.filter(function (c) { return c.parent === p.id; }) : [];
    const base = editing ? (p.mrp != null && p.mrp >= p.price ? p.mrp : p.price) : "";
    const disc = editing && p.mrp != null && p.mrp > p.price ? p.price : "";
    const inactive = editing && p.status === "ARCHIVED";

    const back = openModal(
      '<div class="modal__head"><h3>' + (editing ? "Edit product" : "Add product") + "</h3>" +
      '<button class="iconbtn" data-close aria-label="Close">' + ICONS.x + "</button></div>" +
      '<form id="pForm" novalidate><div class="modal__body">' +
      '<p class="form-error" id="pErr" hidden></p>' +
      '<div class="form-grid">' +
      '<label class="fld"><span>Product name <i>*</i></span><input name="name" maxlength="120" required value="' + esc(editing ? p.productName : "") + '"></label>' +
      '<label class="fld"><span>Product ID / SKU</span><input name="sku" placeholder="auto from name" ' + (editing ? 'value="' + esc(p.id) + '" disabled' : "") + ">" +
      (editing ? "<small>IDs can't change after creation.</small>" : "") + "</label>" +
      '<label class="fld"><span>Category <i>*</i></span><select name="category" required>' +
      '<option value="">Choose…</option>' +
      state.categories.map(function (c) {
        return '<option value="' + esc(c.slug) + '"' + (editing && p.category === c.slug ? " selected" : "") + ">" + esc(c.name) + "</option>";
      }).join("") + "</select></label>" +
      '<label class="fld"><span>Status</span><select name="status">' +
      '<option value="ACTIVE"' + (!inactive ? " selected" : "") + ">Active</option>" +
      '<option value="ARCHIVED"' + (inactive ? " selected" : "") + ">Inactive (hidden from store)</option></select></label>" +
      '<label class="fld span2"><span>Description <i>*</i></span><textarea name="desc" maxlength="2000" required>' + esc(editing ? p.description : "") + "</textarea></label>" +
      '<div class="fld span2"><span>Product image</span><div class="imgpick">' +
      '<div class="imgpick__prev" id="imgPrev">' + (editing && p.imageUrl ? '<img src="' + esc(p.imageUrl) + '" alt="">' : ICONS.img) + "</div>" +
      '<div class="imgpick__ctrl">' +
      '<label class="fld" style="margin-bottom:8px"><input name="imageUrl" placeholder="https://… or /uploads/…" value="' + (editing && p.imageUrl && !String(p.imageUrl).startsWith("data:") ? esc(p.imageUrl) : "") + '"></label>' +
      '<input type="file" id="imgFile" accept="image/*">' +
      '<button type="button" class="btn btn--ghost btn--sm" id="imgPick">Upload image</button> ' +
      '<small>JPEG / PNG / WebP — auto-compressed to ~1400px before upload.</small></div></div></div>' +
      '<label class="fld"><span>Product price (₹) <i>*</i></span><input name="price" type="number" min="0" step="0.01" required value="' + base + '"><small>List price the store compares against.</small></label>' +
      '<label class="fld"><span>Discount price (₹, optional)</span><input name="discount" type="number" min="0" step="0.01" value="' + disc + '"><small>What the customer pays. Leave blank for full price.</small></label>' +
      '<label class="fld"><span>Stock quantity <i>*</i></span><input name="stock" type="number" min="0" step="1" required value="' + (editing ? p.stockQuantity : "") + '"></label>' +
      '<label class="fld"><span>Emoji (art fallback)</span><input name="emoji" maxlength="4" placeholder="📦" value="' + esc(editing && p.emoji ? p.emoji : "") + '"></label>' +
      "</div>" +
      '<div class="fld"><span>Size variants (optional)</span><div class="varbox">' +
      '<p class="varbox__hint">Variants (e.g. 3 mm / 4 mm / 5 mm) are stocked and priced independently — customers pick them with thumbnails on the product page.</p>' +
      '<div id="varList">' + children.map(varRowHtml).join("") + "</div>" +
      '<button type="button" class="btn btn--ghost btn--sm var-add" id="varAdd">' + ICONS.plus + " Add variant</button>" +
      "</div></div>" +
      '<div class="fld span2"><span>Photos</span><div class="varbox">' +
      '<p class="varbox__hint">Every photo is stored in the image database. The first one is the main photo. Choose a colour to add photos for that colour only.</p>' +
      '<div class="gal__tabs" id="galTabs"></div>' +
      '<div class="gal" id="galGrid"></div>' +
      '<input type="file" id="galFile" accept="image/*" multiple>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="galAdd">' + ICONS.plus + " Add photos</button>" +
      '<small>JPEG / PNG / WebP — several files at once is fine.</small></div></div>' +
      "</div>" +
      '<div class="modal__foot"><button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn--primary" id="pSave">' + (editing ? "Save changes" : "Add product") + "</button></div></form>",
      editing ? "modal--wide" : "");

    renderIcons(back);
    const form = $("#pForm", back);

    /* image picking */
    let uploadedUrl = null;
    $("#imgPick", back).addEventListener("click", function () { $("#imgFile", back).click(); });
    $("#imgFile", back).addEventListener("change", async function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await prepareImage(file);
        uploadedUrl = dataUrl;
        $("#imgPrev", back).innerHTML = '<img src="' + dataUrl + '" alt="">';
        form.imageUrl.value = "";
        toast("Image ready — uploads when you save", true);
      } catch (ex) { toast(ex.message, false); }
    });

    /* ---- photo gallery (stored in the image database) ----
       scope "" = the product itself, otherwise a colour variant id.
       Images are written immediately, so work is never lost by navigating
       away before the product form itself is saved. */
    let galScope = "";
    let galBusy = false;

    function variantOptions() {
      return $$(".vrow", back)
        .map(function (row) {
          return { id: row.dataset.cid || "", label: ($(".v-label", row) || {}).value || "New colour" };
        })
        .filter(function (v) { return !!v.id; });
    }

    function renderGalTabs() {
      const opts = [{ id: "", label: "All colours / product" }].concat(variantOptions());
      if (galScope && !opts.some(function (o) { return o.id === galScope; })) galScope = "";
      $("#galTabs", back).innerHTML = opts.map(function (o) {
        return '<button type="button" class="chip' + (o.id === galScope ? " chip--on" : "") + '" data-gal="' + esc(o.id) + '">' + esc(o.label) + "</button>";
      }).join("");
    }

    function renderGal() {
      const grid = $("#galGrid", back);
      if (!editing) {
        grid.innerHTML = '<p class="gal__empty">Save the product first, then add photos here — each one is stored in the image database.</p>';
        return;
      }
      const imgs = (p.images || []).filter(function (im) { return (im.variantKey || "") === galScope; });
      if (!imgs.length) {
        grid.innerHTML = '<p class="gal__empty">No photos for this colour yet.</p>';
        return;
      }
      grid.innerHTML = imgs.map(function (im, i) {
        return '<figure class="gal__item">' +
          '<img src="' + esc(im.url) + '" alt="' + esc(im.altText || "") + '" loading="lazy">' +
          (i === 0 ? '<span class="gal__badge">Main</span>' : "") +
          (i > 0 ? '<button type="button" class="gal__main" data-gal-main="' + im.id + '" title="Make this the main photo">Main</button>' : "") +
          '<button type="button" class="gal__x" data-gal-del="' + im.id + '" title="Remove photo" aria-label="Remove photo">' + ICONS.x + "</button>" +
          "</figure>";
      }).join("");
      renderIcons(back);
    }

    function loadGal() { renderGalTabs(); renderGal(); }

    $("#galTabs", back).addEventListener("click", function (e) {
      const b = e.target.closest("[data-gal]");
      if (!b) return;
      galScope = b.getAttribute("data-gal");
      renderGalTabs();
      renderGal();
    });

    $("#galAdd", back).addEventListener("click", function () { $("#galFile", back).click(); });

    $("#galFile", back).addEventListener("change", async function (e) {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      if (!files.length || !editing || galBusy) return;
      galBusy = true;
      let added = 0;
      try {
        for (const file of files) {
          const du = await prepareImage(file);
          const out = await api("POST", "/api/admin/products/" + encodeURIComponent(p.id) + "/images", {
            image: du, variantKey: galScope || null, altText: p.productName,
          });
          p.images = out.images;
          added++;
        }
        toast(added + (added === 1 ? " photo stored in the image database" : " photos stored in the image database"), true);
      } catch (ex) { toast(ex.message || "Could not store the photo.", false); }
      galBusy = false;
      await loadGal();
    });

    $("#galGrid", back).addEventListener("click", async function (e) {
      const del = e.target.closest("[data-gal-del]");
      const main = e.target.closest("[data-gal-main]");
      if (!del && !main) return;
      try {
        if (del) {
          await api("DELETE", "/api/admin/images/" + encodeURIComponent(del.getAttribute("data-gal-del")));
          toast("Photo removed", true);
        } else {
          /* move this photo to the front, then persist the whole new order */
          const imgs = (p.images || []).slice();
          const id = Number(main.getAttribute("data-gal-main"));
          const at = imgs.findIndex(function (x) { return x.id === id; });
          if (at > 0) imgs.unshift(imgs.splice(at, 1)[0]);
          const out = await api("PUT", "/api/admin/products/" + encodeURIComponent(p.id) + "/images/order", {
            order: imgs.map(function (x) { return x.id; }),
          });
          p.images = out.images;
          toast("Main photo updated", true);
        }
        const fresh = await api("GET", "/api/admin/products");
        const row = fresh.products.filter(function (x) { return x.id === p.id; })[0];
        if (row) p.imageUrl = row.imageUrl;
      } catch (ex) { toast(ex.message || "Could not update the photo.", false); }
      await loadGal();
    });

    loadGal();

    /* variants editor */
    $("#varAdd", back).addEventListener("click", function () {
      $("#varList", back).insertAdjacentHTML("beforeend", varRowHtml({}));
      renderIcons(back);
      renderGalTabs();
    });
    $("#varList", back).addEventListener("click", function (e) {
      const rm = e.target.closest("[data-vremove]");
      if (rm) rm.closest(".vrow").remove();
      const pick = e.target.closest(".v-file");
      if (pick && e.target.tagName !== "INPUT") {
        const inp = pick.querySelector("input");
        if (inp) inp.click();
      }
    });
    $("#varList", back).addEventListener("change", function (e) {
      if (e.target.type === "file") {
        const label = e.target.closest(".v-file");
        if (label && e.target.files && e.target.files[0]) {
          label.dataset.name = e.target.files[0].name;
          label.style.color = "var(--brand)";
          label.style.borderColor = "var(--brand)";
        }
      }
    });

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const err = $("#pErr", back);
      err.hidden = true;
      const fd = new FormData(form);
      const name = String(fd.get("name") || "").trim();
      const category = String(fd.get("category") || "");
      const desc = String(fd.get("desc") || "").trim();
      const priceBase = fd.get("price") === "" ? NaN : Number(fd.get("price"));
      const discRaw = fd.get("discount");
      const discount = discRaw === "" || discRaw == null ? null : Number(discRaw);
      const stockRaw = fd.get("stock");
      const stock = stockRaw === "" ? NaN : Number(stockRaw);
      const status = String(fd.get("status") || "ACTIVE");

      function fail(msg) { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: "nearest" }); return false; }
      if (name.length < 2) return fail("Product name must be at least 2 characters.");
      if (!category) return fail("Choose a category.");
      if (desc.length < 2) return fail("Add a short description.");
      if (!Number.isFinite(priceBase) || priceBase < 0) return fail("Enter a valid price.");
      if (discount != null && (!Number.isFinite(discount) || discount < 0)) return fail("Enter a valid discount price.");
      if (discount != null && discount >= priceBase) return fail("Discount price must be lower than the product price.");
      if (!Number.isInteger(stock) || stock < 0) return fail("Stock must be a whole number ≥ 0.");

      /* variant rows */
      const rows = $$(".vrow", back);
      const variants = [];
      for (const row of rows) {
        const label = $(".v-label", row).value.trim();
        const vPrice = $(".v-price", row).value;
        const vStock = $(".v-stock", row).value;
        const vSku = $(".v-sku", row).value.trim();
        const vImg = $(".v-img", row).value.trim();
        const file = $(".v-file input", row).files && $(".v-file input", row).files[0];
        const any = label || vPrice !== "" || vStock !== "" || vSku || vImg || file;
        if (!any) continue;
        if (!label) return fail("Every variant needs a size label (e.g. “4 mm × 20 cm”).");
        if (vPrice === "" || !Number.isFinite(Number(vPrice)) || Number(vPrice) < 0) return fail('Variant "' + label + '": enter a valid price.');
        if (vStock === "" || !Number.isInteger(Number(vStock)) || Number(vStock) < 0) return fail('Variant "' + label + '": stock must be a whole number ≥ 0.');
        variants.push({ row: row, cid: row.dataset.cid || null, label: label, price: Number(vPrice), stock: Number(vStock), sku: vSku, img: vImg || null, file: file });
      }

      const undo = busy($("#pSave", back), editing ? "Saving…" : "Adding…");
      try {
        /* 1. persist a picked image on the shared server before saving its product URL */
        let imageUrl = uploadedUrl || String(fd.get("imageUrl") || "").trim() || (editing && p.imageUrl && !uploadedUrl ? p.imageUrl : null);
        if (imageUrl && /^data:image\//i.test(imageUrl)) {
          const stored = await api("POST", "/api/admin/upload", { image: imageUrl });
          imageUrl = stored.url;
        }

        /* 2. payload (price/discount → price + mrp) */
        const payload = {
          productName: name,
          category: category,
          description: desc,
          price: discount != null ? discount : priceBase,
          mrp: discount != null ? priceBase : null,
          stockQuantity: stock,
          imageUrl: imageUrl || null,
          emoji: String(fd.get("emoji") || "").trim() || null,
        };
        if (status !== (p ? p.status : "ACTIVE")) payload.status = status;
        if (!editing && String(fd.get("sku") || "").trim()) payload.sku = String(fd.get("sku")).trim();

        /* 3. save main product */
        let main = p;
        if (editing) {
          const out = await api("PUT", "/api/admin/products/" + encodeURIComponent(p.id), payload);
          main = out.product;
        } else {
          const out = await api("POST", "/api/admin/products", payload);
          main = out.product;
        }

        /* 4. sync variants (children are independent DB rows, hidden from listings) */
        const snapshot = editing ? state.products.filter(function (c) { return c.parent === main.id; }) : [];
        const matched = new Set();
        for (const v of variants) {
          if (v.file) {
            const du = await prepareImage(v.file);
            const up = await api("POST", "/api/admin/upload", { image: du });
            v.img = up.url;
          }
          const childSku = v.cid ? null : (v.sku || main.id + "-" + (slugify(v.label) || "variant"));
          const childPayload = {
            productName: main.productName + " — " + v.label,
            category: main.category,
            description: main.description,
            price: v.price,
            stockQuantity: v.stock,
            status: v.stock > 0 ? "ACTIVE" : "OUT_OF_STOCK",
            meta: { parent: main.id, tags: ["vc-hidden"], brand: (p && p.brand) || null },
          };
          if (v.img) childPayload.imageUrl = v.img;
          else if (!v.cid) childPayload.imageUrl = imageUrl || null;

          let target = v.cid;
          if (!target && v.sku) {
            const alias = snapshot.find(function (c) { return c.id === v.sku || c.id === v.sku.toLowerCase(); });
            if (alias && !matched.has(alias.id)) target = alias.id;
          }
          if (target) {
            matched.add(target);
            await api("PUT", "/api/admin/products/" + encodeURIComponent(target), childPayload);
          } else {
            childPayload.sku = childSku;
            const out = await api("POST", "/api/admin/products", childPayload);
            matched.add(out.product.id);
          }
        }
        for (const old of snapshot) {
          if (matched.has(old.id)) continue;
          try { await api("DELETE", "/api/admin/products/" + encodeURIComponent(old.id)); } catch (_e) { /* archived */ }
        }

        undo();
        closeModal();
        toast(editing ? "Product updated — storefront refreshed" : "Product added — now live on the storefront", true);
        await repaint(VIEWS.products);
      } catch (ex) {
        undo();
        err.textContent = ex.message || "Could not save the product.";
        err.hidden = false;
      }
    });
  }

  function varRowHtml(v) {
    v = v || {};
    return '<div class="vrow"' + (v.id ? ' data-cid="' + esc(v.id) + '"' : "") + ">" +
      '<input class="v-label" placeholder="Size / label *" value="' + esc(v.label || "") + '">' +
      '<input class="v-price" type="number" min="0" step="0.01" placeholder="Price ₹ *" value="' + (v.price != null ? v.price : "") + '">' +
      '<input class="v-stock" type="number" min="0" step="1" placeholder="Stock *" value="' + (v.stockQuantity != null ? v.stockQuantity : "") + '">' +
      '<input class="v-sku" placeholder="SKU (auto)" value="' + esc(v.id || "") + '"' + (v.id ? " disabled" : "") + ">" +
      '<input class="v-img" placeholder="Image URL" value="' + (v.imageUrl && !String(v.imageUrl).startsWith("data:") ? esc(v.imageUrl) : "") + '">' +
      '<label class="v-file" title="Upload variant image">' + ICONS.img + '<input type="file" accept="image/*"></label>' +
      '<button type="button" class="iconbtn" data-vremove title="Remove variant">' + ICONS.trash + "</button>" +
      "</div>";
  }

  /* image: read → downscale → re-encode (e-commerce friendly size) */
  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error("Could not read that file.")); };
      fr.readAsDataURL(file);
    });
  }
  function shrinkDataUrl(dataUrl, maxDim, quality, type) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (type === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(c.toDataURL(type, quality)); } catch (_e) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }
  async function prepareImage(file) {
    if (!file) return null;
    if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) throw new Error("SVG isn't supported — upload JPEG, PNG or WebP.");
    if (!/^image\//.test(file.type)) throw new Error("That file isn't an image.");
    let dataUrl = await readAsDataUrl(file);
    const isPng = file.type === "image/png" || file.type === "image/webp";
    if (isPng && file.size <= 700 * 1024) return dataUrl; /* small PNGs keep transparency as-is */
    dataUrl = await shrinkDataUrl(dataUrl, isPng ? 1200 : 1400, 0.85, isPng ? "image/png" : "image/jpeg");
    return dataUrl;
  }

  /* ---------------- categories ---------------- */
  VIEWS.categories = async function () {
    content.innerHTML = loadingCard();
    await loadState("categories");
    const counts = {};
    state.products.forEach(function (p) { if (!p.parent && p.status !== "ARCHIVED") counts[p.category] = (counts[p.category] || 0) + 1; });
    content.innerHTML =
      '<div class="page-head"><div><h3>Categories</h3><p>Products show up under their category on the storefront automatically.</p></div>' +
      '<button class="btn btn--primary" id="addCatBtn">' + ICONS.plus + " Add category</button></div>" +
      '<section class="panel"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      "<th>Category</th><th>Slug</th><th>Products</th><th style=\"text-align:right\">Actions</th></tr></thead><tbody>" +
      (state.categories.length ? state.categories.map(function (c) {
        return "<tr><td><b>" + esc(c.emoji || "📁") + " " + esc(c.name) + "</b>" + (c.blurb ? "<br><small>" + esc(c.blurb) + "</small>" : "") + "</td>" +
          "<td><code>" + esc(c.slug) + "</code></td><td>" + (counts[c.slug] || 0) + "</td>" +
          '<td><div class="row-actions">' +
          '<button class="btn btn--ghost btn--sm" data-cact="edit" data-slug="' + esc(c.slug) + '">Edit</button>' +
          '<button class="btn btn--ghost btn--sm" data-cact="del" data-slug="' + esc(c.slug) + '" style="color:var(--red)">Delete</button>' +
          "</div></td></tr>";
      }).join("") : '<tr><td colspan="4" class="empty"><b>No categories yet</b>Add the first one.</td></tr>') +
      "</tbody></table></div></section>";
    renderIcons(content);
    $("#addCatBtn").addEventListener("click", function () { openCategoryModal(null); });
  };

  content.addEventListener("click", async function (e) {
    const btn = e.target.closest("[data-cact]");
    if (!btn) return;
    const cat = state.categories.find(function (c) { return c.slug === btn.dataset.slug; });
    if (!cat) return;
    try {
      if (btn.dataset.cact === "edit") openCategoryModal(cat);
      else if (btn.dataset.cact === "del") {
        const ok = await confirmDialog('Delete category "' + cat.name + '"?', { yes: "Delete category" });
        if (!ok) return;
        await deleteCategory(cat.slug);
        toast("Category deleted", true);
        await repaint(VIEWS.categories);
      }
    } catch (ex) { toast(ex.message, false); }
  });

  async function deleteCategory(slug) {
    try {
      await api("DELETE", "/api/admin/categories/" + encodeURIComponent(slug));
    } catch (e) {
      if (e.status !== 409) throw e;
      const others = state.categories.filter(function (c) { return c.slug !== slug; });
      if (!others.length) { toast("Move its products to a new category first.", false); throw e; }
      const moved = await promptReassign("This category still has products. Move them to:", others);
      if (!moved) throw new Error("Delete cancelled.");
      await api("DELETE", "/api/admin/categories/" + encodeURIComponent(slug), { reassignTo: moved });
      toast("Products moved, category deleted", true);
    }
  }
  function promptReassign(msg, others) {
    return new Promise(function (resolve) {
      pendingResolve = function (v) { resolve(v || null); };
      const back = openModal(
        '<div class="modal__head"><h3>Move products first</h3><button class="iconbtn" data-close>' + ICONS.x + "</button></div>" +
        '<div class="modal__body"><p class="confirm-msg">' + esc(msg) + "</p>" +
        '<label class="fld" style="margin-top:14px"><span>Move to category</span><select id="reassignSel">' +
        others.map(function (c) { return '<option value="' + esc(c.slug) + '">' + esc(c.name) + "</option>"; }).join("") +
        "</select></label></div>" +
        '<div class="modal__foot"><button class="btn btn--ghost" data-close>Cancel</button>' +
        '<button class="btn btn--primary" data-yes>Move &amp; delete</button></div>');
      back.querySelector("[data-yes]").addEventListener("click", function () {
        const v = $("#reassignSel", back).value;
        pendingResolve = null; modalRoot.innerHTML = ""; resolve(v);
      });
    });
  }
  function openCategoryModal(cat) {
    const editing = !!cat;
    const back = openModal(
      '<div class="modal__head"><h3>' + (editing ? "Edit category" : "Add category") + "</h3>" +
      '<button class="iconbtn" data-close>' + ICONS.x + "</button></div>" +
      '<form id="cForm" novalidate><div class="modal__body">' +
      '<p class="form-error" id="cErr" hidden></p>' +
      '<label class="fld"><span>Name <i>*</i></span><input name="name" maxlength="40" required value="' + esc(editing ? cat.name : "") + '"></label>' +
      '<label class="fld"><span>URL slug</span><input name="slug" placeholder="auto from name" value="' + esc(editing ? cat.slug : "") + '"' + (editing ? " disabled" : "") + "></label>" +
      '<label class="fld"><span>Emoji</span><input name="emoji" maxlength="8" placeholder="🗂️" value="' + esc(editing && cat.emoji ? cat.emoji : "") + '"></label>' +
      '<label class="fld"><span>Blurb (one line)</span><input name="blurb" maxlength="120" placeholder="Short line shown on the storefront" value="' + esc(editing && cat.blurb ? cat.blurb : "") + '"></label>' +
      "</div>" +
      '<div class="modal__foot"><button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn--primary">' + (editing ? "Save changes" : "Add category") + "</button></div></form>");
    $("#cForm", back).addEventListener("submit", async function (e) {
      e.preventDefault();
      const err = $("#cErr", back); err.hidden = true;
      const name = $("#cForm [name=name]", back).value.trim();
      if (name.length < 2) { err.textContent = "Category name must be at least 2 characters."; err.hidden = false; return; }
      const payload = {
        name: name,
        emoji: $("#cForm [name=emoji]", back).value.trim() || null,
        blurb: $("#cForm [name=blurb]", back).value.trim() || null,
      };
      const undo = busy(e.submitter || $("#cForm button[type=submit]", back), "Saving…");
      try {
        if (editing) await api("PUT", "/api/admin/categories/" + encodeURIComponent(cat.slug), payload);
        else {
          payload.slug = slugify($("#cForm [name=slug]", back).value || name) || null;
          await api("POST", "/api/admin/categories", payload);
        }
        undo(); closeModal();
        toast(editing ? "Category updated" : "Category added", true);
        await repaint(VIEWS.categories);
      } catch (ex) { undo(); err.textContent = ex.message; err.hidden = false; }
    });
  }

  /* ---------------- orders ---------------- */
  VIEWS.orders = async function () {
    content.innerHTML = loadingCard();
    await loadState("orders");
    content.innerHTML =
      '<div class="page-head"><div><h3>Orders</h3><p>' + state.orders.length + " orders · every order from the storefront, in real time</p></div>" +
      '<div class="filters"><select id="ordFilter" aria-label="Filter by status"><option value="">All statuses</option>' +
      ORDER_STATUSES.map(function (s) {
        return '<option value="' + s[0] + '"' + (state.orderFilter === s[0] ? " selected" : "") + ">" + s[1] + "</option>";
      }).join("") + "</select></div></div>" +
      '<section class="panel"><div class="table-wrap"><table class="tbl" style="min-width:820px"><thead><tr>' +
      "<th>Order</th><th>Customer</th><th>Items</th><th class=\"num\">Total</th><th>Status</th><th style=\"text-align:right\">Items</th>" +
      '</tr></thead><tbody id="ordRows">' +
      (state.orders.length ? state.orders.map(orderRowHtml).join("") : '<tr><td colspan="6" class="empty"><b>No orders yet</b>Orders placed on the storefront appear here instantly.</td></tr>') +
      "</tbody></table></div></section>";
    renderIcons(content);
    $("#ordFilter").addEventListener("change", async function (e) {
      state.orderFilter = e.target.value;
      await repaint(VIEWS.orders);
    });
  };
  function orderRowHtml(o) {
    const count = o.items.reduce(function (a, i) { return a + i.quantity; }, 0);
    const addr = o.address_json ? JSON.parse(o.address_json) : {};
    return '<tr data-orow="' + esc(o.id) + '">' +
      "<td><b>" + esc(o.id) + "</b><br><small>" + esc(fmtDateTime(o.created_at)) + " · " + esc(o.payment_method) + "</small></td>" +
      "<td>" + esc(addr.name || "—") + "<br><small>" + esc(addr.phone || o.mobile_number || "") + " · " + esc(addr.city || "") + "</small></td>" +
      "<td>" + count + " item" + (count === 1 ? "" : "s") + "</td>" +
      '<td class="num"><b>' + money(o.total_amount) + "</b>" + (o.discount ? '<br><small style="color:var(--brand)">−' + money(o.discount) + "</small>" : "") + "</td>" +
      '<td><select class="ostat" data-oid="' + esc(o.id) + '">' +
      ORDER_STATUSES.map(function (s) {
        return '<option value="' + s[0] + '"' + (o.status === s[0] ? " selected" : "") + ">" + s[1] + "</option>";
      }).join("") + "</select></td>" +
      '<td style="text-align:right"><button class="btn btn--ghost btn--sm" data-items="' + esc(o.id) + '">View</button></td></tr>' +
      '<tr class="oi-row" id="oi-' + esc(o.id) + '" hidden><td colspan="6" style="background:#fafbfa">' +
      o.items.map(function (i) {
        return '<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:14px">' +
          "<span>" + esc(i.product_name) + (i.variant_label ? " — " + esc(i.variant_label) : "") + " <small>×" + i.quantity + "</small></span>" +
          "<b>" + money(i.price_at_purchase * i.quantity) + "</b></div>";
      }).join("") +
      (addr.line ? '<div style="margin-top:8px;color:var(--muted);font-size:13px">📍 ' + esc(addr.line) + ", " + esc(addr.city) + " — " + esc(addr.pin) + "</div>" : "") +
      "</td></tr>";
  }
  content.addEventListener("click", function (e) {
    const t = e.target.closest("[data-items]");
    if (!t) return;
    const row = document.getElementById("oi-" + t.dataset.items);
    if (row) { row.hidden = !row.hidden; t.textContent = row.hidden ? "View" : "Hide"; }
  });
  content.addEventListener("change", async function (e) {
    const sel = e.target.closest(".ostat");
    if (!sel) return;
    const oid = sel.dataset.oid;
    const status = sel.value;
    if (status === "CANCELLED") {
      const ok = await confirmDialog("Cancel this order? Stock will be returned to inventory.", { yes: "Cancel order" });
      if (!ok) { await repaint(VIEWS.orders); return; }
    }
    try {
      await api("PUT", "/api/admin/orders/" + encodeURIComponent(oid) + "/status", { status: status });
      toast("Order " + oid + " → " + orderLabel(status), true);
      await repaint(VIEWS.orders);
    } catch (ex) { toast(ex.message, false); await repaint(VIEWS.orders); }
  });

  /* ---------------- customers ---------------- */
  VIEWS.customers = async function () {
    content.innerHTML = loadingCard();
    const data = await api("GET", "/api/admin/customers");
    state.customers = data.customers;
    content.innerHTML =
      '<div class="page-head"><div><h3>Customers</h3><p>' + state.customers.length + " registered customers</p></div></div>" +
      '<section class="panel"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      "<th>Name</th><th>Email</th><th>Mobile</th><th class=\"num\">Orders</th><th class=\"num\">Total spent</th><th>Joined</th>" +
      "</tr></thead><tbody>" +
      (state.customers.length ? state.customers.map(function (c) {
        return "<tr><td><b>" + esc(c.name) + "</b></td><td>" + (c.email ? "<a href=\"mailto:" + esc(c.email) + "\">" + esc(c.email) + "</a>" : "—") + "</td><td>" + esc(c.mobile_number || "—") + "</td>" +
          '<td class="num">' + c.orderCount + '</td><td class="num">' + money(c.spend) + "</td><td>" + esc(fmtDate(c.created_at)) + "</td></tr>";
      }).join("") : '<tr><td colspan="6" class="empty"><b>No customers yet</b>Customers who sign in with email appear here.</td></tr>') +
      "</tbody></table></div></section>";
    renderIcons(content);
  };

  /* ---------------- seminar: event details + registrations ---------------- */
  VIEWS.seminar = async function () {
    content.innerHTML = loadingCard();
    const data = await api("GET", "/api/admin/seminar");
    const d = data.details || {};
    const regs = data.registrations || [];
    const stats = data.stats || { total: 0, last7days: 0 };
    state.seminar = { details: d, registrations: regs };

    const regRows = regs.length
      ? regs.map(function (r) {
          return "<tr><td><b>" + esc(r.full_name) + "</b></td>" +
            "<td><a href=\"mailto:" + esc(r.email) + "\">" + esc(r.email) + "</a></td>" +
            "<td>" + esc(r.phone || "—") + "</td>" +
            "<td>" + esc(r.organization || "—") + "</td>" +
            "<td><small>" + esc(r.notes || "") + "</small></td>" +
            "<td><small>" + esc(fmtDateTime(r.created_at)) + "</small></td></tr>";
        }).join("")
      : '<tr><td colspan="6" class="empty"><b>No registrations yet</b>Share the seminar page link and entries will appear here.</td></tr>';

    content.innerHTML =
      '<div class="page-head"><div><h3>Seminar</h3><p>' + stats.total + " registration" + (stats.total === 1 ? "" : "s") +
      " · " + stats.last7days + " in the last 7 days</p></div>" +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<a class="btn btn--ghost" href="/seminar" target="_blank" rel="noopener">Open page ↗</a>' +
      '<a class="btn btn--primary" href="/api/admin/seminar/registrations/export" download="seminar-registrations.csv" id="csvBtn">' +
      '<span data-ic="down"></span> Export CSV</a></div></div>' +

      '<section class="panel"><div class="panel__head"><h4>Event details</h4></div><div class="panel__body">' +
      '<p style="margin-top:0;color:var(--muted);font-size:13.5px">Anything left blank shows an editable placeholder on the public page. Nothing is pre-filled with invented details.</p>' +
      '<form id="semForm">' +
      '<div class="form-grid">' +
      '<div class="fld span2"><span>Seminar title</span><input id="sd_title" maxlength="200" value="' + esc(d.title || "") + '" placeholder="Add your seminar title" /></div>' +
      '<div class="fld span2"><span>Description</span><textarea id="sd_description" maxlength="4000" placeholder="What the seminar is about, who it is for…">' + esc(d.description || "") + "</textarea></div>" +
      '<div class="fld"><span>Date</span><input id="sd_event_date" maxlength="100" value="' + esc(d.event_date || "") + '" placeholder="e.g. Friday, 14 November" /></div>' +
      '<div class="fld"><span>Time</span><input id="sd_event_time" maxlength="100" value="' + esc(d.event_time || "") + '" placeholder="e.g. 10:00 AM – 1:00 PM" /></div>' +
      '<div class="fld"><span>Location</span><input id="sd_location" maxlength="300" value="' + esc(d.location || "") + '" placeholder="Venue, street, city" /></div>' +
      '<div class="fld"><span>Online meeting link</span><input id="sd_meeting_url" maxlength="500" value="' + esc(d.meeting_url || "") + '" placeholder="https://meet.example.com/…" /></div>' +
      '<div class="fld"><span>Speaker</span><input id="sd_speaker" maxlength="200" value="' + esc(d.speaker || "") + '" placeholder="Name and role" /></div>' +
      '<div class="fld"><span>Contact email</span><input id="sd_contact_email" type="email" maxlength="200" value="' + esc(d.contact_email || "") + '" placeholder="Questions go to…" /></div>' +
      '<div class="fld span2"><span>Agenda <small style="color:var(--muted);font-weight:500">one item per line</small></span>' +
      '<textarea id="sd_agenda" maxlength="4000" rows="7" placeholder="Welcome and introductions&#10;Topic one&#10;Q&amp;A">' + esc(d.agenda || "") + "</textarea></div>" +
      "</div>" +
      '<button class="btn btn--primary" id="semSave" type="submit">Save details</button>' +
      "</form></div></section>" +

      '<section class="panel"><div class="panel__head"><h4>Registrations</h4></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Organization</th><th>Notes</th><th>Registered</th></tr></thead><tbody>' +
      regRows + "</tbody></table></div></section>";
    renderIcons(content);

    $("#semForm").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      const body = {
        title: $("#sd_title").value, description: $("#sd_description").value,
        event_date: $("#sd_event_date").value, event_time: $("#sd_event_time").value,
        location: $("#sd_location").value, meeting_url: $("#sd_meeting_url").value,
        speaker: $("#sd_speaker").value, contact_email: $("#sd_contact_email").value,
        agenda: $("#sd_agenda").value
      };
      const undo = busy($("#semSave"), "Saving…");
      try {
        await api("POST", "/api/admin/seminar/details", body);
        undo(); toast("Seminar details saved", true);
        await repaint(VIEWS.seminar);
      } catch (ex) { undo(); toast(ex.message, false); }
    });
  };

  /* ---------------- settings ---------------- */
  VIEWS.settings = async function () {
    let mfa = { enabled: false }, log = { entries: [] };
    try { mfa = await api("GET", "/api/auth/admin/mfa/status"); } catch (_e) { /* keep defaults */ }
    try { log = await api("GET", "/api/admin/audit?limit=25"); } catch (_e) { /* keep defaults */ }

    const auditRows = (log.entries || []).map(function (a) {
      return "<tr><td><small>" + esc(String(a.created_at || "").slice(0, 16)) + "</small></td>" +
        "<td>" + esc(a.actor_name || "—") + "</td>" +
        "<td><b>" + esc(a.action) + "</b></td>" +
        "<td><small>" + esc(a.target || "") + "</small></td>" +
        "<td><small>" + esc(a.ip || "") + "</small></td></tr>";
    }).join("") || '<tr><td colspan="5">No entries yet.</td></tr>';

    const mfaBody = mfa.enabled
      ? '<p style="margin-top:0;color:var(--muted);font-size:14.5px">✓ Enabled — sign-in now needs your password plus a 6-digit code from your authenticator app.</p>' +
        '<div class="fld"><span>Authenticator code</span><input id="mfaCodeD" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code" /></div>' +
        '<div class="fld"><span>Confirm with your password</span><input id="mfaPwD" type="password" autocomplete="current-password" placeholder="Admin password" /></div>' +
        '<button class="btn btn--ghost" id="mfaDisable">Disable two-factor</button>'
      : '<p style="margin-top:0;color:var(--muted);font-size:14.5px">Not enabled. When enabled, sign-in asks for a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password…) in addition to your password.</p>' +
        '<div id="mfaSetup" hidden>' +
        '<div class="fld"><span>Setup key (enter manually in your app)</span><input id="mfaSecret" readonly style="font-family:monospace;letter-spacing:1px" /></div>' +
        '<p style="margin:0 0 10px"><small id="mfaUri" style="word-break:break-all;color:var(--muted)"></small></p>' +
        '<div class="fld"><span>Code from your app</span><input id="mfaCodeE" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code" /></div>' +
        '<button class="btn btn--primary" id="mfaEnable">Confirm &amp; activate</button></div>' +
        '<button class="btn btn--ghost" id="mfaStart" style="margin-top:10px">Enable two-factor</button>';

    content.innerHTML =
      '<div class="page-head"><div><h3>Settings</h3><p>Panel, store &amp; security</p></div></div>' +
      '<div class="dash-grid">' +
      '<section class="panel"><div class="panel__head"><h4>Admin account</h4></div><div class="panel__body">' +
      '<dl class="kv"><dt>Signed in as</dt><dd>' + esc(state.user ? state.user.name : "—") + "</dd>" +
      "<dt>Role</dt><dd>Administrator</dd>" +
      "<dt>Session</dt><dd>7 days · httpOnly cookie · SameSite</dd>" +
      "<dt>Two-factor</dt><dd>" + (mfa.enabled ? "Enabled" : "Disabled") + "</dd>" +
      "<dt>Live updates</dt><dd>" + ($("#livePill") && !$("#livePill").classList.contains("off") ? "Connected (SSE)" : "Reconnecting…") + "</dd></dl>" +
      '<div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn btn--ghost" id="setLogout">Log out</button>' +
      '<a class="btn btn--primary" href="/" target="_blank" rel="noopener">Open storefront ' + "</a></div>" +
      "</div></section>" +
      '<section class="panel"><div class="panel__head"><h4>Two-factor authentication</h4></div><div class="panel__body">' +
      mfaBody +
      "</div></section>" +
      '<section class="panel"><div class="panel__head"><h4>Security audit log</h4></div><div class="panel__body">' +
      '<p style="margin-top:0;color:var(--muted);font-size:13.5px">Server-recorded admin actions (last 25). Passwords, codes and payment details are never logged.</p>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>IP</th></tr></thead><tbody>' +
      auditRows + "</tbody></table></div></div></section>" +
      '<section class="panel"><div class="panel__head"><h4>How data flows</h4></div><div class="panel__body">' +
      '<p style="margin-top:0;color:var(--muted);font-size:14.5px">Admin panel → API → SQLite → Customer panel. ' +
      "Every price, stock count and status you save here is read by the storefront from the database — never from cached frontend files.</p>" +
      '<div class="linklist"><a href="#/products">Manage products</a><a href="#/categories">Manage categories</a><a href="#/orders">Review orders</a></div>' +
      "</div></section></div>";
    renderIcons(content);

    const b = $("#setLogout");
    if (b) b.addEventListener("click", function () { $("#logoutBtn").click(); });

    const start = $("#mfaStart");
    if (start) start.addEventListener("click", async function () {
      try {
        const out = await api("POST", "/api/auth/admin/mfa/setup", {});
        $("#mfaSecret").value = out.secret;
        $("#mfaUri").textContent = out.otpauth || "";
        $("#mfaSetup").hidden = false;
        start.hidden = true;
        $("#mfaCodeE").focus();
        toast("Add this key to your authenticator app, then enter the code", true);
      } catch (ex) { toast(ex.message, false); }
    });

    const enable = $("#mfaEnable");
    if (enable) enable.addEventListener("click", async function () {
      const code = String($("#mfaCodeE").value || "").trim();
      if (!/^\d{6}$/.test(code)) { toast("Enter the 6-digit code.", false); return; }
      const undo = busy(enable, "Activating…");
      try {
        await api("POST", "/api/auth/admin/mfa/enable", { code: code });
        undo(); toast("Two-factor authentication enabled", true);
        await repaint(VIEWS.settings);
      } catch (ex) { undo(); toast(ex.message, false); }
    });

    const disable = $("#mfaDisable");
    if (disable) disable.addEventListener("click", async function () {
      const code = String($("#mfaCodeD").value || "").trim();
      const pw = String($("#mfaPwD").value || "");
      if (!/^\d{6}$/.test(code)) { toast("Enter the 6-digit code.", false); return; }
      if (!pw) { toast("Confirm with your admin password.", false); return; }
      const undo = busy(disable, "Disabling…");
      try {
        await api("POST", "/api/auth/admin/mfa/disable", { code: code, password: pw });
        undo(); toast("Two-factor authentication disabled", true);
        await repaint(VIEWS.settings);
      } catch (ex) { undo(); toast(ex.message, false); }
    });
  };

  /* ---------------- go ---------------- */
  boot();
})();
