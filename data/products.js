/* ============================================================
   UVID — catalog data
   categories · products · coupons · review pool
   Images are generated as inline SVG data-URIs (no binaries needed).
   ============================================================ */

(function () {
  "use strict";

  /* ---------- placeholder product art (SVG data URI) ---------- */
  function art(emoji, bg, ink) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">' +
      '<defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">' +
      '<path d="M40 0H0v40" fill="none" stroke="' + ink + '" stroke-opacity="0.13" stroke-width="1"/></pattern></defs>' +
      '<rect width="640" height="640" fill="' + bg + '"/>' +
      '<rect width="640" height="640" fill="url(#g)"/>' +
      '<circle cx="320" cy="308" r="188" fill="#ffffff" fill-opacity="0.55"/>' +
      '<text x="320" y="392" font-size="220" text-anchor="middle">' + emoji + '</text>' +
      '</svg>';
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  /* ---------- categories ---------- */
  var CATEGORIES = [
    { slug: "pens",      label: "Pens & Writing",   emoji: "🖊️", blurb: "Gel, ball, fountain & fineliners" },
    { slug: "notebooks", label: "Notebooks",        emoji: "📒", blurb: "Journals, registers & hardbounds" },
    { slug: "office",    label: "Office Supplies",  emoji: "📎", blurb: "Files, staplers & desk extras" },
    { slug: "art",       label: "Art & Craft",      emoji: "🎨", blurb: "Paints, pencils & canvas" },
    { slug: "desk",      label: "Desk Accessories", emoji: "🗂️", blurb: "Organisers, stands & clips" },
    { slug: "school",    label: "School Essentials",emoji: "✏️", blurb: "Geometry, labels & kits" },
    { slug: "planners",  label: "Planners",         emoji: "🗓️", blurb: "Plan the year, one page a day" }
  ];

  /* ---------- products ---------- */
  var P = [
    { id: "gel-trio",        name: "GlideWrite Gel Pen Trio (0.7mm, Blue)", brand: "GlideWrite", category: "pens",      price: 149, mrp: 220, rating: 4.5, ratingCount: 2314, emoji: "🖊️", bg: "#EEF2FF", ink: "#4C5BD4", stock: 40, tags: ["bestseller"],
      highlights: ["Smooth-flow German tip, no skips", "Quick-dry ink — no smudges", "Comfort grip for long writing", "Pack of 3 + 1 free refill"],
      specs: { "Ink Colour": "Blue", "Tip Size": "0.7 mm", "Pack": "3 pens + refill", "Refillable": "Yes" } },
    { id: "fountain-classic",name: "Inkwell Fountain Pen — Classic",        brand: "Inkwell",    category: "pens",      price: 349, mrp: 499, rating: 4.6, ratingCount: 876,  emoji: "🖋️", bg: "#FDF2E9", ink: "#C77B30", stock: 18, tags: ["premium"],
      highlights: ["Iridium fine nib, glass-smooth", "Brass barrel with matte lacquer", "Includes converter + 2 cartridges", "Gift-box packing"],
      specs: { "Nib": "Fine (F)", "Body": "Brass", "Filling": "Converter + cartridge", "Weight": "24 g" } },
    { id: "fineliner-12",    name: "Doodle Fineliner Set — 12 Shades",      brand: "Doodle",     category: "pens",      price: 259, mrp: 399, rating: 4.7, ratingCount: 1502, emoji: "🖌️", bg: "#F3E8FF", ink: "#8B47C9", stock: 33, tags: ["bestseller", "deal"],
      highlights: ["12 vibrant archival colours", "0.4 mm felt tips, bleed-proof", "Perfect for journaling & doodles", "Colour-coded caps"],
      specs: { "Colours": "12", "Tip": "0.4 mm", "Ink": "Water-based", "Use": "Journals, planners" } },
    { id: "ballpoint-25",    name: "Scriptora Ballpoint Jar (25 pcs)",      brand: "Scriptora",  category: "pens",      price: 399, mrp: 599, rating: 4.3, ratingCount: 445,  emoji: "🖊️", bg: "#E8F5EE", ink: "#2E8B57", stock: 25, tags: ["value"],
      highlights: ["Office-jar pack of 25", "1.0 mm medium tip", "Long-lasting ink tank", "Blue + black mix"],
      specs: { "Pack": "25 pens", "Tip": "1.0 mm", "Ink": "Blue / Black", "Use": "Office & bulk" } },

    { id: "dotted-journal",  name: "PaperMuse Dotted Journal A5",           brand: "PaperMuse",  category: "notebooks", price: 299, mrp: 450, rating: 4.8, ratingCount: 3208, emoji: "📓", bg: "#FFF1F0", ink: "#D4574E", stock: 50, tags: ["bestseller"],
      highlights: ["160 gsm dot-grid, zero bleed", "Lay-flat sewn binding", "Elastic closure + ribbon", "Bullet-journal favourite"],
      specs: { "Size": "A5", "Pages": "192", "Ruling": "Dot grid 5 mm", "Binding": "Sewn lay-flat" } },
    { id: "spiral-200",      name: "NoteNest Spiral Register — 200 Pages",  brand: "NoteNest",   category: "notebooks", price: 119, mrp: 180, rating: 4.4, ratingCount: 980,  emoji: "📔", bg: "#EAF4FF", ink: "#3E7CC2", stock: 60, tags: [],
      highlights: ["Single-line ruling, 70 gsm", "Sturdy twin-wire spiral", "Laminated soft cover", "Great for lectures & notes"],
      specs: { "Size": "Single line 21×29 cm", "Pages": "200", "Binding": "Spiral", "GSM": "70" } },
    { id: "hardbound-240",   name: "PaperMuse Hardbound Ruled — 240 Pages", brand: "PaperMuse",  category: "notebooks", price: 189, mrp: 260, rating: 4.6, ratingCount: 1105, emoji: "📕", bg: "#F0FFF4", ink: "#38A169", stock: 45, tags: [],
      highlights: ["Premium hardback cover", "Foolscap ruled pages", "Opens flat for neat notes", "Index page + date box"],
      specs: { "Size": "Foolscap", "Pages": "240", "Ruling": "Ruled", "Binding": "Hardbound" } },
    { id: "sticky-trio",     name: "NoteNest Sticky Notes Combo (3 Pads)",  brand: "NoteNest",   category: "notebooks", price: 99,  mrp: 150, rating: 4.2, ratingCount: 620,  emoji: "🗒️", bg: "#FFFBEA", ink: "#D4A017", stock: 80, tags: ["deal"],
      highlights: ["3 pads — 76×76 mm, 100 sheets", "Pastel assortment", "Re-sticks without residue", "Perfect page markers"],
      specs: { "Pads": "3", "Sheets": "100 per pad", "Size": "76×76 mm", "Colours": "Pastel mix" } },

    { id: "stapler-hd",      name: "ClipWorks Heavy-Duty Stapler",          brand: "ClipWorks",  category: "office",    price: 289, mrp: 420, rating: 4.4, ratingCount: 530,  emoji: "📎", bg: "#EDF0F7", ink: "#5A6B8C", stock: 22, tags: [],
      highlights: ["Staples up to 40 sheets", "Full-strip, metal body", "Anti-slip base", "Free 1000 staples included"],
      specs: { "Capacity": "40 sheets", "Type": "Full strip", "Body": "Metal", "Includes": "1000 staples" } },
    { id: "folder-10",       name: "ClipWorks File Folders (Pack of 10)",   brand: "ClipWorks",  category: "office",    price: 199, mrp: 299, rating: 4.2, ratingCount: 388,  emoji: "🗂️", bg: "#FFF4EC", ink: "#C56B34", stock: 35, tags: ["value"],
      highlights: ["A4 lever-arch clip folders", "Spine label window", "Fits 100 sheets each", "Assorted pastel spines"],
      specs: { "Pack": "10 folders", "Size": "A4", "Capacity": "100 sheets", "Type": "Clip file" } },
    { id: "kraft-envelopes", name: "Scriptora Kraft Envelopes (Set of 20)", brand: "Scriptora",  category: "office",    price: 129, mrp: 199, rating: 4.1, ratingCount: 210,  emoji: "✉️", bg: "#F6F1E7", ink: "#8C7B54", stock: 40, tags: [],
      highlights: ["Textured kraft paper", "Peel-and-seal strip", "Fits A5 invitations", "Letter-writing ready"],
      specs: { "Pack": "20", "Size": "16×23 cm", "Paper": "Kraft 120 gsm", "Seal": "Peel & stick" } },
    { id: "wbmarkers-4",     name: "GlideWrite Whiteboard Markers (4)",     brand: "GlideWrite", category: "office",    price: 179, mrp: 250, rating: 4.5, ratingCount: 296,  emoji: "🖍️", bg: "#EAF6FF", ink: "#2E86C1", stock: 28, tags: [],
      highlights: ["Low-odour dry-erase ink", "Chisel tip — broad or fine", "Erases cleanly, no ghosting", "4 assorted colours"],
      specs: { "Pack": "4 markers", "Tip": "Chisel", "Ink": "Dry-erase", "Colours": "Blk/Blu/Red/Grn" } },

    { id: "watercolor-24",   name: "ArtBerry Watercolour Cakes — 24",       brand: "ArtBerry",   category: "art",       price: 449, mrp: 650, rating: 4.7, ratingCount: 1240, emoji: "🎨", bg: "#FDEFF6", ink: "#C2508B", stock: 20, tags: ["bestseller", "deal"],
      highlights: ["24 artist-grade pigments", "Includes brush pen + palette", "Blends beautifully on 200 gsm", "Metal tin case"],
      specs: { "Colours": "24", "Type": "Semi-moist cakes", "Includes": "Brush + tin", "Level": "Beginner → artist" } },
    { id: "sketch-12",       name: "ArtBerry Sketch Pencils (12B–6H)",      brand: "ArtBerry",   category: "art",       price: 229, mrp: 320, rating: 4.6, ratingCount: 861,  emoji: "✏️", bg: "#F2F2F2", ink: "#4A4A4A", stock: 30, tags: [],
      highlights: ["Full tonal range 12B–6H", "Break-resistant graphite", "Pre-sharpened, cedar wood", "Includes eraser + sharpener"],
      specs: { "Set": "12 pencils", "Range": "12B to 6H", "Wood": "Cedar", "Extras": "Eraser, sharpener" } },
    { id: "acrylic-12",      name: "Doodle Acrylic Paint Set — 12 Tubes",   brand: "Doodle",     category: "art",       price: 399, mrp: 560, rating: 4.5, ratingCount: 470,  emoji: "🧴", bg: "#E9FBEF", ink: "#27AE60", stock: 26, tags: [],
      highlights: ["12 × 12 ml rich pigments", "Dries fast, water-resistant", "Works on canvas, wood, paper", "Student & hobby grade"],
      specs: { "Colours": "12", "Volume": "12 ml each", "Base": "Water", "Surface": "Multi-surface" } },
    { id: "canvas-pack",     name: "ArtBerry Canvas Boards (Pack of 4)",    brand: "ArtBerry",   category: "art",       price: 349, mrp: 499, rating: 4.4, ratingCount: 355,  emoji: "🖼️", bg: "#FBF3E4", ink: "#B08A3E", stock: 19, tags: [],
      highlights: ["Triple-primed cotton surface", "Sturdy MDF backing", "Two 8×10\" + two 6×8\" boards", "Acrylic & oil compatible"],
      specs: { "Pack": "4 boards", "Sizes": "8×10 in, 6×8 in", "Surface": "Cotton, primed", "Use": "Acrylic / oil" } },

    { id: "desk-organiser",  name: "PaperMuse Bamboo Desk Organiser",       brand: "PaperMuse",  category: "desk",      price: 599, mrp: 899, rating: 4.5, ratingCount: 712,  emoji: "🗃️", bg: "#F5EFE3", ink: "#9C7A3C", stock: 15, tags: ["premium"],
      highlights: ["5 compartments + phone slot", "Solid bamboo, hand-finished", "Fits pens, notes, gadgets", "Anti-scratch felt base"],
      specs: { "Material": "Bamboo", "Compartments": "5 + 1", "Size": "22×10×9 cm", "Assembly": "None" } },
    { id: "mag-clips-6",     name: "ClipWorks Magnetic Clips (6 Pack)",     brand: "ClipWorks",  category: "desk",      price: 149, mrp: 220, rating: 4.3, ratingCount: 288,  emoji: "🧲", bg: "#EFF4FB", ink: "#5D6D9E", stock: 44, tags: [],
      highlights: ["Holds 25+ sheets on fridges", "Neodymium magnets", "Powder-coated steel", "6 bright colours"],
      specs: { "Pack": "6", "Hold": "~25 sheets", "Magnet": "Neodymium", "Finish": "Powder coat" } },
    { id: "pen-stand",       name: "NoteNest Rotating Pen Stand",           brand: "NoteNest",   category: "desk",      price: 349, mrp: 500, rating: 4.2, ratingCount: 198,  emoji: "🪄", bg: "#F3ECFB", ink: "#7E57C2", stock: 27, tags: [],
      highlights: ["360° smooth rotation", "4 dividable compartments", "Recycled ABS body", "Fits 60+ pens"],
      specs: { "Rotation": "360°", "Sections": "4", "Material": "Recycled ABS", "Capacity": "60+ pens" } },

    { id: "geometry-box",    name: "PaperMuse Geometry Box",                brand: "PaperMuse",  category: "school",    price: 179, mrp: 250, rating: 4.4, ratingCount: 505,  emoji: "📐", bg: "#EAF7F4", ink: "#2C8C7D", stock: 38, tags: ["bestseller"],
      highlights: ["Precision steel compass", "Protractor, set squares, scale", "Clutch pencil + leads", "Metal clamp-lock case"],
      specs: { "Instruments": "9 pieces", "Case": "Metal", "Compass": "Precision steel", "For": "Class 6+" } },
    { id: "school-labels",   name: "NoteNest School Labels (60 pcs)",       brand: "NoteNest",   category: "school",    price: 59,  mrp: 99,  rating: 4.1, ratingCount: 240,  emoji: "🏷️", bg: "#FFF0F3", ink: "#C94F6D", stock: 90, tags: ["value"],
      highlights: ["60 write-on name labels", "Water & smear resistant", "Books, bottles, lunchboxes", "Assorted sizes"],
      specs: { "Count": "60", "Sizes": "3 sizes", "Finish": "Matte", "Writable": "Ball/gel/fountain" } },
    { id: "eraser-set",      name: "Doodle Eraser + Sharpener Set",         brand: "Doodle",     category: "school",    price: 89,  mrp: 140, rating: 4.3, ratingCount: 412,  emoji: "🧽", bg: "#F1F6EC", ink: "#6A994E", stock: 70, tags: [],
      highlights: ["Dust-free erasers ×4", "Single-hole sharpeners ×2", "Non-toxic, kid-safe", "Smudge-free erasing"],
      specs: { "Erasers": "4", "Sharpeners": "2", "Material": "Non-toxic", "Age": "3+" } },

    { id: "planner-2026",    name: "PaperMuse Daily Planner 2026",          brand: "PaperMuse",  category: "planners",  price: 449, mrp: 650, rating: 4.8, ratingCount: 1980, emoji: "🗓️", bg: "#EFF3FF", ink: "#4056C9", stock: 24, tags: ["bestseller", "new"],
      highlights: ["Dated Jan–Dec 2026", "Day page: priorities + habits", "Monthly spreads + goals", "A5 hardbound, lay-flat"],
      specs: { "Year": "2026 dated", "Size": "A5", "Binding": "Hardbound", "Extras": "Habit tracker, pocket" } },
    { id: "wall-calendar",   name: "Scriptora Monthly Wall Calendar",       brand: "Scriptora",  category: "planners",  price: 149, mrp: 240, rating: 4.2, ratingCount: 165,  emoji: "📅", bg: "#FDF6EC", ink: "#B4832A", stock: 55, tags: [],
      highlights: ["12 monthly sheets", "Big date boxes to write", "Matte art paper, no glare", "Steel hook hanger"],
      specs: { "Size": "17×24 in", "Sheets": "12", "Paper": "150 gsm art", "Hanging": "Center hook" } },

    /* ONE product, three size variants (3/4/5 mm). The _vc-* records below hold
       per-variant price/photo for cart & orders; they are hidden from all
       listings via the "vc-hidden" tag and exposed as PT.visibleProducts. */
    { id: "bamboo-chopsticks",name: "Bamboo Chopstick",                         brand: "UVID Essentials", category: "office", price: 46,  mrp: 46,  rating: null, ratingCount: 0,  emoji: "🥢", bg: "#F7F1E4", ink: "#B08A3E", stock: 100, tags: ["new"],
      highlights: ["Natural-finish bamboo, 20 cm long", "Choose 3 mm, 4 mm or 5 mm thickness", "Handy pack for meals at home or on the go", "Light single-use or reusable quality"],
      specs: { "Material": "Natural bamboo", "Length": "20 cm", "Finish": "Natural" },
      variantMeta: [
        { id: "_vc-bamboo-chopsticks-3", size: "3 mm", label: "3 mm × 20 cm", price: 46 },
        { id: "_vc-bamboo-chopsticks-4", size: "4 mm", label: "4 mm × 20 cm", price: 75 },
        { id: "_vc-bamboo-chopsticks-5", size: "5 mm", label: "5 mm × 20 cm", price: 100 }
      ] },

    { id: "_vc-bamboo-chopsticks-3", name: "Bamboo Chopstick — 3 mm × 20 cm", brand: "UVID Essentials", category: "office", price: 46,  mrp: 46,  rating: null, ratingCount: 0, emoji: "🥢", bg: "#F7F1E4", ink: "#B08A3E", stock: 100, tags: ["vc-hidden"], parent: "bamboo-chopsticks",
      highlights: ["Natural-finish bamboo, 20 cm long", "3 mm slim profile, easy to handle", "Handy pack for meals at home or on the go", "Light single-use or reusable quality"],
      specs: { "Material": "Natural bamboo", "Thickness": "3 mm", "Length": "20 cm", "Finish": "Natural" } },

    { id: "_vc-bamboo-chopsticks-4", name: "Bamboo Chopstick — 4 mm × 20 cm", brand: "UVID Essentials", category: "office", price: 75,  mrp: 75,  rating: null, ratingCount: 0, emoji: "🥢", bg: "#F7F1E4", ink: "#B08A3E", stock: 100, tags: ["vc-hidden"], parent: "bamboo-chopsticks",
      highlights: ["Natural-finish bamboo, 20 cm long", "4 mm sturdy profile, easy to handle", "Handy pack for meals at home or on the go", "Light single-use or reusable quality"],
      specs: { "Material": "Natural bamboo", "Thickness": "4 mm", "Length": "20 cm", "Finish": "Natural" } },

    { id: "_vc-bamboo-chopsticks-5", name: "Bamboo Chopstick — 5 mm × 20 cm", brand: "UVID Essentials", category: "office", price: 100, mrp: 100, rating: null, ratingCount: 0, emoji: "🥢", bg: "#F7F1E4", ink: "#B08A3E", stock: 100, tags: ["vc-hidden"], parent: "bamboo-chopsticks",
      highlights: ["Natural-finish bamboo, 20 cm long", "5 mm extra-sturdy profile", "Handy pack for meals at home or on the go", "Light single-use or reusable quality"],
      specs: { "Material": "Natural bamboo", "Thickness": "5 mm", "Length": "20 cm", "Finish": "Natural" } }
  ];

  /* attach generated art + derived fields.
     Real photos: window.UVID_IMG (from data/product-images.js) overrides SVG art
     when assets/<product-id>.jpg exists — built by tools/embed-images.js. */
  var REAL = (typeof window !== "undefined" && window.UVID_IMG) || {};
  P.forEach(function (p, i) {
    p.img = REAL[p.id] || art(p.emoji, p.bg, p.ink);
    p.thumb = p.img;
    p.discount = Math.round(((p.mrp - p.price) / p.mrp) * 100);
    p.added = P.length - i;              // "newest" ordering
    p.popularity = p.ratingCount + p.discount * 7; // demo relevance score
  });

  /* wire the chopstick size variants: attach per-variant price/label/photo to
     the main product; main image defaults to the first variant (3 mm). */
  (function () {
    var main = null, i, j;
    for (i = 0; i < P.length; i++) if (P[i].id === "bamboo-chopsticks") main = P[i];
    if (!main || !main.variantMeta) return;
    main.variants = [];
    for (i = 0; i < main.variantMeta.length; i++) {
      var vm = main.variantMeta[i], rec = null;
      for (j = 0; j < P.length; j++) if (P[j].id === vm.id) rec = P[j];
      if (!rec) continue;
      rec.parent = main.id;
      main.variants.push({ id: rec.id, size: vm.size, label: vm.label, price: rec.price, mrp: rec.mrp, img: rec.img });
    }
    if (main.variants.length) main.img = main.variants[0].img; // 3 mm pack shot
  })();

  /* products shown in listings/search/home — excludes _vc-* variant records */
  var VISIBLE = P.filter(function (p) { return p.tags.indexOf("vc-hidden") === -1; });

  /* ---------- coupons ---------- */
  var COUPONS = [
    { code: "PAPER10",  label: "10% off (up to ₹150)",       type: "percent", value: 10, cap: 150, min: 499,  note: "On orders above ₹499" },
    { code: "FIRST50",  label: "Flat ₹50 off",               type: "flat",    value: 50, cap: 50,  min: 399,  note: "On orders above ₹399" },
    { code: "DESK200",  label: "Flat ₹200 off",              type: "flat",    value: 200, cap: 200, min: 1999, note: "On orders above ₹1999" },
    { code: "FREESHIP", label: "Free delivery",              type: "ship",    value: 0,  cap: 0,   min: 0,    note: "No minimum — shipping on us" }
  ];

  /* ---------- deterministic review pool ---------- */
  var NAMES = ["Aarav S.", "Diya K.", "Rohan M.", "Ishita P.", "Kabir N.", "Meera T.", "Aditya R.", "Sara J.", "Vivaan B.", "Ananya D."];
  var HEADS = ["Excellent quality!", "Worth every rupee", "Exactly as described", "Great for daily use", "Packaging was perfect", "Good, minor niggles", "My new favourite", "Solid value buy"];
  var BODIES = [
    "Arrived two days early and the packaging was spotless. Paper quality is genuinely premium.",
    "Been using it daily for three weeks — zero complaints. Feels built to last.",
    "Colours/pieces matched the photos exactly. Would order again for my desk setup.",
    "Slight delay in delivery but the product itself is flawless. Seller communicated well.",
    "Gifted it to my sister and she loved it. Presentation box is a nice touch.",
    "Good for the price. Not luxury-grade, but absolutely reliable for students.",
    "The finish is much nicer in person. Photos don't do it justice.",
    "Does the job perfectly. Instant checkout and smooth delivery made it painless."
  ];

  function hash(s) {
    var h = 0, i;
    for (i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return h;
  }

  function reviewsFor(productId) {
    var h = hash(productId), out = [], n = 3 + (h % 3), i;
    for (i = 0; i < n; i++) {
      var r = hash(productId + ":" + i);
      var stars = [5, 5, 4, 4, 3][(r + i) % 5];
      out.push({
        name: NAMES[(r + i) % NAMES.length],
        stars: stars,
        head: HEADS[r % HEADS.length],
        body: BODIES[(r >> 3) % BODIES.length],
        date: ["Sep 2026", "Aug 2026", "Jul 2026", "Jun 2026"][(r + i) % 4],
        verified: (r % 4) !== 0
      });
    }
    return out;
  }

  /* ---------- exports ---------- */
  window.PT = {
    art: art, /* emoji-fallback product art (used by js/sync.js when the API has no image) */
    CATEGORIES: CATEGORIES,
    PRODUCTS: P,
    visibleProducts: VISIBLE,
    legacyProductRedirect: {
      "bamboo-chopsticks-4mm": "bamboo-chopsticks",
      "bamboo-chopsticks-5mm": "bamboo-chopsticks"
    },
    COUPONS: COUPONS,
    reviewsFor: reviewsFor,
    findProduct: function (id) {
      /* legacy ids from the old separate listings map to their variant record */
      if (id === "bamboo-chopsticks-4mm") id = "_vc-bamboo-chopsticks-4";
      if (id === "bamboo-chopsticks-5mm") id = "_vc-bamboo-chopsticks-5";
      for (var i = 0; i < P.length; i++) if (P[i].id === id) return P[i];
      return null;
    },
    categoryBySlug: function (slug) {
      for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].slug === slug) return CATEGORIES[i];
      return null;
    }
  };
})();
