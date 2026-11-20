// Database layer (libSQL = SQLite-compatible).
//  - On Netlify: online Turso database (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN).
//  - On your computer: a local file, data/shop.db (no setup).
// All money is stored in sen (RM 1.00 = 100) as integers, so totals never drift.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const url = process.env.TURSO_DATABASE_URL || process.env.DB_URL || `file:${path.join(dataDir, 'shop.db')}`;
const isFile = url.startsWith('file:') || url === ':memory:';

// Online (Netlify = AWS Lambda) there is no disk, so a database URL is required.
const online = !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
const missingConfig = online && !process.env.TURSO_DATABASE_URL && !process.env.DB_URL;
const CONFIG_MESSAGE = 'The shop database is not set up yet. In Netlify add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN under Site configuration → Environment variables, then redeploy.';

function makeClient() {
  if (isFile) {
    if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
    // Loaded through a variable so Netlify's bundler skips the native module (never used online).
    const mod = '@libsql/client';
    return require(mod).createClient({ url });
  }
  // HTTP-only build: works inside serverless functions.
  const { createClient } = require('@libsql/client/web');
  return createClient({ url: url.replace(/^libsql:/, 'https:'), authToken: process.env.TURSO_AUTH_TOKEN || undefined });
}
const client = missingConfig ? null : makeClient();

const toRows = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

function runner(r) {
  return {
    async all(sql, args = []) { return toRows(await r.execute({ sql, args })); },
    async get(sql, args = []) { return (await this.all(sql, args))[0]; },
    async run(sql, args = []) {
      const rs = await r.execute({ sql, args });
      return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
    },
  };
}
const db = runner(client);

/** Run fn inside a transaction. fn gets a runner with the same all/get/run API. Rolls back on any error. */
db.tx = async (fn) => {
  const t = await client.transaction('write');
  try {
    const out = await fn(runner(t));
    await t.commit();
    return out;
  } catch (e) {
    try { await t.rollback(); } catch { /* already closed */ }
    throw e;
  } finally { t.close(); }
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT 'Unisex',
    family TEXT NOT NULL DEFAULT '',
    tagline TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    cutout TEXT NOT NULL DEFAULT '',
    featured INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    size TEXT NOT NULL,
    price INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(product_id, size)
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address1 TEXT NOT NULL,
    address2 TEXT NOT NULL DEFAULT '',
    postcode TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    region TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    subtotal INTEGER NOT NULL,
    shipping INTEGER NOT NULL,
    total INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    status TEXT NOT NULL DEFAULT 'new',
    tracking TEXT NOT NULL DEFAULT '',
    stripe_session TEXT NOT NULL DEFAULT '',
    admin_note TEXT NOT NULL DEFAULT '',
    discount INTEGER NOT NULL DEFAULT 0,
    discount_code TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    variant_id INTEGER REFERENCES variants(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    size TEXT NOT NULL,
    price INTEGER NOT NULL,
    qty INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    handled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    birthday TEXT NOT NULL DEFAULT '',   -- MM-DD
    gender TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    code TEXT,                           -- personal welcome code
    used_order INTEGER                   -- order that used the code (NULL = still available)
  )`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // rate limiting must survive across serverless instances, so it lives in the database
  `CREATE TABLE IF NOT EXISTS throttle (key TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS throttle_key ON throttle(key, ts)`,
  `CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id)`,
  `CREATE INDEX IF NOT EXISTS orders_status ON orders(status, payment_status)`,
];

const DEFAULT_SETTINGS = {
  shipping_west: 800,          // Peninsular Malaysia, sen
  shipping_east: 1500,         // Sabah, Sarawak, Labuan, sen
  free_shipping_min: 15000,    // free shipping at RM150 and above, sen (0 = never free)
  bank_name: 'Maybank',
  bank_account_name: 'NELMORA PARFUMS',
  bank_account_no: '0000 0000 0000',
  whatsapp: '60176304903',     // international format, digits only
  contact_email: 'hello@nelmoraparfums.com',
  instagram: 'nelmoraparfums',
  announcement: 'Free shipping in Malaysia for orders RM150 and above',
  welcome_discount: 1000,      // welcome offer: sen off a first order (0 = offer switched off, popup hidden)
  welcome_min_spend: 5000,     // minimum order subtotal for the welcome code, sen
};

const newOfferCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'WELCOME-' + Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
};

// Databases created before a column existed get it added here (safe to run every start).
async function addColumns(table, cols) {
  const have = new Set((await db.all(`PRAGMA table_info(${table})`)).map((c) => c.name));
  for (const [name, def] of cols) {
    if (have.has(name)) continue;
    try { await db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`); } catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
  }
}

async function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of await db.all('SELECT key, value FROM settings')) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* keep default */ }
  }
  return out;
}

// ---------------------------------------------------------------- first-run catalogue
// The real Nelmora scents, 10ml RM25 and 30ml RM65.
// Descriptions are starter copy: edit them any time in Admin → Products.
const CATALOGUE = [
  ['horizon', 'Horizon', 'Men', 'Fresh Woody', 'Calabrian Bergamot, Patchouli', 'Bright as first light, grounded as the earth.',
    'Sparkling Calabrian bergamot opens wide and clean, then settles onto a warm, earthy patchouli base. A confident everyday scent that moves easily from morning meetings to evenings out.', 1],
  ['elara', 'Elara', 'Women', 'Gourmand', 'Sugar, Vanilla, Marshmallow', 'Soft, sweet and impossible to forget.',
    'Spun sugar and fluffy marshmallow melt into a creamy vanilla heart. Elara is cosy and playful, a sweet signature that lingers on skin and scarves alike.', 1],
  ['strawberry-kiss', 'Strawberry Kiss', 'Women', 'Fruity', 'Strawberry, Cedarwood', 'Ripe strawberries on a sunlit afternoon.',
    'Juicy strawberry gives a bright, flirtatious opening, balanced by smooth cedarwood so it never turns too sweet. Light, happy and easy to wear.', 0],
  ['aura', 'Aura', 'Women', 'Powdery Musk', 'Vanilla, Musk, Powdery', 'A soft glow that follows you.',
    'Clean musk and a powdery veil wrapped around gentle vanilla. Aura feels like freshly washed skin: close, comforting and quietly elegant.', 1],
  ['sweet-roma', 'Sweet Roma', 'Women', 'Gourmand', 'Bourbon Vanilla, Black Currant, Guaiac Wood', 'Rich vanilla with a dark fruit twist.',
    'Tart black currant meets velvety bourbon vanilla, finished with smoky guaiac wood. Sweet Roma is warm and sophisticated, made for evenings.', 0],
  ['delusion', 'Delusion', 'Men', 'Aromatic Woody', 'Chinese Black Tea, Calabrian Bergamot, Guaiac Wood', 'Smoky tea, citrus light, quiet power.',
    'Smoky Chinese black tea lifted by bergamot and anchored by resinous guaiac wood. Refined and a little mysterious, Delusion leaves an impression without trying.', 1],
  ['onyx', 'Onyx', 'Men', 'Amber Gourmand', 'Tonka Bean, Cocoa', 'Deep, dark and magnetic.',
    'Roasted cocoa and creamy tonka bean create a warm, addictive trail. Onyx is bold and sensual, a night-time scent with real presence.', 0],
  ['victus-cologne', 'Victus Cologne', 'Men', 'Fresh Aquatic', 'Citrus, Marine, Patchouli', 'Sea breeze and sharp citrus.',
    'Zesty citrus and cool marine notes rush in like an ocean wind, settling onto a patchouli base. Fresh, sporty and perfect for Malaysian heat.', 0],
  ['valentus', 'Valentus', 'Men', 'Woody Musk', 'Calabrian Bergamot, Patchouli, Musk', 'Clean, polished, effortlessly masculine.',
    'Bergamot brightness over a smooth blend of patchouli and skin-like musk. Valentus is the well-tailored scent you reach for every day.', 0],
  ['caffe-latte', 'Caffè Latte', 'Men', 'Gourmand', 'Coffee, Vanilla, Cocoa', 'Your favourite café, bottled.',
    'Freshly brewed coffee softened with vanilla and a dusting of cocoa. Caffè Latte is warm, smooth and comforting, as inviting as the first sip.', 1],
  ['noir-berry', 'Noir Berry', 'Women', 'Fruity Woody', 'Berries, Vanilla, Woody Notes', 'Dark berries, soft vanilla, a woody hush.',
    'A basket of dark berries over vanilla and warm woods. Noir Berry is fruity yet grown-up, sweet with a mysterious edge.', 0],
  ['citrus-muse', 'Citrus Muse', 'Women', 'Fresh Citrus', 'Citruses, Musk, Sandalwood', 'Sunny citrus on soft sandalwood.',
    'A burst of sparkling citrus fades into clean musk and creamy sandalwood. Citrus Muse is fresh, radiant and endlessly wearable.', 0],
];

async function init() {
  await client.batch(SCHEMA, 'write');
  await addColumns('orders', [['discount', 'INTEGER NOT NULL DEFAULT 0'], ['discount_code', "TEXT NOT NULL DEFAULT ''"]]);
  await addColumns('subscribers', [['name', "TEXT NOT NULL DEFAULT ''"], ['phone', "TEXT NOT NULL DEFAULT ''"], ['birthday', "TEXT NOT NULL DEFAULT ''"],
    ['gender', "TEXT NOT NULL DEFAULT ''"], ['source', "TEXT NOT NULL DEFAULT ''"], ['code', 'TEXT'], ['used_order', 'INTEGER']]);
  await db.run('CREATE UNIQUE INDEX IF NOT EXISTS subscribers_code ON subscribers(code)');
  for (const s of await db.all("SELECT id FROM subscribers WHERE code IS NULL OR code = ''")) {
    await db.run('UPDATE subscribers SET code = ? WHERE id = ?', [newOfferCode(), s.id]);
  }
  await client.batch(
    Object.entries(DEFAULT_SETTINGS).map(([k, v]) => ({ sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: [k, JSON.stringify(v)] })),
    'write',
  );
  if ((await db.get('SELECT COUNT(*) n FROM products')).n === 0) {
    const stmts = [];
    CATALOGUE.forEach(([slug, name, gender, family, notes, tagline, description, featured], i) => {
      stmts.push({
        sql: `INSERT OR IGNORE INTO products (slug, name, gender, family, notes, tagline, description, image, cutout, featured, sort)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [slug, name, gender, family, notes, tagline, description, `/images/products/${slug}.jpg`, `/images/products/${slug}-bottle.png`, featured, i],
      });
      for (const [size, price] of [['10ml', 2500], ['30ml', 6500]]) {
        stmts.push({
          sql: 'INSERT OR IGNORE INTO variants (product_id, size, price, stock) VALUES ((SELECT id FROM products WHERE slug = ?), ?, ?, 10)',
          args: [slug, size, price],
        });
      }
    });
    await client.batch(stmts, 'write');
  }
}

// Every request waits for this (it is created once per server start).
db.ready = missingConfig
  ? Promise.reject(Object.assign(new Error(CONFIG_MESSAGE), { isConfig: true }))
  : init().catch((e) => { console.error('Database setup failed:', e); throw e; });
db.ready.catch(() => {}); // avoid an unhandled-rejection crash; requests will report the error

module.exports = { db, url, isFile, getSettings, DEFAULT_SETTINGS, client, newOfferCode };
