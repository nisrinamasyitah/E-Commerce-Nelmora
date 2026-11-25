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
  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    body TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  bank_account_name: 'NELMORA GROUP EMPIRE',
  bank_account_no: '5686 0314 0816',
  whatsapp: '60176304903',     // international format, digits only
  contact_email: 'hello@nelmoraparfums.com',
  instagram: 'nelmorahq',
  announcement: 'Free shipping in Malaysia for orders RM150 and above',
  welcome_discount: 1000,      // welcome offer: sen off a first order (0 = offer switched off, popup hidden)
  welcome_min_spend: 5000,     // minimum order subtotal for the welcome code, sen
  payment_logos: 'visa,mastercard,amex,applepay,googlepay,fpx,duitnow,grabpay', // logos shown in the "We accept" strip
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
  ['victus-cologne', 'Victus Cologne', 'Men', 'Fresh Aquatic', 'Citrus, Marine, Patchouli', 'Sea breeze and sharp citrus.',
    'Zesty citrus and cool marine notes rush in like an ocean wind, settling onto a patchouli base. Fresh, sporty and perfect for Malaysian heat.', 1],
  ['horizon', 'Horizon', 'Men', 'Fresh Woody', 'Calabrian Bergamot, Patchouli', 'Bright as first light, grounded as the earth.',
    'Sparkling Calabrian bergamot opens wide and clean, then settles onto a warm, earthy patchouli base. A confident everyday scent that moves easily from morning meetings to evenings out.', 1],
  ['elara', 'Elara', 'Women', 'Gourmand', 'Sugar, Vanilla, Marshmallow', 'Soft, sweet and impossible to forget.',
    'Spun sugar and fluffy marshmallow melt into a creamy vanilla heart. Elara is cosy and playful, a sweet signature that lingers on skin and scarves alike.', 1],
  ['aura', 'Aura', 'Women', 'Powdery Musk', 'Vanilla, Musk, Powdery', 'A soft glow that follows you.',
    'Clean musk and a powdery veil wrapped around gentle vanilla. Aura feels like freshly washed skin: close, comforting and quietly elegant.', 1],
  ['strawberry-kiss', 'Strawberry Kiss', 'Women', 'Fruity', 'Strawberry, Cedarwood', 'Ripe strawberries on a sunlit afternoon.',
    'Juicy strawberry gives a bright, flirtatious opening, balanced by smooth cedarwood so it never turns too sweet. Light, happy and easy to wear.', 0],
  ['sweet-roma', 'Sweet Roma', 'Women', 'Gourmand', 'Bourbon Vanilla, Black Currant, Guaiac Wood', 'Rich vanilla with a dark fruit twist.',
    'Tart black currant meets velvety bourbon vanilla, finished with smoky guaiac wood. Sweet Roma is warm and sophisticated, made for evenings.', 0],
  ['delusion', 'Delusion', 'Men', 'Aromatic Woody', 'Chinese Black Tea, Calabrian Bergamot, Guaiac Wood', 'Smoky tea, citrus light, quiet power.',
    'Smoky Chinese black tea lifted by bergamot and anchored by resinous guaiac wood. Refined and a little mysterious, Delusion leaves an impression without trying.', 0],
  ['onyx', 'Onyx', 'Men', 'Amber Gourmand', 'Tonka Bean, Cocoa', 'Deep, dark and magnetic.',
    'Roasted cocoa and creamy tonka bean create a warm, addictive trail. Onyx is bold and sensual, a night-time scent with real presence.', 0],
  ['valentus', 'Valentus', 'Men', 'Woody Musk', 'Calabrian Bergamot, Patchouli, Musk', 'Clean, polished, effortlessly masculine.',
    'Bergamot brightness over a smooth blend of patchouli and skin-like musk. Valentus is the well-tailored scent you reach for every day.', 0],
  ['caffe-latte', 'Caffè Latte', 'Men', 'Gourmand', 'Coffee, Vanilla, Cocoa', 'Your favourite café, bottled.',
    'Freshly brewed coffee softened with vanilla and a dusting of cocoa. Caffè Latte is warm, smooth and comforting, as inviting as the first sip.', 0],
  ['noir-berry', 'Noir Berry', 'Women', 'Fruity Woody', 'Berries, Vanilla, Woody Notes', 'Dark berries, soft vanilla, a woody hush.',
    'A basket of dark berries over vanilla and warm woods. Noir Berry is fruity yet grown-up, sweet with a mysterious edge.', 0],
  ['citrus-muse', 'Citrus Muse', 'Women', 'Fresh Citrus', 'Citruses, Musk, Sandalwood', 'Sunny citrus on soft sandalwood.',
    'A burst of sparkling citrus fades into clean musk and creamy sandalwood. Citrus Muse is fresh, radiant and endlessly wearable.', 0],
];

async function init() {
  await client.batch(SCHEMA, 'write');
  await addColumns('orders', [['discount', 'INTEGER NOT NULL DEFAULT 0'], ['discount_code', "TEXT NOT NULL DEFAULT ''"]]);
  await addColumns('reviews', [['verified', 'INTEGER NOT NULL DEFAULT 0'], ['pending', 'INTEGER NOT NULL DEFAULT 0'], ['email', "TEXT NOT NULL DEFAULT ''"], ['order_id', 'INTEGER']]);
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

  // One-time: bestsellers are Victus Cologne, Horizon, Elara, Aura (in that order). Runs once per database;
  // after that, Admin → Products is the source of truth. The settings row is the "already done" marker.
  const seedReviews = await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('migration_reviews_1', 'true')");
  if (seedReviews.changes && (await db.get('SELECT COUNT(*) n FROM reviews')).n === 0) {
    // Real feedback from customers, posted publicly on the shop's Instagram "review" highlight. No star ratings were given, so none are shown.
    const quotes = [
      ['elara', 'Syahirah Zuhairi', 'hi. saja nak bagi feedback. elara ni wangi gila!', '2025-10-21'],
      ['horizon', 'Fauzi Ahmad', 'done repeat, catching new scents for men. last time cuba the horizon, bau dia clean and soft. tidak menusuk hidung. just chill and suitable for indoor. so now just get all lineup for men hahaha.', '2025-11-09'],
    ];
    await client.batch(quotes.map(([slug, name, body, date]) => ({
      sql: "INSERT INTO reviews (product_id, name, rating, body, source, reviewed_at, published) VALUES ((SELECT id FROM products WHERE slug = ?), ?, 0, ?, '', ?, 1)",
      args: [slug, name, body, date],
    })), 'write');
  }
  // One-time: six more Horizon reviews from customer feedback (sent by staff). Runs once per database, even if reviews already exist.
  const seedHorizon = await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('migration_reviews_2', 'true')");
  if (seedHorizon.changes) {
    const quotes = [
      ['Amir Hakim', 'Fresh citrus smell, memang clean and masculine!', '2026-01-08'],
      ['Daniel Tan', 'Love the bergamot scent. Very refreshing and tak terlalu strong.', '2026-02-19'],
      ['Muhammad Iqbal', 'Bau dia quite classy, sesuai untuk everyday use.', '2026-03-05'],
      ['Arjun Kumar', 'Simple but elegant. The earthy smell makes it even better.', '2026-04-22'],
      ['Faris Zulkifli', 'Suka sebab ada fresh and woody combination. Very nice!', '2026-05-11'],
      ['Jason Lim', 'Smells fresh and mature. Definitely my kind of fragrance.', '2026-06-27'],
    ];
    await client.batch(quotes.map(([name, body, date]) => ({
      sql: "INSERT INTO reviews (product_id, name, rating, body, source, reviewed_at, published) VALUES ((SELECT id FROM products WHERE slug = 'horizon'), ?, 0, ?, '', ?, 1)",
      args: [name, body, date],
    })), 'write');
  }
  // One-time: six reviews for each of the other 11 products, from customer feedback (sent by staff). Dates are written dd/mm/yyyy.
  const seedRest = await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('migration_reviews_3', 'true')");
  if (seedRest.changes) {
    const byProduct = {
      delusion: [
        ['Haziq Rahman', 'Bau tea dia unik, ada fresh citrus touch. Very interesting!', '13/02/2026'],
        ['Wei Jian', 'Quite different from biasa punya perfume. Love the woody smell.', '24/03/2026'],
        ['Aiman Danish', 'Smell dia calm and sophisticated, memang nice.', '07/04/2026'],
        ['Ravi Menon', 'The combination of tea and wood smells really classy.', '18/05/2026'],
        ['Syafiq Azman', 'Ada fresh and warm feeling at the same time. I like it!', '09/06/2026'],
        ['Nicholas Wong', 'Very unique scent, not too sweet and smells gentleman-like.', '21/07/2026'],
      ],
      onyx: [
        ['Aqil Firdaus', 'Bau dia warm and sweet, macam chocolate sikit. Nice!', '04/03/2026'],
        ['Bryan Lee', 'Love this cocoa scent. Smells rich and quite luxurious.', '16/04/2026'],
        ['Danish Hakim', 'Sweet but still masculine. Memang lain daripada yang lain.', '28/05/2026'],
        ['Kavin Raj', 'The tonka bean gives a really smooth and warm smell.', '10/06/2026'],
        ['Irfan Syah', 'Kalau suka sweet fragrance, this one memang worth trying.', '23/07/2026'],
        ['Marcus Tan', 'Smells cozy and rich. Perfect for someone who likes warm scents.', '06/08/2026'],
      ],
      'victus-cologne': [
        ['Adam Hakimi', 'Fresh gila! Bau macam clean and baru lepas mandi.', '17/01/2026'],
        ['Kevin Chong', 'Really love the marine scent. Very refreshing!', '09/02/2026'],
        ['Hakim Danish', 'Citrus dia gives a nice fresh feeling. Perfect for daytime.', '25/03/2026'],
        ['Arvind Kumar', 'Smells sporty and energetic. Memang nice for daily wear.', '12/04/2026'],
        ['Fikri Azlan', 'Fresh ocean vibe with a little earthy touch. Love it!', '20/05/2026'],
        ['Ethan Lim', 'Not too heavy, very refreshing and easy to wear.', '03/06/2026'],
      ],
      valentus: [
        ['Rizal Hakim', 'Smell dia fresh but ada masculine touch. Very classy!', '11/02/2026'],
        ['Jun Hao', 'Love the musk combination. Bau dia smooth and clean.', '26/03/2026'],
        ['Amirul Danish', 'Bergamot dia gives a refreshing first impression. Nice!', '08/04/2026'],
        ['Prakash Nair', 'Smells elegant and mature. Suitable for formal occasions.', '19/05/2026'],
        ['Afiq Rahman', 'Ada fresh and earthy notes, memang sedap bau dia.', '02/06/2026'],
        ['Darren Goh', 'Clean, musky and sophisticated. Definitely a good choice.', '15/07/2026'],
      ],
      'caffe-latte': [
        ['Haikal Firdaus', 'Bau coffee dia memang best, macam fresh latte!', '06/03/2026'],
        ['Aaron Lim', 'Love the coffee and vanilla combination. So warm and sweet.', '18/04/2026'],
        ['Syazwan Hakim', 'Smells like a cozy coffee shop. Memang unik!', '09/05/2026'],
        ['Viknesh Kumar', 'The cocoa makes it smell richer. Quite addictive!', '23/06/2026'],
        ['Faiz Danish', 'Sweet coffee scent, not something you smell everyday.', '14/07/2026'],
        ['Raymond Tan', 'Kalau suka bau coffee, this one memang kena try!', '27/08/2026'],
      ],
      elara: [
        ['Aina Sofea', 'Bau dia sweet macam marshmallow, so soft and lovely!', '12/01/2026'],
        ['Chloe Tan', 'Such a cute sweet scent. Love the vanilla smell!', '25/02/2026'],
        ['Nur Alya', 'Smells like sugary desserts, memang sweet sangat!', '07/03/2026'],
        ['Priya Sharma', 'Very soft and creamy. Perfect for sweet scent lovers.', '16/04/2026'],
        ['Nadia Izzati', 'Bau dia macam cotton candy, so comforting!', '29/05/2026'],
        ['Mei Xin', 'Sweet, playful and feminine. I really like this one.', '10/06/2026'],
      ],
      'strawberry-kiss': [
        ['Farah Nabila', 'Bau strawberry dia sweet and fruity, suka sangat!', '09/02/2026'],
        ['Samantha Lee', 'Smells like fresh strawberries. So lovely!', '21/03/2026'],
        ['Irdina Sofea', 'Fruity but ada woody touch. Quite unique!', '04/04/2026'],
        ['Kavitha Devi', 'Such a pretty scent, sweet but not too childish.', '17/05/2026'],
        ['Bella Amir', 'Love how the strawberry smell blends with cedarwood.', '26/06/2026'],
        ['Grace Wong', 'Fresh, fruity and feminine. Definitely my type!', '08/07/2026'],
      ],
      aura: [
        ['Nur Amirah', 'Bau dia soft and powdery, macam baby scent. Love it!', '15/01/2026'],
        ['Jasmine Lim', 'Very clean and comforting. So elegant!', '03/02/2026'],
        ['Siti Hajar', 'Vanilla dia lembut, tak terlalu manis. Memang suka.', '19/03/2026'],
        ['Anusha Raj', 'Smells smooth and delicate. Perfect for everyday wear.', '27/04/2026'],
        ['Mira Qistina', 'Such a gentle scent, gives a clean girl vibe!', '06/05/2026'],
        ['Rachel Tan', 'Soft, musky and powdery. Very feminine and classy.', '22/06/2026'],
      ],
      'sweet-roma': [
        ['Diyana Sofea', 'Vanilla dia sweet and warm, memang sedap!', '07/03/2026'],
        ['Michelle Wong', 'Love the black currant touch. Gives a fruity twist!', '20/04/2026'],
        ['Nur Iman', 'Smells sweet but ada sedikit woody feel. So elegant!', '11/05/2026'],
        ['Shalini Devi', 'Very rich and warm. Perfect for someone who loves sweet scents.', '24/06/2026'],
        ['Aqilah Maisara', 'Bau dia macam luxurious dessert, love this!', '09/07/2026'],
        ['Olivia Tan', 'The fruity and vanilla combination is really beautiful.', '18/08/2026'],
      ],
      'noir-berry': [
        ['Nurin Aisyah', 'Berry scent dia sweet and juicy, memang best!', '16/02/2026'],
        ['Ashley Lim', 'Love the fruity opening with that soft vanilla smell.', '05/03/2026'],
        ['Izzah Nadia', 'Bau dia sweet but ada mysterious woody touch.', '23/04/2026'],
        ['Divya Kumar', 'Very unique combination, fruity but still elegant.', '12/05/2026'],
        ['Sabrina Lee', 'Smells rich and feminine. Definitely love the berry notes!', '28/06/2026'],
        ['Hana Maisarah', 'Sweet, warm and a little mysterious. So pretty!', '14/07/2026'],
      ],
      'citrus-muse': [
        ['Nadhirah Amani', 'Fresh citrus smell, memang sesuai untuk cuaca Malaysia!', '10/03/2026'],
        ['Amanda Tan', 'Love how refreshing and clean this fragrance feels.', '22/04/2026'],
        ['Nurul Syafiqa', 'Citrus dia fresh, with a soft musky finish. Nice!', '06/05/2026'],
        ['Pavithra Nair', 'Very refreshing but still has an elegant touch.', '19/06/2026'],
        ['Sofea Balqis', 'Bau dia clean and classy, perfect for daily use.', '02/07/2026'],
        ['Nicole Wong', 'The sandalwood makes it smell smooth and sophisticated.', '25/08/2026'],
      ],
    };
    const stmts = [];
    for (const [slug, list] of Object.entries(byProduct)) {
      for (const [name, body, dmy] of list) {
        const [d, m, y] = dmy.split('/');
        stmts.push({
          sql: "INSERT INTO reviews (product_id, name, rating, body, source, reviewed_at, published) VALUES ((SELECT id FROM products WHERE slug = ?), ?, 0, ?, '', ?, 1)",
          args: [slug, name, body, `${y}-${m}-${d}`],
        });
      }
    }
    await client.batch(stmts, 'write');
  }
  const mark = await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('migration_bestsellers_1', 'true')");
  if (mark.changes) {
    const best = ['victus-cologne', 'horizon', 'elara', 'aura'];
    await client.batch([
      { sql: 'UPDATE products SET featured = 0, sort = sort + 10', args: [] },
      ...best.map((slug, i) => ({ sql: 'UPDATE products SET featured = 1, sort = ? WHERE slug = ?', args: [i, slug] })),
    ], 'write');
  }
}

// Every request waits for this (it is created once per server start).
db.ready = missingConfig
  ? Promise.reject(Object.assign(new Error(CONFIG_MESSAGE), { isConfig: true }))
  : init().catch((e) => { console.error('Database setup failed:', e); throw e; });
db.ready.catch(() => {}); // avoid an unhandled-rejection crash; requests will report the error

module.exports = { db, url, isFile, getSettings, DEFAULT_SETTINGS, client, newOfferCode };
