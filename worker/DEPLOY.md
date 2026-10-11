# Deploy the separate seminar page only

This folder deploys the seminar landing page and registration form only. It
does not connect the stationery store's customer and admin portals. For the
store backend, use [`../cloudflare-store/DEPLOY.md`](../cloudflare-store/DEPLOY.md)
and its `uvid-store` D1 binding instead.

---

# Seminar page deployment (free, permanent)

Cloudflare Workers + D1. Free tier, **permanent URL that never changes**, and
registrations are stored in D1 so they survive restarts and redeploys.

Verified locally before deployment: `node test/worker-test.mjs` → **23 passed, 0 failed**.

## One-time setup (about 5 minutes)

Run these from the `stationery/worker` folder in a terminal.
**Use `wrangler@3`** — the latest version needs Node 22, and this machine runs Node 20.

```bash
cd stationery/worker

# 1. Log in to Cloudflare (free account). Opens a browser tab — authorise it.
npx wrangler@3 login

# 2. Create the database. It prints a database_id — copy it.
npx wrangler@3 d1 create uvid-seminar

# 3. Put that database_id into wrangler.toml, replacing
#    REPLACE_WITH_YOUR_D1_DATABASE_ID

# 4. Create the tables
npx wrangler@3 d1 execute uvid-seminar --file=schema.sql

# 5. Set the owner password for the registrations page (it is NOT the
#    admin password of the main store). It becomes an encrypted secret.
npx wrangler@3 secret put ADMIN_PASSWORD

# 6. Deploy
npx wrangler@3 deploy
```

Step 6 prints your permanent address:

```
https://uvid-seminar.<your-name>.workers.dev
```

## After deploying

| What | Where |
|---|---|
| Public seminar page | `https://uvid-seminar.<your-name>.workers.dev/` |
| Owner sign-in (registrations) | `https://uvid-seminar.<your-name>.workers.dev/admin` |
| CSV export | `/admin/export.csv` (after signing in) |

**Edit the seminar details** — for now they live in D1. Either edit with SQL:

```bash
npx wrangler@3 d1 execute uvid-seminar --command \
  "UPDATE seminar_details SET title='Your title', event_date='Your date', speaker='Your speaker' WHERE id=1"
```

…or add an owner form at `/admin` later if you want to click-edit them.

## Things to know

- **The page is the same file** the local store serves (`stationery/seminar/index.html`),
  so editing it updates both. There is no second copy.
- Registrations are only visible with the owner password; `/admin` returns 401 otherwise.
- Spam protection: hidden honeypot field, minimum time on form, and a per-IP limit
  (20/hour). Caught spam is silently discarded.
- The main stationery store is unaffected and still runs locally on port 8787.

## Redeploying after editing the page

```bash
npx wrangler@3 deploy
```
