# Nelmora Parfums: online shop

Customer-facing store with an admin area for orders, stock and settings.

- **Website:** React (Vite)
- **API:** Express, running as a Netlify Function online (and as a normal server on your computer)
- **Database:** Turso (online, SQLite-compatible, free plan). On your computer it uses a local file instead
- **Photos you upload:** Netlify Blobs (built in)

## Run it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd "nelmora e-commance"
cp .env.example .env     # then set ADMIN_PASSWORD and SESSION_SECRET
npm run setup            # installs everything (once)
npm run build            # builds the website (once, and after code changes)
npm start
```

- Shop: **http://localhost:3002**
- Admin: **http://localhost:3002/admin** (password = `ADMIN_PASSWORD`)

Locally the database is a file at `data/shop.db`; nothing to install.
While editing code: `npm run dev` and open http://localhost:5174 (live reload). Tests: `npm test`.

## Put it online with Netlify

### 1. Create the free online database (Turso)
1. Sign up at **turso.tech** (the free plan is enough).
2. Create a database (choose the **Singapore** region, closest to Malaysia).
3. Copy two values:
   - **Database URL**, looks like `libsql://your-db-name-yourname.turso.io`
   - **Auth token** (create one in the database's settings; "read & write")

### 2. Connect the repo to Netlify
1. In Netlify: **Add new site → Import an existing project**, pick this GitHub repository.
2. Leave the build settings as they are. [netlify.toml](netlify.toml) already sets them.

### 3. Add the environment variables
Netlify → **Site configuration → Environment variables**. Add:

| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | a strong password for /admin |
| `SESSION_SECRET` | a long random text (run `openssl rand -hex 32`) |
| `TURSO_DATABASE_URL` | the database URL from step 1 |
| `TURSO_AUTH_TOKEN` | the auth token from step 1 |
| `PUBLIC_URL` | your site address, e.g. `https://nelmoramy.netlify.app` |

Then **Deploys → Trigger deploy → Deploy site**.

### 4. First visit
Open `https://YOUR-SITE.netlify.app/admin`, sign in, and fill in **Settings** (bank account, WhatsApp, email) and **Products & stock**. The 12 scents are created automatically the first time the shop opens.

Every push to GitHub redeploys automatically. Orders, products and settings live in Turso and are not touched by deploys.

**Own domain:** Netlify → Domain management → Add a domain. Then set `PUBLIC_URL` to it.

## Before going live: checklist

1. **Admin → Settings**: real bank account, WhatsApp number, email, Instagram. The defaults are placeholders.
2. **Admin → Products & stock**: real stock per scent. Every size starts at 10.
3. Check the product descriptions (starter copy from your scent notes) and the policy pages (Policies.jsx), which are starter text.
4. Shipping: RM8 Peninsular, RM15 Sabah/Sarawak/Labuan, free from RM150. Change in Settings.
5. Optional: turn on online payment (below).

## What customers get

- Home, shop (filter by for her / for him / family / size, search by note), product pages with 10ml / 30ml, Scent Finder quiz
- Bag drawer with a free-shipping progress bar
- Checkout with Malaysian states, postcode check and automatic West/East shipping
- Payment by **bank transfer / DuitNow** (bank details appear after ordering, with a WhatsApp receipt button), or **FPX / card / GrabPay** when Stripe is on
- Order page with a status tracker. Customers can look an order up any time with order number + email
- Contact form and newsletter sign-up

## What you get (admin)

| Page | For |
|---|---|
| Dashboard | Today's and this month's paid sales, orders to ship, orders awaiting payment, low stock, top sellers |
| Orders | Filter/search, **Mark paid**, **Mark shipped**, tracking number, WhatsApp the customer, copy address, CSV export |
| Products & stock | Edit stock inline; edit names, notes, descriptions, prices, sizes; upload photos |
| Messages & subscribers | Contact form messages and newsletter emails |
| Settings | Shipping rates, bank details, contact info, announcement bar, data backup |

**Stock rules:** stock goes down when an order is placed (items are reserved). Cancelling an order puts it back. Online-payment orders that are never paid are cancelled after 2 hours. Bank-transfer orders stay reserved until you cancel them.

**Prices are always checked by the server**, so nobody can change a price in their browser.

## Online payment (Stripe: FPX, card, GrabPay)

1. Create a Stripe account (Malaysia) and enable FPX and GrabPay under Settings → Payment methods.
2. Add `STRIPE_SECRET_KEY` to the Netlify environment variables.
3. In Stripe → Developers → Webhooks add the URL `https://YOUR-SITE/api/stripe/webhook`, event `checkout.session.completed`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Redeploy.

Leave it empty and the shop takes bank transfer only.

## Backups

Admin → Settings → **Download backup** (a JSON file with everything), weekly. Turso also keeps its own backups of the database.

## Limits to know about

- Uploaded photos can be up to 4MB each.
- Netlify's free plan has monthly limits on function calls and bandwidth. A small shop stays well inside them.
- The first visit after a quiet period can take a second or two longer (the function wakes up).

## Project layout

```
server/app.js            API routes and admin login
server/shop.js           pricing, shipping, validation rules
server/db.js             database connection, tables, default settings, first-run catalogue
server/storage.js        uploaded photos (Netlify Blobs online, a folder locally)
server/stripe.js         Stripe Checkout (optional)
server/index.js          local server (npm start)
netlify/functions/shop.js  runs the API on Netlify
netlify.toml             Netlify build + routing settings
client/src/pages/        shop pages
client/src/admin/        admin pages
client/public/images/    product photos and logo
```
