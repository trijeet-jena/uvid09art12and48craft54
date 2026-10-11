-- ============================================================
--  UVID seminar — Cloudflare D1 schema
--  Run once:  npx wrangler d1 execute uvid-seminar --file=schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS seminar_details (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  title         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  event_date    TEXT NOT NULL DEFAULT '',
  event_time    TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',
  meeting_url   TEXT NOT NULL DEFAULT '',
  speaker       TEXT NOT NULL DEFAULT '',
  agenda        TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seminar_registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  organization  TEXT,
  notes         TEXT,
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seminar_reg_created ON seminar_registrations(created_at);
CREATE INDEX IF NOT EXISTS idx_seminar_reg_email   ON seminar_registrations(lower(email));

-- single editable details row; blank = the public page shows an editable placeholder
INSERT OR IGNORE INTO seminar_details (id) VALUES (1);
