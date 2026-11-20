const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* .env is optional */ }

const express = require('express');
const { db, dbPath, getSettings, DEFAULT_SETTINGS } = require('./db');
const { STATES, quote, validateCustomer, clean, regionOf } = require('./shop');
const stripe = require('./stripe');

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const uploadsDir = path.join(path.dirname(dbPath), 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
// Behind a host's proxy (Render, Railway…) set TRUST_PROXY=1 so each visitor's real IP is used for rate limits.
app.set('trust proxy', process.env.TRUST_PROXY ? (Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY) : 'loopback');
app.disable('x-powered-by');

// Stripe needs the raw body to verify the signature, so this route comes before express.json.
app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  const event = stripe.verifyWebhook(req.body, req.headers['stripe-signature']);
  if (!event) return res.status(400).send('Bad signature');
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object;
    if (s.payment_status === 'paid' && s.metadata?.order_code) markPaid(s.metadata.order_code, s.id);
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '200kb' }));

// ---------------------------------------------------------------- helpers
const send = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. Please try again.' });
  }
};
const fail = (status, message) => Object.assign(new Error(message), { status });

const variantStmt = db.prepare(`SELECT v.id, v.price, v.stock, v.size, (v.active AND p.active) AS active,
  p.name, p.slug, p.cutout AS image FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`);
const findVariant = (id) => variantStmt.get(id);

function productsWithVariants(where = 'p.active = 1', params = [], variantWhere = 'v.active = 1') {
  const products = db.prepare(`SELECT p.* FROM products p WHERE ${where} ORDER BY p.sort, p.name`).all(...params);
  const vs = db.prepare(`SELECT * FROM variants v WHERE v.product_id = ? AND ${variantWhere} ORDER BY v.price`);
  return products.map((p) => ({
    ...p, featured: !!p.featured, active: !!p.active,
    variants: vs.all(p.id).map((v) => ({ id: v.id, size: v.size, price: v.price, stock: v.stock, active: !!v.active })),
  }));
}
const publicProduct = (p) => ({
  ...p,
  variants: p.variants.map(({ stock, ...v }) => ({ ...v, inStock: stock > 0, lowStock: stock > 0 && stock <= 3 })),
});

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const code = 'NM-' + Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
    if (!db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code)) return code;
  }
}

function orderWithItems(order) {
  if (!order) return null;
  const items = db.prepare(`SELECT oi.*, p.slug, p.cutout AS image FROM order_items oi
    LEFT JOIN variants v ON v.id = oi.variant_id LEFT JOIN products p ON p.id = v.product_id WHERE order_id = ?`).all(order.id);
  return { ...order, items };
}
const publicOrder = (o) => {
  const { token, stripe_session, admin_note, ...rest } = o;
  return rest;
};

const restock = db.transaction((orderId) => {
  for (const it of db.prepare('SELECT variant_id, qty FROM order_items WHERE order_id = ?').all(orderId)) {
    if (it.variant_id) db.prepare('UPDATE variants SET stock = stock + ? WHERE id = ?').run(it.qty, it.variant_id);
  }
});
const unstock = db.transaction((orderId) => {
  for (const it of db.prepare('SELECT variant_id, qty, name, size FROM order_items WHERE order_id = ?').all(orderId)) {
    if (!it.variant_id) continue;
    const r = db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?').run(it.qty, it.variant_id, it.qty);
    if (!r.changes) throw fail(409, `Not enough stock of ${it.name} ${it.size} to reopen this order.`);
  }
});

function markPaid(code, sessionId) {
  const o = db.prepare('SELECT * FROM orders WHERE code = ?').get(code);
  if (!o || o.payment_status === 'paid') return;
  if (o.status === 'cancelled') { // paid after the hold expired: take the stock again if we still can
    try { unstock(o.id); } catch { /* admin will see it as paid + cancelled and sort it out */ }
    db.prepare("UPDATE orders SET status = 'new' WHERE id = ?").run(o.id);
  }
  db.prepare("UPDATE orders SET payment_status = 'paid', stripe_session = COALESCE(NULLIF(?, ''), stripe_session) WHERE id = ?")
    .run(sessionId || '', o.id);
}

// Card/FPX orders that were never paid release their stock after 2 hours.
function expireUnpaid() {
  const stale = db.prepare(`SELECT id FROM orders WHERE payment_method = 'stripe' AND payment_status = 'unpaid'
    AND status = 'new' AND created_at < datetime('now', '-2 hours')`).all();
  for (const { id } of stale) {
    db.transaction(() => {
      restock(id);
      db.prepare("UPDATE orders SET status = 'cancelled', admin_note = TRIM(admin_note || ' Auto-cancelled: online payment not completed.') WHERE id = ?").run(id);
    })();
  }
}
setInterval(expireUnpaid, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------- public API
app.get('/api/config', (_req, res) => {
  const s = getSettings();
  res.json({
    states: STATES,
    shipping: { west: s.shipping_west, east: s.shipping_east, freeMin: s.free_shipping_min },
    bank: { name: s.bank_name, accountName: s.bank_account_name, accountNo: s.bank_account_no },
    whatsapp: s.whatsapp, email: s.contact_email, instagram: s.instagram, announcement: s.announcement,
    stripeEnabled: stripe.enabled,
  });
});

app.get('/api/products', (_req, res) => res.json(productsWithVariants().map(publicProduct)));

app.get('/api/products/:slug', (req, res) => {
  const [p] = productsWithVariants('p.active = 1 AND p.slug = ?', [req.params.slug]);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(publicProduct(p));
});

app.post('/api/quote', (req, res) => {
  res.json(quote(req.body.items, req.body.state, getSettings(), findVariant));
});

app.post('/api/orders', send(async (req, res) => {
  const { customer, errors } = validateCustomer(req.body.customer || {});
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please check your details.', fields: errors });
  const method = req.body.paymentMethod === 'stripe' && stripe.enabled ? 'stripe' : 'transfer';
  const s = getSettings();

  const create = db.transaction(() => {
    const q = quote(req.body.items, customer.state, s, findVariant);
    if (!q.lines.length) throw fail(400, 'Your bag is empty.');
    if (q.problems.length) throw Object.assign(fail(409, 'Some items in your bag changed. Please review it.'), { problems: q.problems });
    const code = newCode();
    const token = crypto.randomBytes(16).toString('hex');
    const { lastInsertRowid: orderId } = db.prepare(`INSERT INTO orders
      (code, token, name, email, phone, address1, address2, postcode, city, state, region, note, subtotal, shipping, total, payment_method)
      VALUES (@code, @token, @name, @email, @phone, @address1, @address2, @postcode, @city, @state, @region, @note, @subtotal, @shipping, @total, @method)`)
      .run({ ...customer, code, token, region: q.region, subtotal: q.subtotal, shipping: q.shipping, total: q.total, method });
    for (const l of q.lines) {
      const r = db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?').run(l.qty, l.variantId, l.qty);
      if (!r.changes) throw fail(409, `${l.name} ${l.size} just sold out.`);
      db.prepare('INSERT INTO order_items (order_id, variant_id, name, size, price, qty) VALUES (?, ?, ?, ?, ?, ?)')
        .run(orderId, l.variantId, l.name, l.size, l.price, l.qty);
    }
    return { orderId, code, token, q };
  });

  let created;
  try { created = create(); } catch (e) {
    if (e.problems) return res.status(409).json({ error: e.message, problems: e.problems });
    throw e;
  }
  const { orderId, code, token, q } = created;
  const orderUrl = `${PUBLIC_URL}/order/${code}?t=${token}`;

  if (method === 'stripe') {
    try {
      const session = await stripe.createCheckout({
        code, email: customer.email, lines: q.lines, shipping: q.shipping,
        successUrl: `${orderUrl}&paid=1`, cancelUrl: `${PUBLIC_URL}/checkout?cancelled=${code}`,
      });
      db.prepare('UPDATE orders SET stripe_session = ? WHERE id = ?').run(session.id, orderId);
      return res.json({ code, token, redirect: session.url });
    } catch (e) {
      console.error('Stripe error:', e.message);
      db.transaction(() => { restock(orderId); db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(orderId); })();
      throw fail(502, 'Online payment is unavailable right now. Please choose bank transfer or try again.');
    }
  }
  res.json({ code, token });
}));

app.get('/api/orders/:code', send(async (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE code = ?').get(String(req.params.code).toUpperCase());
  const t = String(req.query.t || '');
  const email = String(req.query.email || '').trim().toLowerCase();
  const ok = o && ((t && t.length === o.token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(o.token)))
    || (email && email === o.email));
  if (!ok) return res.status(404).json({ error: 'We could not find that order. Check the order number and email.' });
  if (o.payment_method === 'stripe' && o.payment_status === 'unpaid' && o.stripe_session && stripe.enabled) {
    try {
      const s = await stripe.getSession(o.stripe_session);
      if (s.payment_status === 'paid') markPaid(o.code, s.id);
    } catch (e) { console.error('Stripe lookup failed:', e.message); }
  }
  res.json(publicOrder(orderWithItems(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id))));
}));

const contactHits = new Map();
app.post('/api/contact', (req, res) => {
  const now = Date.now();
  const hits = (contactHits.get(req.ip) || []).filter((t) => now - t < 3600_000);
  if (hits.length >= 5) return res.status(429).json({ error: 'Too many messages. Please try again later.' });
  const name = clean(req.body.name, 120), email = clean(req.body.email, 160), message = clean(req.body.message, 3000);
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 5) {
    return res.status(400).json({ error: 'Please fill in your name, a valid email and a message.' });
  }
  contactHits.set(req.ip, [...hits, now]);
  db.prepare('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)').run(name, email, message);
  res.json({ ok: true });
});

app.post('/api/subscribe', (req, res) => {
  const email = clean(req.body.email, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admin auth
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = crypto.createHash('sha256').update(process.env.SESSION_SECRET || 'nelmora-shop:' + ADMIN_PASSWORD).digest();
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('hex');
const safeEq = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const makeToken = () => { const exp = String(Date.now() + 14 * 864e5); return `${exp}.${sign(exp)}`; };
const validToken = (t) => { const [exp, sig] = String(t || '').split('.'); return !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp)); };

const failures = new Map();
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin is locked. Set ADMIN_PASSWORD in the .env file and restart the server.' });
  const f = failures.get(req.ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  if (safeEq(req.body.password || '', ADMIN_PASSWORD)) { failures.delete(req.ip); return res.json({ token: makeToken() }); }
  f.n += 1; if (f.n >= 5) { f.until = Date.now() + 60_000; f.n = 0; }
  failures.set(req.ip, f);
  res.status(401).json({ error: 'Wrong password' });
});
app.use('/api/admin', (req, res, next) => {
  if (ADMIN_PASSWORD && validToken((req.headers.authorization || '').replace('Bearer ', ''))) return next();
  res.status(401).json({ error: 'Login required' });
});

// ---------------------------------------------------------------- admin API
app.get('/api/admin/summary', (_req, res) => {
  const paid = "payment_status = 'paid' AND status != 'cancelled'";
  const one = (sql) => db.prepare(sql).get();
  res.json({
    today: one(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue FROM orders WHERE ${paid} AND date(created_at,'+8 hours') = date('now','+8 hours')`),
    month: one(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue FROM orders WHERE ${paid} AND strftime('%Y-%m',created_at,'+8 hours') = strftime('%Y-%m','now','+8 hours')`),
    toShip: one("SELECT COUNT(*) n FROM orders WHERE status IN ('new','processing') AND (payment_status = 'paid')").n,
    awaitingPayment: one("SELECT COUNT(*) n FROM orders WHERE status = 'new' AND payment_status = 'unpaid'").n,
    unreadMessages: one('SELECT COUNT(*) n FROM messages WHERE handled = 0').n,
    lowStock: db.prepare(`SELECT p.name, v.size, v.stock FROM variants v JOIN products p ON p.id = v.product_id
      WHERE p.active = 1 AND v.active = 1 AND v.stock <= 3 ORDER BY v.stock, p.name`).all(),
    topSellers: db.prepare(`SELECT oi.name, oi.size, SUM(oi.qty) qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'paid' AND o.status != 'cancelled' GROUP BY oi.name, oi.size ORDER BY qty DESC LIMIT 5`).all(),
    recent: db.prepare('SELECT id, code, name, total, status, payment_status, created_at FROM orders ORDER BY id DESC LIMIT 8').all(),
  });
});

app.get('/api/admin/orders', (req, res) => {
  const where = [], params = [];
  if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.q) { where.push('(code LIKE ? OR name LIKE ? OR email LIKE ? OR phone LIKE ?)'); params.push(...Array(4).fill(`%${req.query.q}%`)); }
  const sql = `SELECT o.*, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) items FROM orders o
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`;
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/admin/orders.csv', (_req, res) => {
  const rows = db.prepare(`SELECT o.code, datetime(o.created_at,'+8 hours') created_myt, o.name, o.email, o.phone, o.address1, o.address2,
    o.postcode, o.city, o.state, o.status, o.payment_method, o.payment_status, o.subtotal/100.0 subtotal, o.shipping/100.0 shipping,
    o.total/100.0 total, o.tracking, (SELECT GROUP_CONCAT(name || ' ' || size || ' x' || qty, '; ') FROM order_items WHERE order_id = o.id) items
    FROM orders o ORDER BY o.id`).all();
  const cols = rows[0] ? Object.keys(rows[0]) : ['code'];
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="nelmora-orders.csv"');
  res.send([cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
});

app.get('/api/admin/orders/:id', (req, res) => {
  const o = orderWithItems(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id));
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.json(o);
});

const STATUSES = ['new', 'processing', 'shipped', 'completed', 'cancelled'];
app.patch('/api/admin/orders/:id', send((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) throw fail(404, 'Not found');
  const next = {
    status: STATUSES.includes(req.body.status) ? req.body.status : o.status,
    payment_status: ['unpaid', 'paid', 'refunded'].includes(req.body.payment_status) ? req.body.payment_status : o.payment_status,
    tracking: req.body.tracking !== undefined ? clean(req.body.tracking, 120) : o.tracking,
    admin_note: req.body.admin_note !== undefined ? clean(req.body.admin_note, 1000) : o.admin_note,
  };
  db.transaction(() => {
    if (o.status !== 'cancelled' && next.status === 'cancelled') restock(o.id);
    if (o.status === 'cancelled' && next.status !== 'cancelled') unstock(o.id);
    db.prepare('UPDATE orders SET status=@status, payment_status=@payment_status, tracking=@tracking, admin_note=@admin_note WHERE id=@id')
      .run({ ...next, id: o.id });
  })();
  res.json(orderWithItems(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)));
}));

app.get('/api/admin/products', (_req, res) => res.json(productsWithVariants('1', [], '1')));

const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function saveProduct(id, b) {
  const p = {
    name: clean(b.name, 80), gender: ['Men', 'Women', 'Unisex'].includes(b.gender) ? b.gender : 'Unisex',
    family: clean(b.family, 60), tagline: clean(b.tagline, 160), description: clean(b.description, 2000),
    notes: clean(b.notes, 300), image: clean(b.image, 300), cutout: clean(b.cutout, 300),
    featured: b.featured ? 1 : 0, active: b.active === false ? 0 : 1, sort: Number.isFinite(+b.sort) ? Math.round(+b.sort) : 0,
  };
  if (p.name.length < 2) throw fail(400, 'Name is required.');
  p.slug = slugify(clean(b.slug, 80) || p.name);
  if (!p.slug) throw fail(400, 'Name is required.');
  const clash = db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').get(p.slug, id || 0);
  if (clash) throw fail(400, 'Another product already uses this name/link.');
  const variants = (Array.isArray(b.variants) ? b.variants : []).map((v) => ({
    id: v.id ? Number(v.id) : null, size: clean(v.size, 20), price: Math.round(Number(v.price)),
    stock: Math.max(0, Math.round(Number(v.stock) || 0)), active: v.active === false ? 0 : 1,
  }));
  for (const v of variants) {
    if (!v.size) throw fail(400, 'Each size needs a name, e.g. 30ml.');
    if (!(v.price > 0)) throw fail(400, `Price for ${v.size} must be more than 0.`);
  }
  if (new Set(variants.map((v) => v.size.toLowerCase())).size !== variants.length) throw fail(400, 'Each size can only appear once.');
  return db.transaction(() => {
    if (id) {
      db.prepare(`UPDATE products SET slug=@slug, name=@name, gender=@gender, family=@family, tagline=@tagline, description=@description,
        notes=@notes, image=@image, cutout=@cutout, featured=@featured, active=@active, sort=@sort WHERE id=@id`).run({ ...p, id });
    } else {
      id = db.prepare(`INSERT INTO products (slug, name, gender, family, tagline, description, notes, image, cutout, featured, active, sort)
        VALUES (@slug, @name, @gender, @family, @tagline, @description, @notes, @image, @cutout, @featured, @active, @sort)`).run(p).lastInsertRowid;
    }
    const keep = [];
    for (const v of variants) {
      const existing = v.id && db.prepare('SELECT id FROM variants WHERE id = ? AND product_id = ?').get(v.id, id);
      if (existing) {
        db.prepare('UPDATE variants SET size=?, price=?, stock=?, active=? WHERE id=?').run(v.size, v.price, v.stock, v.active, v.id);
        keep.push(v.id);
      } else {
        keep.push(db.prepare('INSERT INTO variants (product_id, size, price, stock, active) VALUES (?, ?, ?, ?, ?)')
          .run(id, v.size, v.price, v.stock, v.active).lastInsertRowid);
      }
    }
    // sizes removed in the form are hidden, not deleted, so old orders keep their link
    const placeholders = keep.map(() => '?').join(',') || 'NULL';
    db.prepare(`UPDATE variants SET active = 0 WHERE product_id = ? AND id NOT IN (${placeholders})`).run(id, ...keep);
    return productsWithVariants('p.id = ?', [id], '1')[0];
  })();
}
app.post('/api/admin/products', send((req, res) => res.json(saveProduct(null, req.body))));
app.put('/api/admin/products/:id', send((req, res) => {
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(req.params.id)) throw fail(404, 'Not found');
  res.json(saveProduct(Number(req.params.id), req.body));
}));

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
app.post('/api/admin/upload', express.raw({ type: Object.keys(IMAGE_TYPES), limit: '8mb' }), (req, res) => {
  const ext = IMAGE_TYPES[req.headers['content-type']];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP image.' });
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, name), req.body);
  res.json({ url: `/uploads/${name}` });
});

app.get('/api/admin/settings', (_req, res) => res.json(getSettings()));
app.put('/api/admin/settings', send((req, res) => {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
      if (!(k in req.body)) continue;
      let v = req.body[k];
      if (typeof def === 'number') { v = Math.round(Number(v)); if (!Number.isFinite(v) || v < 0) throw fail(400, `Invalid value for ${k}`); }
      else v = clean(v, 300);
      if (k === 'whatsapp') v = v.replace(/\D/g, '');
      up.run(k, JSON.stringify(v));
    }
  })();
  res.json(getSettings());
}));

app.get('/api/admin/subscribers', (_req, res) => res.json(db.prepare('SELECT * FROM subscribers ORDER BY id DESC').all()));
app.delete('/api/admin/subscribers/:id', (req, res) => {
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/messages',(_req, res) => res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 300').all()));
app.patch('/api/admin/messages/:id', (req, res) => {
  db.prepare('UPDATE messages SET handled = ? WHERE id = ?').run(req.body.handled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/backup', send(async (_req, res) => {
  const file = path.join(path.dirname(dbPath), `backup-${Date.now()}.db`);
  await db.backup(file);
  res.download(file, `nelmora-shop-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(file, () => {}));
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------------------------------------------------------------- website
app.use('/uploads', express.static(uploadsDir, { maxAge: '30d' }));
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Website not built yet. Run <code>npm run build</code>, or use <code>npm run dev</code> and open http://localhost:5174'));
}

if (require.main === module) {
  expireUnpaid();
  app.listen(PORT, HOST, () => {
    console.log(`Nelmora shop running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(ADMIN_PASSWORD ? 'Admin: /admin' : 'Admin is locked: set ADMIN_PASSWORD in .env to use /admin');
    console.log(stripe.enabled ? 'Stripe online payment: ON' : 'Stripe online payment: off (bank transfer only)');
  });
}

module.exports = { app, regionOf };
