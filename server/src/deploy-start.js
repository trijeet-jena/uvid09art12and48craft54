/* Cloud/local launcher: restore the packaged catalog to persistent storage on
   first boot, seed the configured admin once, then start the Express server. */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

if (process.env.NODE_ENV === "production") {
  const required = ["JWT_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
  const missing = required.filter((key) => !String(process.env[key] || "").trim());
  if (missing.length) {
    throw new Error("Set the required Render environment values before starting: " + missing.join(", "));
  }
}

const DATA_DIR = process.env.UVID_DATA_DIR
  ? path.resolve(process.env.UVID_DATA_DIR)
  : path.join(__dirname, "..", "data");
const DEPLOY_DIR = path.join(__dirname, "..", "deploy");
const DB_FILE = path.join(DATA_DIR, "uvid.db");
const SEED_DB = path.join(DEPLOY_DIR, "catalog-seed.sqlite");
const SEED_MARKER = path.join(DATA_DIR, ".uvid-seeded");

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE) && fs.existsSync(SEED_DB)) {
  fs.copyFileSync(SEED_DB, DB_FILE);
  console.log("[deploy] Restored the packaged product catalog and photos.");
}

const seedUploads = path.join(DEPLOY_DIR, "uploads");
if (fs.existsSync(seedUploads)) {
  const uploadDir = path.join(DATA_DIR, "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  for (const name of fs.readdirSync(seedUploads)) {
    const source = path.join(seedUploads, name);
    const target = path.join(uploadDir, name);
    if (fs.statSync(source).isFile() && !fs.existsSync(target)) fs.copyFileSync(source, target);
  }
}

if (!fs.existsSync(SEED_MARKER)) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "seed.js")], {
    cwd: path.join(__dirname, "..", ".."),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  fs.writeFileSync(SEED_MARKER, new Date().toISOString() + "\n", "utf8");
}

require("./index");
