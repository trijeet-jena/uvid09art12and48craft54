# Connect UVID to Cloudflare's free backend

This Worker uses the D1 database `uvid-store` whose ID is already in
`wrangler.toml`. It keeps the existing Netlify customer and admin pages and
connects both to the same product and image database. No R2 subscription is
used.

## One-time setup in VS Code

Open the extracted `stationery` folder in VS Code. Open **Terminal → New
Terminal**, then run these commands one at a time:

```powershell
cd cloudflare-store
npm install
npx wrangler login
npx wrangler d1 execute uvid-store --remote --file=schema.sql
npx wrangler d1 execute uvid-store --remote --file=seed-catalog.sql
```

`wrangler login` opens a Cloudflare page. Approve it with the same account
where you created `uvid-store`.

Now add the admin credentials as encrypted Cloudflare secrets. Run each command
and enter the value when Wrangler prompts:

```powershell
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

Use your admin Gmail for `ADMIN_EMAIL`, choose a strong admin password, and set
`SESSION_SECRET` to a different random value at least 32 characters long. Keep
these values private. Customer sign-in remains Gmail-only with no password or
OTP, as requested.

Deploy the backend:

```powershell
npx wrangler deploy
```

Wrangler prints a URL similar to:

```text
https://uvid-store-api.your-account.workers.dev
```

## Connect the existing Netlify site

1. In VS Code, open the top-level `netlify.toml` file in the `stationery`
   folder.
2. This package is preconfigured for the `uvid21-store` workers.dev subdomain.
   Confirm Wrangler printed `https://uvid-store-api.uvid21-store.workers.dev`.
   If you selected a different subdomain, replace `uvid21-store` in both
   Worker targets in the top-level `netlify.toml` with the subdomain from
   Wrangler's URL.
3. Save `netlify.toml`.
4. Push the updated `stationery` folder to the same GitHub repository Netlify
   uses. Netlify should redeploy automatically. If it does not, open Netlify's
   site and choose **Deploys → Trigger deploy**.
5. Open `https://uvid21.netlify.app/admin/`, sign in with the admin Gmail and
   password you set above, add a test product and a compressed photo, then
   refresh the storefront. The product and photo are saved to the shared D1
   database, so the customer page can load them too.

## Important image size limit on the free database

Cloudflare D1 Free currently allows 500 MB per database, 5 GB total storage
across the account, and a maximum 2 MB row. This package caps a compressed
image at 1.4 MB so it fits safely under that row limit. If an upload is too
large, choose a smaller image or reduce its dimensions/quality in the admin
image editor. The included starting catalog has its product descriptions and
existing local photos copied into the site's `assets/cf-store/` folder; new
photos uploaded in Admin are stored in D1 and served from the same site.

If the free account reaches its D1 daily read/write allowance, requests stop
until the allowance resets; do not upgrade or add a paid subscription unless
you choose to. Watch D1 usage in **Cloudflare → Storage & databases → D1 →
uvid-store → Metrics**.

## After changing backend code

From the `cloudflare-store` folder run:

```powershell
npx wrangler deploy
```

Netlify needs redeploying only when the website files or `netlify.toml` change.
