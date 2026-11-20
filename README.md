# Nelmora Parfums: online shop

Your customer-facing store, with an admin area for orders, stock and settings.

- Frontend: React (Vite)
- Backend: Node + Express
- Database: SQLite (one file, `data/shop.db`, nothing to install)

Same setup as `nelmora-portal`, so it works the same way.

## Run it

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

While editing code: `npm run dev` and open http://localhost:5174 (live reload).
Tests: `npm test`.

## Before going live: checklist

1. **Admin → Settings**: enter your real bank account, WhatsApp number, email and Instagram. The defaults are placeholders.
2. **Admin → Products & stock**: set the real stock for each scent. Every size starts at 10.
3. Check the product descriptions. They are starter copy written from your scent notes.
4. Check the shipping rates: RM8 Peninsular, RM15 Sabah/Sarawak/Labuan, free from RM150. Change them in Settings.
5. Optional: turn on online payment (below).

## What customers get

- Home, shop (filter by for her / for him / size, search by note), product pages with 10ml / 30ml
- Bag drawer with a free-shipping progress bar
- Checkout with Malaysian states, postcode check, and automatic West/East shipping
- Payment by **bank transfer / DuitNow**: bank details appear after ordering, with a "Send receipt on WhatsApp" button. Or pay **online with FPX / card / GrabPay** when Stripe is on.
- An order page with a status tracker. Customers can look an order up any time with the order number and their email.
- Contact form

## What you get (admin)

| Page | For |
|---|---|
| Dashboard | Today's and this month's paid sales, orders to ship, orders awaiting payment, low stock, top sellers |
| Orders | Filter/search, **Mark paid**, **Mark shipped**, tracking number, WhatsApp the customer in one click, copy address, CSV export |
| Products & stock | Edit stock inline. Edit names, notes, descriptions, prices, sizes, and upload photos. Hide products or mark bestsellers |
| Messages | Contact form messages |
| Settings | Shipping rates, bank details, contact info, announcement bar, database backup |

**Stock rules:** stock goes down when an order is placed, so items are reserved. Cancelling an order puts the stock back. Online-payment orders that are never paid are auto-cancelled after 2 hours. Bank-transfer orders stay reserved until you cancel them.

**Prices are always checked by the server**, so nobody can change a price in their browser.

## Online payment (Stripe: FPX, card, GrabPay)

1. Create a Stripe account (Malaysia) and enable FPX and GrabPay under Settings → Payment methods.
2. Put your secret key in `.env` as `STRIPE_SECRET_KEY`.
3. Add a webhook in Stripe → Developers → Webhooks: URL `https://YOUR-DOMAIN/api/stripe/webhook`, event `checkout.session.completed`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Set `PUBLIC_URL` to your real address and restart.

Leave it empty and the shop takes bank transfer only.

## Putting it online (Render)

The repo includes [render.yaml](render.yaml), which sets up everything: Node, a 1GB persistent disk for the database and photos, HTTPS, and the Singapore region (closest to Malaysia).

1. In Render: **New → Blueprint**, connect GitHub, pick this repository.
2. Fill in `ADMIN_PASSWORD` (a strong one) and `PUBLIC_URL` (your Render address, e.g. `https://nelmora-shop.onrender.com`; update it later if you add a domain).
3. Click **Apply**. The first deploy takes a few minutes.
4. Open `/admin` on the live site and fill in **Settings** and **stock**.

Every push to GitHub redeploys automatically. Orders, products and photos live on the disk and survive redeploys.

**Own domain:** Render → your service → Settings → Custom Domains → add `nelmoraparfums.com`, then add the DNS records Render shows at your domain registrar. Update `PUBLIC_URL` afterwards.

## Backups

Admin → Settings → **Download backup**, weekly. Or copy `data/shop.db` (and `data/uploads/` for photos you upload).

## Project layout

```
server/index.js        API routes, admin login, website serving
server/shop.js         pricing, shipping, validation rules
server/db.js           tables, default settings, first-run catalogue
server/stripe.js       Stripe Checkout (optional)
client/src/pages/      shop pages
client/src/admin/      admin pages
client/public/images/  product photos and logo
```
