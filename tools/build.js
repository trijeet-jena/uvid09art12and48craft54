/* UVID build: inline src/index.html + css + js → single-file index.html */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "index.html");

let html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");

/* inline css */
html = html.replace(
  /<link rel="stylesheet" href="css\/styles.css" \/>/,
  () => "<style>\n" + fs.readFileSync(path.join(root, "css", "styles.css"), "utf8") + "\n</style>"
);

/* inline js in document order */
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, srcAttr) => {
  const rel = srcAttr.replace(/^\.\//, "");
  const code = fs.readFileSync(path.join(root, rel), "utf8");
  // guard: a literal </script> inside JS would end the tag early
  const safe = code.split("</script>").join("<\\/script>");
  return "<script>\n" + safe + "\n</script>";
});

fs.writeFileSync(outPath, html);
console.log("Built index.html —", (html.length / 1024).toFixed(1) + " KB");
