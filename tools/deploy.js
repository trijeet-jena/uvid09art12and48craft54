/* Deploy the built store to CodeSandbox (no account needed) → public URL */
const fs = require("fs");
const path = require("path");
const https = require("https");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const payload = JSON.stringify({
  files: {
    "index.html": { content: html },
    "sandbox.config.json": { content: JSON.stringify({ template: "static" }) }
  }
});

const req = https.request(
  {
    hostname: "codesandbox.io",
    path: "/api/v1/sandboxes/define?json=1",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    }
  },
  (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      try {
        const j = JSON.parse(body);
        if (j.sandbox_id) {
          console.log("LIVE_URL=https://codesandbox.io/s/" + j.sandbox_id);
          console.log("PREVIEW_URL=https://" + j.sandbox_id + ".csb.app/");
        } else {
          console.log("RESPONSE=" + body.slice(0, 500));
        }
      } catch (e) {
        console.log("PARSE_ERROR", body.slice(0, 500));
      }
    });
  }
);

req.on("error", (e) => console.log("DEPLOY_ERROR", e.message));
req.write(payload);
req.end();
