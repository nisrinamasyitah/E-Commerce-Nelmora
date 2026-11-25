// The shop API (Express). Runs two ways:
//   - locally:  server/index.js starts it (and also serves the website)
//   - Netlify:  netlify/functions/shop.js wraps it as a serverless function
const path = require('path');
const crypto = require('crypto');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* .env is optional */ }

const express = require('express');
const { db, getSettings, DEFAULT_SETTINGS, newOfferCode } = require('./db');
const { STATES, quote, validateCustomer, clean } = require('./shop');
const stripe = require('./stripe');
const storage = require('./storage');

// Logos the "We accept" strip can show. Only DuitNow/bank transfer works without Stripe; the rest need Stripe switched on.
const PAYMENT_LOGOS = ['visa', 'mastercard', 'amex', 'applepay', 'googlepay', 'fpx', 'duitnow', 'grabpay'];
const chosenLogos = (v) => String(v || '').split(',').map((x) => x.trim()).filter((x) => PAYMENT_LOGOS.includes(x));

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// ---------------------------------------------------------------- helpers
const fail = (status, message) => Object.assign(new Error(message), { status, isFail: true });
const clientIp = (req) => req.headers['x-nf-client-connection-ip'] || req.ip || 'unknown';
const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');

// Simple database-backed rate limit (works across serverless instances).
async function blocked(key, limit, windowMs) {
  const since = Date.now() - windowMs;
  await db.run('DELETE FROM throttle WHERE key = ? AND ts < ?', [key, since]);
  return (await db.get('SELECT COUNT(*) n FROM throttle WHERE key = ? AND ts >= ?', [key, since])).n >= limit;
}
const hit = (key) => db.run('INSERT INTO throttle (key, ts) VALUES (?, ?)', [key, Date.now()]);

const VARIANT_SQL = `SELECT v.id, v.price, v.stock, v.size, (v.active AND p.active) AS active,
  p.name, p.slug, p.cutout AS image FROM variants v JOIN products p ON p.id = v.product_id`;

/** Look up every variant in a cart with one query and return a find(id) function for quote(). */
async function variantFinder(r, items) {
  const ids = [...new Set((Array.isArray(items) ? items : []).map((i) => Number(i?.variantId)).filter(Number.isInteger))].slice(0, 50);
  const map = new Map();
  if (ids.length) for (const v of await r.all(`${VARIANT_SQL} WHERE v.id IN (${ids.map(() => '?').join(',')})`, ids)) map.set(v.id, v);
  return (id) => map.get(id);
}

async function catalogue(r, where = 'p.active = 1', params = [], variantWhere = 'v.active = 1') {
  const [products, variants] = await Promise.all([
    r.all(`SELECT p.* FROM products p WHERE ${where} ORDER BY p.sort, p.name`, params),
    r.all(`SELECT v.* FROM variants v WHERE ${variantWhere} ORDER BY v.price`),
  ]);
  const byProduct = new Map();
  for (const v of variants) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id).push({ id: v.id, size: v.size, price: v.price, stock: v.stock, active: !!v.active });
  }
  return products.map((p) => ({ ...p, featured: !!p.featured, active: !!p.active, variants: byProduct.get(p.id) || [] }));
}
const publicProduct = (p) => ({
  ...p,
  variants: p.variants.map(({ stock, ...v }) => ({ ...v, inStock: stock > 0, lowStock: stock > 0 && stock <= 3 })),
});

const rmText = (sen) => 'RM' + (Number.isInteger(sen / 100) ? sen / 100 : (sen / 100).toFixed(2));

/** Check a welcome code for a cart. Returns { discount, code } when valid, or { error } with a customer-friendly reason. */
async function checkCode(r, rawCode, email, subtotal, s) {
  const code = clean(rawCode, 40).toUpperCase();
  if (!code) return { discount: 0 };
  if (!s.welcome_discount) return { error: 'This offer is no longer available.' };
  const sub = await r.get('SELECT email, used_order FROM subscribers WHERE code = ?', [code]);
  if (!sub) return { error: 'That code is not valid.' };
  if (sub.used_order) return { error: 'This code has already been used.' };
  const mail = clean(email, 160).toLowerCase();
  if (!mail) return { error: 'Enter the email you signed up with to use this code.' };
  if (mail !== sub.email) return { error: 'Use the email you signed up with for this code.' };
  if (subtotal < s.welcome_min_spend) return { error: `Spend ${rmText(s.welcome_min_spend)} or more to use this code.` };
  return { discount: Math.min(s.welcome_discount, subtotal), code };
}

async function newCode(r) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const code = 'NM-' + Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
    if (!(await r.get('SELECT 1 x FROM orders WHERE code = ?', [code]))) return code;
  }
}

async function orderWithItems(r, order) {
  if (!order) return null;
  const items = await r.all(`SELECT oi.*, p.slug, p.cutout AS image FROM order_items oi
    LEFT JOIN variants v ON v.id = oi.variant_id LEFT JOIN products p ON p.id = v.product_id WHERE order_id = ?`, [order.id]);
  return { ...order, items };
}
const publicOrder = (o) => {
  const { token, stripe_session, admin_note, ...rest } = o;
  return rest;
};

async function restock(t, orderId) {
  await t.run('UPDATE subscribers SET used_order = NULL WHERE used_order = ?', [orderId]); // cancelled order frees the welcome code
  for (const it of await t.all('SELECT variant_id, qty FROM order_items WHERE order_id = ?', [orderId])) {
    if (it.variant_id) await t.run('UPDATE variants SET stock = stock + ? WHERE id = ?', [it.qty, it.variant_id]);
  }
}
/** Take stock again for a cancelled order. Checks everything first so it is all-or-nothing. */
async function unstock(t, orderId) {
  const items = (await t.all('SELECT variant_id, qty, name, size FROM order_items WHERE order_id = ?', [orderId])).filter((i) => i.variant_id);
  for (const it of items) {
    const v = await t.get('SELECT stock FROM variants WHERE id = ?', [it.variant_id]);
    if (!v || v.stock < it.qty) throw fail(409, `Not enough stock of ${it.name} ${it.size} to reopen this order.`);
  }
  for (const it of items) await t.run('UPDATE variants SET stock = stock - ? WHERE id = ?', [it.qty, it.variant_id]);
  const o = await t.get('SELECT discount_code FROM orders WHERE id = ?', [orderId]);
  if (o?.discount_code) await t.run('UPDATE subscribers SET used_order = ? WHERE code = ? AND used_order IS NULL', [orderId, o.discount_code]);
}

async function markPaid(code, sessionId) {
  await db.tx(async (t) => {
    const o = await t.get('SELECT * FROM orders WHERE code = ?', [code]);
    if (!o || o.payment_status === 'paid') return;
    let reopen = false;
    if (o.status === 'cancelled') { // paid after the hold expired: take the stock again if we still can
      try { await unstock(t, o.id); reopen = true; } catch { /* admin will see it as paid + cancelled and sort it out */ }
    }
    await t.run(`UPDATE orders SET payment_status = 'paid', stripe_session = COALESCE(NULLIF(?, ''), stripe_session)${reopen ? ", status = 'new'" : ''} WHERE id = ?`,
      [sessionId || '', o.id]);
  });
}

async function cancelUnpaid(code) {
  await db.tx(async (t) => {
    const o = await t.get('SELECT id FROM orders WHERE code = ? AND payment_method = ? AND payment_status = ? AND status = ?', [code, 'stripe', 'unpaid', 'new']);
    if (!o) return;
    await t.run("UPDATE orders SET status = 'cancelled', admin_note = TRIM(admin_note || ' Auto-cancelled: online payment expired or failed.') WHERE id = ?", [o.id]);
    await restock(t, o.id);
  });
}

// Card/FPX orders that were never paid release their stock after 2 hours.
// There is no background timer in serverless, so this runs (at most once a minute) when the shop is used.
let lastExpire = 0;
async function expireUnpaid() {
  if (Date.now() - lastExpire < 60_000) return;
  lastExpire = Date.now();
  const stale = await db.all(`SELECT id FROM orders WHERE payment_method = 'stripe' AND payment_status = 'unpaid'
    AND status = 'new' AND created_at < datetime('now', '-2 hours')`);
  for (const { id } of stale) {
    await db.tx(async (t) => {
      const r = await t.run(`UPDATE orders SET status = 'cancelled', admin_note = TRIM(admin_note || ' Auto-cancelled: online payment not completed.')
        WHERE id = ? AND status = 'new' AND payment_status = 'unpaid'`, [id]);
      if (r.changes) await restock(t, id);
    });
  }
}

// ---------------------------------------------------------------- setup middleware
app.use(async (_req, res, next) => {
  try { await db.ready; next(); } catch (e) {
    res.status(503).json({ error: e.isConfig ? e.message : 'The shop database is unavailable. Please try again shortly.' });
  }
});
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Stripe needs the raw body to verify the signature, so this route comes before express.json.
app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const event = stripe.verifyWebhook(req.body, req.headers['stripe-signature']);
  if (!event) return res.status(400).send('Bad signature');
  const s = event.data?.object || {};
  const code = s.metadata?.order_code;
  if (code) {
    if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && s.payment_status === 'paid') await markPaid(code, s.id);
    // the customer never finished paying (window closed / session expired / bank declined): free the stock right away
    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') await cancelUnpaid(code);
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '200kb' }));

// ---------------------------------------------------------------- public API
app.get('/api/config', async (_req, res) => {
  const s = await getSettings();
  res.json({
    states: STATES,
    shipping: { west: s.shipping_west, east: s.shipping_east, freeMin: s.free_shipping_min },
    bank: { name: s.bank_name, accountName: s.bank_account_name, accountNo: s.bank_account_no },
    whatsapp: s.whatsapp, email: s.contact_email, instagram: s.instagram, announcement: s.announcement,
    welcome: { amount: s.welcome_discount, minSpend: s.welcome_min_spend },
    paymentLogos: stripe.enabled ? chosenLogos(s.payment_logos) : chosenLogos(s.payment_logos).filter((x) => x === 'duitnow'),
    stripeEnabled: stripe.enabled,
    stripeTest: stripe.enabled && stripe.test,
  });
});

app.get('/api/products', async (_req, res) => {
  await expireUnpaid();
  res.json((await catalogue(db)).map(publicProduct));
});

app.get('/api/products/:slug', async (req, res) => {
  const [p] = await catalogue(db, 'p.active = 1 AND p.slug = ?', [req.params.slug]);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(publicProduct(p));
});

// Customer reviews. The shop owner enters these in Admin from real customer feedback; nothing is generated here.
app.get('/api/reviews', async (req, res) => {
  const slug = clean(req.query.product, 80);
  const rows = await db.all(
    `SELECT r.id, r.name, r.rating, r.body, r.source, r.reviewed_at, p.name product_name, p.slug product_slug
       FROM reviews r LEFT JOIN products p ON p.id = r.product_id
      WHERE r.published = 1 ${slug ? 'AND p.slug = ?' : ''} ORDER BY r.reviewed_at DESC, r.id DESC LIMIT 100`,
    slug ? [slug] : [],
  );
  const reviews = rows.map((r) => ({ id: r.id, name: r.name, rating: r.rating, body: r.body, source: r.source, date: r.reviewed_at, product: r.product_name || '', slug: r.product_slug || '' }));
  const average = reviews.length ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10 : 0;
  res.json({ count: reviews.length, average, reviews });
});

app.post('/api/quote', async (req, res) => {
  const s = await getSettings();
  const q = quote(req.body.items, req.body.state, s, await variantFinder(db, req.body.items));
  const d = await checkCode(db, req.body.code, req.body.email, q.subtotal, s);
  res.json({ ...q, discount: d.discount || 0, discountCode: d.code || '', codeMessage: d.error || '', total: q.total - (d.discount || 0) });
});

app.post('/api/orders', async (req, res) => {
  const { customer, errors } = validateCustomer(req.body.customer || {});
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please check your details.', fields: errors });
  const method = req.body.paymentMethod === 'stripe' && stripe.enabled ? 'stripe' : 'transfer';
  const s = await getSettings();
  await expireUnpaid();

  let created;
  try {
    created = await db.tx(async (t) => {
      const q = quote(req.body.items, customer.state, s, await variantFinder(t, req.body.items));
      if (!q.lines.length) throw fail(400, 'Your bag is empty.');
      if (q.problems.length) throw Object.assign(fail(409, 'Some items in your bag changed. Please review it.'), { problems: q.problems });
      const d = await checkCode(t, req.body.code, customer.email, q.subtotal, s);
      if (d.error) throw fail(400, d.error);
      const discount = d.discount || 0;
      q.discount = discount;
      q.total -= discount;
      const code = await newCode(t);
      const token = crypto.randomBytes(16).toString('hex');
      const { lastInsertRowid: orderId } = await t.run(`INSERT INTO orders
        (code, token, name, email, phone, address1, address2, postcode, city, state, region, note, subtotal, shipping, total, payment_method, discount, discount_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, token, customer.name, customer.email, customer.phone, customer.address1, customer.address2, customer.postcode,
        customer.city, customer.state, q.region, customer.note, q.subtotal, q.shipping, q.total, method, discount, d.code || '']);
      if (d.code) { // claim the code; fails if someone used it a moment ago
        const claimed = await t.run('UPDATE subscribers SET used_order = ? WHERE code = ? AND used_order IS NULL', [orderId, d.code]);
        if (!claimed.changes) throw fail(400, 'This code has already been used.');
      }
      for (const l of q.lines) {
        const r = await t.run('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?', [l.qty, l.variantId, l.qty]);
        if (!r.changes) throw fail(409, `${l.name} ${l.size} just sold out.`);
        await t.run('INSERT INTO order_items (order_id, variant_id, name, size, price, qty) VALUES (?, ?, ?, ?, ?, ?)',
          [orderId, l.variantId, l.name, l.size, l.price, l.qty]);
      }
      return { orderId, code, token, q };
    });
  } catch (e) {
    if (e.problems) return res.status(409).json({ error: e.message, problems: e.problems });
    throw e;
  }
  const { orderId, code, token, q } = created;
  const base = baseUrl(req);
  const orderUrl = `${base}/order/${code}?t=${token}`;

  if (method === 'stripe') {
    try {
      const session = await stripe.createCheckout({
        code, email: customer.email, lines: q.lines, shipping: q.shipping, discount: q.discount || 0,
        successUrl: `${orderUrl}&paid=1`, cancelUrl: `${base}/checkout?cancelled=${code}`,
      });
      await db.run('UPDATE orders SET stripe_session = ? WHERE id = ?', [session.id, orderId]);
      return res.json({ code, token, redirect: session.url });
    } catch (e) {
      console.error('Stripe error:', e.message);
      await db.tx(async (t) => { await restock(t, orderId); await t.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", [orderId]); });
      throw fail(502, 'Online payment is unavailable right now. Please choose bank transfer or try again.');
    }
  }
  res.json({ code, token });
});

app.get('/api/orders/:code', async (req, res) => {
  const o = await db.get('SELECT * FROM orders WHERE code = ?', [String(req.params.code).toUpperCase()]);
  const t = String(req.query.t || '');
  const email = String(req.query.email || '').trim().toLowerCase();
  const ok = o && ((t && t.length === o.token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(o.token)))
    || (email && email === o.email));
  if (!ok) return res.status(404).json({ error: 'We could not find that order. Check the order number and email.' });
  if (o.payment_method === 'stripe' && o.payment_status === 'unpaid' && o.stripe_session && stripe.enabled) {
    try {
      const s = await stripe.getSession(o.stripe_session);
      if (s.payment_status === 'paid') await markPaid(o.code, s.id);
    } catch (e) { console.error('Stripe lookup failed:', e.message); }
  }
  res.json(publicOrder(await orderWithItems(db, await db.get('SELECT * FROM orders WHERE id = ?', [o.id]))));
});

app.post('/api/contact', async (req, res) => {
  const key = `contact:${clientIp(req)}`;
  if (await blocked(key, 5, 3600_000)) return res.status(429).json({ error: 'Too many messages. Please try again later.' });
  const name = clean(req.body.name, 120), email = clean(req.body.email, 160), message = clean(req.body.message, 3000);
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 5) {
    return res.status(400).json({ error: 'Please fill in your name, a valid email and a message.' });
  }
  await hit(key);
  await db.run('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)', [name, email, message]);
  res.json({ ok: true });
});

const GENDERS = ['Women', 'Men', 'Prefer not to say'];
app.post('/api/subscribe', async (req, res) => {
  const key = `subscribe:${clientIp(req)}`;
  if (await blocked(key, 10, 3600_000)) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  const b = req.body || {};
  const email = clean(b.email, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  const name = clean(b.name, 60);
  const phone = clean(b.phone, 30).replace(/[^\d+]/g, '');
  if (phone && phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Please enter a valid phone number, or leave it empty.' });
  const month = Math.round(Number(b.month)), day = Math.round(Number(b.day));
  const birthday = month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
  const gender = GENDERS.includes(b.gender) ? b.gender : '';
  await hit(key);

  const s = await getSettings();
  let sub = await db.get('SELECT * FROM subscribers WHERE email = ?', [email]);
  if (sub) { // already on the list: only fill in details they had not given before
    await db.run(`UPDATE subscribers SET name = CASE WHEN name = '' THEN ? ELSE name END, phone = CASE WHEN phone = '' THEN ? ELSE phone END,
      birthday = CASE WHEN birthday = '' THEN ? ELSE birthday END, gender = CASE WHEN gender = '' THEN ? ELSE gender END WHERE id = ?`,
    [name, phone, birthday, gender, sub.id]);
  } else {
    await db.run('INSERT OR IGNORE INTO subscribers (email, name, phone, birthday, gender, source, code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [email, name, phone, birthday, gender, clean(b.source, 20), newOfferCode()]);
    sub = await db.get('SELECT * FROM subscribers WHERE email = ?', [email]);
  }
  const offer = s.welcome_discount > 0;
  res.json({
    ok: true,
    code: offer && !sub.used_order ? sub.code : null,
    used: offer && !!sub.used_order,
    amount: s.welcome_discount,
    minSpend: s.welcome_min_spend,
  });
});

// Product photos uploaded from the admin
app.get('/uploads/:name', async (req, res) => {
  if (!/^[\w.-]+$/.test(req.params.name)) return res.status(404).end();
  const file = await storage.get(req.params.name);
  if (!file) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.type(file.type).send(file.buffer);
});

// ---------------------------------------------------------------- admin auth
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = crypto.createHash('sha256').update(process.env.SESSION_SECRET || 'nelmora-shop:' + ADMIN_PASSWORD).digest();
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('hex');
const safeEq = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const makeToken = () => { const exp = String(Date.now() + 14 * 864e5); return `${exp}.${sign(exp)}`; };
const validToken = (t) => { const [exp, sig] = String(t || '').split('.'); return !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp)); };

app.post('/api/admin/login', async (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin is locked. Set ADMIN_PASSWORD in the environment settings and redeploy.' });
  const key = `login:${clientIp(req)}`;
  if (await blocked(key, 5, 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  if (safeEq(req.body.password || '', ADMIN_PASSWORD)) return res.json({ token: makeToken() });
  await hit(key);
  res.status(401).json({ error: 'Wrong password' });
});
app.use('/api/admin', (req, res, next) => {
  if (ADMIN_PASSWORD && validToken((req.headers.authorization || '').replace('Bearer ', ''))) return next();
  res.status(401).json({ error: 'Login required' });
});

// ---------------------------------------------------------------- admin API
app.get('/api/admin/summary', async (_req, res) => {
  await expireUnpaid();
  const paid = "payment_status = 'paid' AND status != 'cancelled'";
  const [today, month, toShip, awaiting, unread, lowStock, topSellers, recent] = await Promise.all([
    db.get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue FROM orders WHERE ${paid} AND date(created_at,'+8 hours') = date('now','+8 hours')`),
    db.get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue FROM orders WHERE ${paid} AND strftime('%Y-%m',created_at,'+8 hours') = strftime('%Y-%m','now','+8 hours')`),
    db.get("SELECT COUNT(*) n FROM orders WHERE status IN ('new','processing') AND payment_status = 'paid'"),
    db.get("SELECT COUNT(*) n FROM orders WHERE status = 'new' AND payment_status = 'unpaid'"),
    db.get('SELECT COUNT(*) n FROM messages WHERE handled = 0'),
    db.all(`SELECT p.name, v.size, v.stock FROM variants v JOIN products p ON p.id = v.product_id
      WHERE p.active = 1 AND v.active = 1 AND v.stock <= 3 ORDER BY v.stock, p.name`),
    db.all(`SELECT oi.name, oi.size, SUM(oi.qty) qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'paid' AND o.status != 'cancelled' GROUP BY oi.name, oi.size ORDER BY qty DESC LIMIT 5`),
    db.all('SELECT id, code, name, total, status, payment_status, created_at FROM orders ORDER BY id DESC LIMIT 8'),
  ]);
  res.json({ today, month, toShip: toShip.n, awaitingPayment: awaiting.n, unreadMessages: unread.n, lowStock, topSellers, recent });
});

app.get('/api/admin/orders', async (req, res) => {
  const where = [], params = [];
  if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status)); }
  if (req.query.q) { where.push('(code LIKE ? OR name LIKE ? OR email LIKE ? OR phone LIKE ?)'); params.push(...Array(4).fill(`%${req.query.q}%`)); }
  res.json(await db.all(`SELECT o.*, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) items FROM orders o
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`, params));
});

app.get('/api/admin/orders.csv', async (_req, res) => {
  const rows = await db.all(`SELECT o.code, datetime(o.created_at,'+8 hours') created_myt, o.name, o.email, o.phone, o.address1, o.address2,
    o.postcode, o.city, o.state, o.status, o.payment_method, o.payment_status, o.subtotal/100.0 subtotal, o.shipping/100.0 shipping,
    o.discount/100.0 discount, o.discount_code, o.total/100.0 total, o.tracking, (SELECT GROUP_CONCAT(name || ' ' || size || ' x' || qty, '; ') FROM order_items WHERE order_id = o.id) items
    FROM orders o ORDER BY o.id`);
  const cols = rows[0] ? Object.keys(rows[0]) : ['code'];
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="nelmora-orders.csv"');
  res.send([cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
});

app.get('/api/admin/orders/:id', async (req, res) => {
  const o = await orderWithItems(db, await db.get('SELECT * FROM orders WHERE id = ?', [req.params.id]));
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.json(o);
});

const STATUSES = ['new', 'processing', 'shipped', 'completed', 'cancelled'];
app.patch('/api/admin/orders/:id', async (req, res) => {
  const out = await db.tx(async (t) => {
    const o = await t.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) throw fail(404, 'Not found');
    const next = {
      status: STATUSES.includes(req.body.status) ? req.body.status : o.status,
      payment_status: ['unpaid', 'paid', 'refunded'].includes(req.body.payment_status) ? req.body.payment_status : o.payment_status,
      tracking: req.body.tracking !== undefined ? clean(req.body.tracking, 120) : o.tracking,
      admin_note: req.body.admin_note !== undefined ? clean(req.body.admin_note, 1000) : o.admin_note,
    };
    if (o.status !== 'cancelled' && next.status === 'cancelled') await restock(t, o.id);
    if (o.status === 'cancelled' && next.status !== 'cancelled') await unstock(t, o.id);
    await t.run('UPDATE orders SET status = ?, payment_status = ?, tracking = ?, admin_note = ? WHERE id = ?',
      [next.status, next.payment_status, next.tracking, next.admin_note, o.id]);
    return orderWithItems(t, await t.get('SELECT * FROM orders WHERE id = ?', [o.id]));
  });
  res.json(out);
});

app.get('/api/admin/products', async (_req, res) => res.json(await catalogue(db, '1', [], '1')));

const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function saveProduct(id, b) {
  const p = {
    name: clean(b.name, 80), gender: ['Men', 'Women', 'Unisex'].includes(b.gender) ? b.gender : 'Unisex',
    family: clean(b.family, 60), tagline: clean(b.tagline, 160), description: clean(b.description, 2000),
    notes: clean(b.notes, 300), image: clean(b.image, 300), cutout: clean(b.cutout, 300),
    featured: b.featured ? 1 : 0, active: b.active === false ? 0 : 1, sort: Number.isFinite(+b.sort) ? Math.round(+b.sort) : 0,
  };
  if (p.name.length < 2) throw fail(400, 'Name is required.');
  p.slug = slugify(clean(b.slug, 80) || p.name);
  if (!p.slug) throw fail(400, 'Name is required.');
  const variants = (Array.isArray(b.variants) ? b.variants : []).map((v) => ({
    id: v.id ? Number(v.id) : null, size: clean(v.size, 20), price: Math.round(Number(v.price)),
    stock: Math.max(0, Math.round(Number(v.stock) || 0)), active: v.active === false ? 0 : 1,
  }));
  for (const v of variants) {
    if (!v.size) throw fail(400, 'Each size needs a name, e.g. 30ml.');
    if (!(v.price > 0)) throw fail(400, `Price for ${v.size} must be more than 0.`);
  }
  if (new Set(variants.map((v) => v.size.toLowerCase())).size !== variants.length) throw fail(400, 'Each size can only appear once.');

  return db.tx(async (t) => {
    if (await t.get('SELECT id FROM products WHERE slug = ? AND id != ?', [p.slug, id || 0])) throw fail(400, 'Another product already uses this name/link.');
    const f = [p.slug, p.name, p.gender, p.family, p.tagline, p.description, p.notes, p.image, p.cutout, p.featured, p.active, p.sort];
    if (id) {
      await t.run(`UPDATE products SET slug=?, name=?, gender=?, family=?, tagline=?, description=?, notes=?, image=?, cutout=?, featured=?, active=?, sort=? WHERE id=?`, [...f, id]);
    } else {
      id = (await t.run(`INSERT INTO products (slug, name, gender, family, tagline, description, notes, image, cutout, featured, active, sort)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, f)).lastInsertRowid;
    }
    const keep = [];
    for (const v of variants) {
      const existing = v.id && await t.get('SELECT id FROM variants WHERE id = ? AND product_id = ?', [v.id, id]);
      if (existing) {
        await t.run('UPDATE variants SET size=?, price=?, stock=?, active=? WHERE id=?', [v.size, v.price, v.stock, v.active, v.id]);
        keep.push(v.id);
      } else {
        keep.push((await t.run('INSERT INTO variants (product_id, size, price, stock, active) VALUES (?, ?, ?, ?, ?)',
          [id, v.size, v.price, v.stock, v.active])).lastInsertRowid);
      }
    }
    // sizes removed in the form are hidden, not deleted, so old orders keep their link
    if (keep.length) await t.run(`UPDATE variants SET active = 0 WHERE product_id = ? AND id NOT IN (${keep.map(() => '?').join(',')})`, [id, ...keep]);
    else await t.run('UPDATE variants SET active = 0 WHERE product_id = ?', [id]);
    return (await catalogue(t, 'p.id = ?', [id], '1'))[0];
  });
}
app.post('/api/admin/products', async (req, res) => res.json(await saveProduct(null, req.body)));
app.put('/api/admin/products/:id', async (req, res) => {
  if (!(await db.get('SELECT 1 x FROM products WHERE id = ?', [req.params.id]))) throw fail(404, 'Not found');
  res.json(await saveProduct(Number(req.params.id), req.body));
});

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
app.post('/api/admin/upload', express.raw({ type: Object.keys(IMAGE_TYPES), limit: '4mb' }), async (req, res) => {
  const ext = IMAGE_TYPES[req.headers['content-type']];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP image (max 4MB).' });
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await storage.put(name, req.body);
  res.json({ url: `/uploads/${name}` });
});

app.get('/api/admin/settings', async (_req, res) => res.json(await getSettings()));
app.put('/api/admin/settings', async (req, res) => {
  await db.tx(async (t) => {
    for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
      if (!(k in req.body)) continue;
      let v = req.body[k];
      if (typeof def === 'number') { v = Math.round(Number(v)); if (!Number.isFinite(v) || v < 0) throw fail(400, `Invalid value for ${k}`); }
      else v = clean(v, 300);
      if (k === 'whatsapp') v = v.replace(/\D/g, '');
      if (k === 'payment_logos') v = chosenLogos(v).join(',');
      await t.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
    }
  });
  res.json(await getSettings());
});

app.get('/api/admin/subscribers', async (_req, res) => res.json(await db.all('SELECT id, email, name, phone, birthday, gender, source, code, used_order, created_at FROM subscribers ORDER BY id DESC')));
app.delete('/api/admin/subscribers/:id', async (req, res) => {
  await db.run('DELETE FROM subscribers WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});
app.get('/api/admin/messages', async (_req, res) => res.json(await db.all('SELECT * FROM messages ORDER BY id DESC LIMIT 300')));
app.patch('/api/admin/messages/:id', async (req, res) => {
  await db.run('UPDATE messages SET handled = ? WHERE id = ?', [req.body.handled ? 1 : 0, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/reviews', async (_req, res) => res.json(await db.all(
  `SELECT r.*, p.name product_name FROM reviews r LEFT JOIN products p ON p.id = r.product_id ORDER BY r.reviewed_at DESC, r.id DESC`)));
function reviewFields(b) {
  const name = clean(b.name, 60), body = clean(b.body, 1000), rating = Math.round(Number(b.rating));
  if (!name) throw fail(400, 'Customer name is required.');
  if (body.length < 3) throw fail(400, 'Write the review text.');
  if (!(rating >= 1 && rating <= 5)) throw fail(400, 'Choose 1 to 5 stars.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.reviewed_at)) ? b.reviewed_at : new Date().toISOString().slice(0, 10);
  return [Number(b.product_id) || null, name, rating, body, clean(b.source, 30), date, b.published === false ? 0 : 1];
}
app.post('/api/admin/reviews', async (req, res) => {
  const r = await db.run('INSERT INTO reviews (product_id, name, rating, body, source, reviewed_at, published) VALUES (?, ?, ?, ?, ?, ?, ?)', reviewFields(req.body));
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/admin/reviews/:id', async (req, res) => {
  await db.run('UPDATE reviews SET product_id = ?, name = ?, rating = ?, body = ?, source = ?, reviewed_at = ?, published = ? WHERE id = ?', [...reviewFields(req.body), req.params.id]);
  res.json({ ok: true });
});
app.delete('/api/admin/reviews/:id', async (req, res) => {
  await db.run('DELETE FROM reviews WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// Full data export (JSON). The online database also keeps its own backups.
app.get('/api/admin/backup', async (_req, res) => {
  const data = { exported_at: new Date().toISOString() };
  for (const t of ['products', 'variants', 'orders', 'order_items', 'messages', 'subscribers', 'reviews', 'settings']) data[t] = await db.all(`SELECT * FROM ${t}`);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="nelmora-shop-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------------------------------------------------------------- errors
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.isFail) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = { app };
