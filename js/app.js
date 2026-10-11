/* ============================================================
   UVID — app engine
   hash router · persisted state (cart/wishlist/orders/user)
   payment simulation · auth modal · toast · utils
   ============================================================ */

(function () {
  "use strict";

  /* ---------------- utils ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function money(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function starsHtml(rating) {
    var full = Math.floor(rating);
    var half = rating - full >= 0.5;
    var out = "";
    for (var i = 0; i < 5; i++) out += '<span class="star ' + (i < full ? "star--full" : (i === full && half ? "star--half" : "star--empty")) + '">★</span>';
    return out;
  }
  var _toastTimer = null;
  function toast(msg, ok) {
    var t = $("#toast");
    if (!t) return;
    t.innerHTML = '<span class="toast__dot ' + (ok === false ? "toast__dot--err" : "") + '"></span>' + escapeHtml(msg);
    t.classList.add("toast--show");
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { t.classList.remove("toast--show"); }, 2600);
  }
  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).toUpperCase().slice(2, 5);
  }
  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return iso; }
  }
  function fmtDateTime(iso) {
    try {
      return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    } catch (e) { return iso; }
  }

  /* ---------------- persisted store ---------------- */
  var KEY = "uvid:v1";
  var SKEY = "uvid:session";

  function blank() {
    return { cart: [], wishlist: [], user: null, users: {}, orders: [], addresses: [], recent: [] };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var data = JSON.parse(raw);
      var base = blank(), k;
      for (k in base) if (data[k] !== undefined) base[k] = data[k];
      return base;
    } catch (e) { return blank(); }
  }

  var state = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }

  /* Older versions stored a phone number as the locally signed-in identity. */
  if (state.user && !/^[a-z0-9._%+-]+@gmail\.com$/i.test(String(state.user))) {
    state.user = null;
    save();
  }

  /* session-scoped (payment method + applied coupon survive reloads but not sign-out) */
  function session() {
    try { return JSON.parse(sessionStorage.getItem(SKEY) || "{}"); }
    catch (e) { return {}; }
  }
  function setSession(patch) {
    var s = session();
    for (var k in patch) s[k] = patch[k];
    try { sessionStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { }
  }

  /* ---------------- totals engine ---------------- */
  var SHIP_FEE = 49;
  var FREE_SHIP_MIN = 499;

  function cartCount() {
    return state.cart.reduce(function (a, l) { return a + l.qty; }, 0);
  }

  function computeTotals() {
    var subtotal = 0, mrpTotal = 0, count = 0, i, j;
    for (i = 0; i < state.cart.length; i++) {
      var p = window.PT.findProduct(state.cart[i].id);
      if (!p) continue;
      subtotal += p.price * state.cart[i].qty;
      mrpTotal += p.mrp * state.cart[i].qty;
      count += state.cart[i].qty;
    }
    var s = session();
    var coupon = null, discount = 0, shipFree = false;
    if (s.coupon) {
      for (j = 0; j < window.PT.COUPONS.length; j++) {
        if (window.PT.COUPONS[j].code === s.coupon) { coupon = window.PT.COUPONS[j]; break; }
      }
      if (coupon && subtotal < coupon.min) { coupon = null; setSession({ coupon: null }); }
    }
    if (coupon) {
      if (coupon.type === "percent") discount = Math.min(subtotal * coupon.value / 100, coupon.cap || Infinity);
      else if (coupon.type === "flat") discount = coupon.value;
      else if (coupon.type === "ship") shipFree = true;
    }
    var shipping = count === 0 ? 0 : (shipFree || subtotal >= FREE_SHIP_MIN ? 0 : SHIP_FEE);
    var total = Math.max(0, subtotal - discount) + shipping;
    return { subtotal: subtotal, mrpTotal: mrpTotal, count: count, discount: discount, shipping: shipping, total: total, coupon: coupon };
  }

  /* ---------------- auth ---------------- */
  function findUser(email) { return state.users[email] || null; }

  function signIn(email, name) {
    var user = findUser(email);
    if (user) {
      if (name && user.name !== name) user.name = name;
    } else {
      user = { name: name || email.split("@")[0], email: email, joined: new Date().toISOString() };
      state.users[email] = user;
    }
    user.email = email;
    state.user = email;
    save();
    return user;
  }

  function signOut() {
    state.user = null;
    setSession({ paymentMethod: null, coupon: null, cardNum: null, cardExp: null, cardName: null });
    try { fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch (_e) { /* offline */ }
    save();
    toast("Signed out. Come back soon!");
    navigateTo("#/");
    renderChrome();
  }

  function requireLogin(purpose) {
    if (state.user) return true;
    openAuth("login", purpose || "");
    return false;
  }

  /* auth modal */
  var authMode = "login";
  function openAuth(mode, purpose) {
    authMode = mode || "login";
    var m = $("#authModal");
    if (!m) return;
    $("#authPurpose").textContent = purpose || "";
    renderAuth();
    m.classList.add("modal--open");
    setTimeout(function () {
      var f = $("#authEmail");
      if (f) f.focus();
    }, 60);
  }
  function closeAuth() { var m = $("#authModal"); if (m) m.classList.remove("modal--open"); }

  function renderAuth() {
    var box = $("#authBox");
    if (!box) return;
    var isProfile = authMode === "profile";
    var currentUser = state.user ? findUser(state.user) : null;
    box.innerHTML =
      '<p class="auth__eyebrow">' + (isProfile ? "Account" : "Login") + '</p>' +
      '<h3 class="auth__title">' + (isProfile ? "Your profile" : "Welcome back") + '</h3>' +
      '<p class="auth__purpose" id="authPurpose2"></p>' +
      '<form id="authForm" novalidate>' +
      (isProfile
        ? '<div class="field"><label for="authName">Full name</label><input id="authName" type="text" autocomplete="name" placeholder="Your name" value="' + escapeHtml((currentUser && currentUser.name) || "") + '" /></div>'
        : "") +
      '<div class="field"><label for="authEmail">Gmail address</label><input id="authEmail" type="email" autocomplete="email" placeholder="name@gmail.com" value="' + escapeHtml((currentUser && currentUser.email) || "") + '"' + (isProfile ? " disabled" : " required") + ' /></div>' +
      '<p class="form-error" id="authError" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary btn--block">' + (isProfile ? "Save changes" : "Sign in") + '</button>' +
      '</form>' +
      (isProfile
        ? '<button class="btn btn--ghost btn--block auth__alt" id="authSignout">Sign out</button>'
        : "") +
      '<p class="auth__fine">Enter your Gmail address and click Sign in. No password or one-time code is required. Email ownership is not verified.</p>';

    $("#authPurpose2").textContent = $("#authPurpose").textContent || (isProfile ? "Update your profile." : "Login to start shopping.");

    $("#authForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = $("#authError");
      err.hidden = true;
      if (isProfile) {
        var profileUser = findUser(state.user);
        if (profileUser) profileUser.name = String($("#authName").value || "").trim() || String(profileUser.email || "Reader").split("@")[0];
        save();
        closeAuth();
        toast("Profile updated.", true);
        renderChrome();
        if (window.PT && window.PT.View && window.PT.View.rerender) window.PT.View.rerender();
        return;
      }

      var email = String($("#authEmail").value || "").trim().toLowerCase();
      if (!/^[a-z0-9._%+-]+@gmail\.com$/i.test(email)) {
        err.textContent = "Enter a valid Gmail address, such as name@gmail.com.";
        err.hidden = false;
        return;
      }
      fetch("/api/auth/email/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ email: email })
      }).then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; });
      }).then(function (r) {
        if (!r.ok) { err.textContent = (r.d && r.d.error) || "Could not sign in."; err.hidden = false; return; }
        var user = signIn(r.d.user.email, r.d.user.name);
        closeAuth();
        toast("Welcome, " + (user.name || "customer") + "!", true);
        renderChrome();
        if (window.PT && window.PT.View && window.PT.View.rerender) window.PT.View.rerender();
      }).catch(function () { err.textContent = "Cannot reach the server. Is it running?"; err.hidden = false; });
    });
    $("#authSignout") && $("#authSignout").addEventListener("click", function () {
      closeAuth(); signOut();
      if (window.PT && window.PT.View && window.PT.View.rerender) window.PT.View.rerender();
    });
  }

  /* ---------------- cart ops ---------------- */
  function addToCart(id, qty) {
    qty = qty || 1;
    if (!requireLogin("Login to add items to your cart.")) return false;
    var p = window.PT.findProduct(id);
    if (!p) return false;
    var line = null, i;
    for (i = 0; i < state.cart.length; i++) if (state.cart[i].id === id) { line = state.cart[i]; break; }
    var next = (line ? line.qty : 0) + qty;
    if (next > p.stock) { toast("Only " + p.stock + " in stock.", false); next = p.stock; }
    if (line) line.qty = next; else state.cart.push({ id: id, qty: Math.max(1, next) });
    pushRecent(id);
    save(); renderChrome();
    toast(p.name.split("—")[0].trim() + " added to cart", true);
    return true;
  }

  function setQty(id, qty) {
    var i;
    for (i = 0; i < state.cart.length; i++) {
      if (state.cart[i].id === id) {
        var p = window.PT.findProduct(id);
        if (qty <= 0) state.cart.splice(i, 1);
        else {
          if (p && qty > p.stock) { qty = p.stock; toast("Only " + p.stock + " in stock.", false); }
          state.cart[i].qty = qty;
        }
        break;
      }
    }
    save(); renderChrome();
  }

  function toggleWishlist(id) {
    if (!requireLogin("Login to save items to your wishlist.")) return false;
    var idx = state.wishlist.indexOf(id);
    var added;
    if (idx === -1) { state.wishlist.push(id); added = true; }
    else { state.wishlist.splice(idx, 1); added = false; }
    pushRecent(id);
    save(); renderChrome();
    toast(added ? "Saved to wishlist ♥" : "Removed from wishlist", true);
    return added;
  }

  function inWishlist(id) { return state.wishlist.indexOf(id) !== -1; }

  function pushRecent(id) {
    var idx = state.recent.indexOf(id);
    if (idx !== -1) state.recent.splice(idx, 1);
    state.recent.unshift(id);
    state.recent = state.recent.slice(0, 8);
    save();
  }

  /* ---------------- orders ---------------- */
  var STATUS_STAGES = ["Placed", "Packed", "Shipped", "Out for delivery", "Delivered"];

  function etaDate(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  /* Places the order on the SERVER: price, stock, coupon, address and
     permissions are all validated there — browser values are never trusted.
     Returns a Promise<order|null>. */
  function placeOrder(method) {
    /* drop lines whose product was archived/deleted in the admin panel */
    state.cart = state.cart.filter(function (l) { return !!window.PT.findProduct(l.id); });
    if (state.cart.length === 0) { toast("Your cart is empty.", false); return Promise.resolve(null); }
    var address = session().address;
    if (!address) { toast("Add a delivery address first.", false); navigateTo("#/checkout"); return Promise.resolve(null); }

    var payload = {
      items: state.cart.map(function (l) { return { productId: l.id, quantity: l.qty }; }),
      paymentMethod: String(method || "COD").toUpperCase(),
      address: address,
      coupon: session().coupon || undefined
    };

    return fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; });
    }).then(function (r) {
      if (r.status !== 201 && r.status !== 200) {
        var msg = (r.data && r.data.error) || "Could not place the order.";
        if (r.status === 401) { openAuth("login", "Login to complete your purchase."); }
        toast(msg, false);
        return null;
      }
      var order = buildServerOrder(r.data, method, address);
      state.orders.unshift(order);
      state.cart = [];
      setSession({ coupon: null });
      save(); renderChrome();
      return order;
    }).catch(function () {
      toast("Cannot reach the server. Check your connection and try again.", false);
      return null;
    });
  }

  /* map the server order (authoritative totals/status) into the storefront's shape */
  function buildServerOrder(data, method, address) {
    var srv = data.order || {};
    var items = data.items || [];
    var stageMap = { PLACED: 0, PACKED: 1, SHIPPED: 2, OUT_FOR_DELIVERY: 3, DELIVERED: 4 };
    var cancelled = srv.status === "CANCELLED";
    var si = stageMap[srv.status] != null ? stageMap[srv.status] : 0;
    var subtotal = 0;
    var mapped = items.map(function (it) {
      var prod = window.PT.findProduct(it.productId);
      var price = Number(it.priceAtPurchase) || 0;
      subtotal += price * (Number(it.qty) || 1);
      return {
        id: it.productId,
        name: it.name + (it.variantLabel ? " — " + it.variantLabel : ""),
        price: price,
        mrp: prod && prod.mrp != null && prod.mrp >= price ? prod.mrp : price,
        qty: Number(it.qty) || 1,
        emoji: prod ? prod.emoji : "📦",
        bg: prod ? prod.bg : "#EEF2FF",
        ink: prod ? prod.ink : "#4C5BD4"
      };
    });
    return {
      id: srv.id,
      placedAt: sqlTimeToIso(srv.created_at),
      items: mapped,
      qty: mapped.reduce(function (a, l) { return a + l.qty; }, 0),
      totals: {
        subtotal: Math.round(subtotal * 100) / 100,
        discount: Number(srv.discount) || 0,
        shipping: Number(srv.shipping) || 0,
        total: Number(srv.total_amount) || 0
      },
      coupon: srv.coupon || null,
      payment: String(method || srv.payment_method || "COD").toLowerCase(),
      paymentStatus: srv.payment_status === "PAID" ? "Paid ✓" : "Pay on delivery",
      status: cancelled ? "Cancelled" : STATUS_STAGES[si],
      stages: STATUS_STAGES,
      stageIndex: cancelled ? 0 : si,
      eta: srv.eta || null,
      address: address,
      user: state.user || "guest",
      _srv: true
    };
  }

  function sqlTimeToIso(sql) {
    if (!sql) return new Date().toISOString();
    var s = String(sql).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(" ", "T") + "Z"; /* SQLite stores UTC */
    var d = new Date(s);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  function cancelOrder(orderId) {
    var target = null, i;
    for (i = 0; i < state.orders.length; i++) if (state.orders[i].id === orderId) target = state.orders[i];
    if (!target) return;
    if (target.status === "Delivered") { toast("Delivered orders can't be cancelled.", false); return; }
    if (target.status === "Cancelled") return;

    if (target._srv) {
      /* server owns this order — ownership & status re-checked there */
      fetch("/api/orders/" + encodeURIComponent(orderId) + "/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: "{}"
      }).then(function (res) {
        return res.json().then(function (d) { return { status: res.status, d: d }; });
      }).then(function (r) {
        if (r.status !== 200) { toast((r.d && r.d.error) || "Could not cancel this order.", false); return; }
        target.status = "Cancelled";
        save();
        toast("Order " + orderId + " cancelled. Refund in 3–5 days.", true);
        if (window.PT.View && window.PT.View.rerender) window.PT.View.rerender();
      }).catch(function () { toast("Cannot reach the server.", false); });
      return;
    }

    target.status = "Cancelled";
    save();
    toast("Order " + orderId + " cancelled. Refund in 3–5 days.", true);
    if (window.PT.View && window.PT.View.rerender) window.PT.View.rerender();
  }

  /* ---------------- search history (recent searches) ---------------- */
  function addSearch(term) {
    if (!term) return;
    pushRecent("__search:" + term);
  }

  /* ---------------- router ---------------- */
  var routes = [];
  function route(pattern, handler) { routes.push({ pattern: pattern, handler: handler }); }

  function parseHash() {
    var h = location.hash || "#/";
    if (h.charAt(1) === "/") h = h.slice(1); else h = "/" + h.replace(/^#/, "");
    var parts = h.split("?")[0].split("/").filter(Boolean);
    var query = {};
    var qs = h.split("?")[1];
    if (qs) {
      qs.split("&").forEach(function (kv) {
        var p = kv.split("=");
        query[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " "));
      });
    }
    return { parts: parts, query: query, path: h.split("?")[0] };
  }

  function navigateTo(hash) {
    if (location.hash === hash) { onRoute(true); }
    else location.hash = hash;
  }

  function onRoute(keepScroll) {
    var r = parseHash();
    if (!keepScroll) window.scrollTo(0, 0);
    closeMobileNav();
    var matched = false;
    for (var i = 0; i < routes.length; i++) {
      var m = matchRoute(r.parts, routes[i].pattern);
      if (m) { routes[i].handler(m.params, r.query); matched = true; break; }
    }
    if (!matched) window.PT.View.home();
    renderChrome();
    try { document.dispatchEvent(new CustomEvent("pt:route", { detail: r.path })); } catch (e) { }
  }

  function matchRoute(parts, pattern) {
    var pp = pattern.split("/").filter(Boolean);
    if (pp.length !== parts.length) return null;
    var params = {};
    for (var i = 0; i < pp.length; i++) {
      if (pp[i].charAt(0) === ":") params[pp[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (pp[i] !== parts[i]) return null;
    }
    return { params: params };
  }

  function closeMobileNav() {
    var d = $("#mobileDrawer");
    if (d) d.classList.remove("drawer--open");
    var b = $("#backdrop");
    if (b) b.classList.remove("backdrop--show");
  }

  /* ---------------- header chrome (badges + account) ---------------- */
  function renderChrome() {
    var cartN = cartCount(), wishN = state.wishlist.length;
    var cb = $("#cartCount"), wb = $("#wishCount");
    if (cb) { cb.textContent = cartN > 99 ? "99+" : cartN; cb.hidden = cartN === 0; }
    if (wb) { wb.textContent = wishN > 99 ? "99+" : wishN; wb.hidden = wishN === 0; }

    var chip = $("#accountChip");
    if (chip) {
      var user = state.user ? findUser(state.user) : null;
      if (user) {
        chip.innerHTML = '<span class="chip__avatar">' + escapeHtml((user.name || "R").charAt(0).toUpperCase()) + '</span>' +
          '<span class="chip__meta"><b>' + escapeHtml(user.name || "Reader") + '</b><i>My account</i></span>';
        chip.dataset.state = "in";
      } else {
        chip.innerHTML = '<span class="chip__avatar chip__avatar--ghost">👤</span>' +
          '<span class="chip__meta"><b>Login</b><i>Sign in</i></span>';
        chip.dataset.state = "out";
      }
    }
  }

  /* ---------------- exports ---------------- */
  window.PT = window.PT || {};
  window.PT.App = {
    $: $, $$: $$, money: money, escapeHtml: escapeHtml, starsHtml: starsHtml, toast: toast,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, uid: uid,
    state: state, save: save, session: session, setSession: setSession,
    computeTotals: computeTotals, cartCount: cartCount,
    addToCart: addToCart, setQty: setQty, toggleWishlist: toggleWishlist, inWishlist: inWishlist,
    requireLogin: requireLogin, openAuth: openAuth, closeAuth: closeAuth, signOut: signOut,
    findUser: findUser, placeOrder: placeOrder, cancelOrder: cancelOrder, STATUS_STAGES: STATUS_STAGES,
    navigateTo: navigateTo, renderChrome: renderChrome, SHIP_FEE: SHIP_FEE, FREE_SHIP_MIN: FREE_SHIP_MIN,
    addSearch: addSearch, route: route, pushRecent: pushRecent
  };

  /* ---------------- boot (router declared in ui.js after views) ---------------- */
  window.addEventListener("hashchange", function () { onRoute(false); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAuth();
  });

  document.addEventListener("DOMContentLoaded", function () {
    /* scrub any card details a previous version may have left in session storage */
    try { setSession({ cardNum: null, cardExp: null, cardName: null }); } catch (_e) { /* private mode */ }
    if (window.PT.View) { window.PT.View.registerRoutes(); }
    renderChrome();
    onRoute();
  });
})();
