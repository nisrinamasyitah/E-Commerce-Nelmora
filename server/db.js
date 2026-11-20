const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.DB_FILE || path.join(dataDir, 'shop.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// All money is stored in sen (RM 1.00 = 100) as integers, so totals never drift.
db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'Unisex',      -- Men | Women | Unisex
  family TEXT NOT NULL DEFAULT '',            -- Fresh, Gourmand, Fruity...
  tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',             -- comma separated key notes
  image TEXT NOT NULL DEFAULT '',             -- lifestyle photo
  cutout TEXT NOT NULL DEFAULT '',            -- transparent bottle image
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL,                         -- '10ml' | '30ml'
  price INTEGER NOT NULL,                     -- sen
  stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(product_id, size)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,                        -- secret for the customer's order link
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address1 TEXT NOT NULL,
  address2 TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  region TEXT NOT NULL,                       -- west | east
  note TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL,               -- transfer | stripe
  payment_status TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | paid | refunded
  status TEXT NOT NULL DEFAULT 'new',         -- new | processing | shipped | completed | cancelled
  tracking TEXT NOT NULL DEFAULT '',
  stripe_session TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES variants(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  size TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  handled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const DEFAULT_SETTINGS = {
  shipping_west: 800,          // Peninsular Malaysia, sen
  shipping_east: 1500,         // Sabah, Sarawak, Labuan, sen
  free_shipping_min: 15000,    // free shipping at RM150 and above, sen (0 = never free)
  bank_name: 'Maybank',
  bank_account_name: 'NELMORA PARFUMS',
  bank_account_no: '0000 0000 0000',
  whatsapp: '60123456789',     // international format, digits only
  contact_email: 'hello@nelmoraparfums.com',
  instagram: 'nelmoraparfums',
  announcement: 'Free shipping in Malaysia for orders RM150 and above',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, JSON.stringify(v));

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* keep default */ }
  }
  return out;
}

// ---------------------------------------------------------------- first-run catalogue
// The real Nelmora scents (from the portal), 10ml RM25 and 30ml RM65.
// Descriptions are starter copy: edit them any time in Admin → Products.
const CATALOGUE = [
  ['horizon', 'Horizon', 'Men', 'Fresh Woody', 'Calabrian Bergamot, Patchouli', 'Bright as first light, grounded as the earth.',
    'Sparkling Calabrian bergamot opens wide and clean, then settles onto a warm, earthy patchouli base. A confident everyday scent that moves easily from morning meetings to evenings out.', 'Horizon', 1],
  ['elara', 'Elara', 'Women', 'Gourmand', 'Sugar, Vanilla, Marshmallow', 'Soft, sweet and impossible to forget.',
    'Spun sugar and fluffy marshmallow melt into a creamy vanilla heart. Elara is cosy and playful, a sweet signature that lingers on skin and scarves alike.', 'Elara', 1],
  ['strawberry-kiss', 'Strawberry Kiss', 'Women', 'Fruity', 'Strawberry, Cedarwood', 'Ripe strawberries on a sunlit afternoon.',
    'Juicy strawberry gives a bright, flirtatious opening, balanced by smooth cedarwood so it never turns too sweet. Light, happy and easy to wear.', 'SK', 0],
  ['aura', 'Aura', 'Women', 'Powdery Musk', 'Vanilla, Musk, Powdery', 'A soft glow that follows you.',
    'Clean musk and a powdery veil wrapped around gentle vanilla. Aura feels like freshly washed skin: close, comforting and quietly elegant.', 'AURA', 1],
  ['sweet-roma', 'Sweet Roma', 'Women', 'Gourmand', 'Bourbon Vanilla, Black Currant, Guaiac Wood', 'Rich vanilla with a dark fruit twist.',
    'Tart black currant meets velvety bourbon vanilla, finished with smoky guaiac wood. Sweet Roma is warm and sophisticated, made for evenings.', 'SR', 0],
  ['delusion', 'Delusion', 'Men', 'Aromatic Woody', 'Chinese Black Tea, Calabrian Bergamot, Guaiac Wood', 'Smoky tea, citrus light, quiet power.',
    'Smoky Chinese black tea lifted by bergamot and anchored by resinous guaiac wood. Refined and a little mysterious, Delusion leaves an impression without trying.', 'Delusion', 1],
  ['onyx', 'Onyx', 'Men', 'Amber Gourmand', 'Tonka Bean, Cocoa', 'Deep, dark and magnetic.',
    'Roasted cocoa and creamy tonka bean create a warm, addictive trail. Onyx is bold and sensual, a night-time scent with real presence.', 'ONYX', 0],
  ['victus-cologne', 'Victus Cologne', 'Men', 'Fresh Aquatic', 'Citrus, Marine, Patchouli', 'Sea breeze and sharp citrus.',
    'Zesty citrus and cool marine notes rush in like an ocean wind, settling onto a patchouli base. Fresh, sporty and perfect for Malaysian heat.', 'VC', 0],
  ['valentus', 'Valentus', 'Men', 'Woody Musk', 'Calabrian Bergamot, Patchouli, Musk', 'Clean, polished, effortlessly masculine.',
    'Bergamot brightness over a smooth blend of patchouli and skin-like musk. Valentus is the well-tailored scent you reach for every day.', 'Valentus', 0],
  ['caffe-latte', 'Caffè Latte', 'Men', 'Gourmand', 'Coffee, Vanilla, Cocoa', 'Your favourite café, bottled.',
    'Freshly brewed coffee softened with vanilla and a dusting of cocoa. Caffè Latte is warm, smooth and comforting, as inviting as the first sip.', 'CF', 1],
  ['noir-berry', 'Noir Berry', 'Women', 'Fruity Woody', 'Berries, Vanilla, Woody Notes', 'Dark berries, soft vanilla, a woody hush.',
    'A basket of dark berries over vanilla and warm woods. Noir Berry is fruity yet grown-up, sweet with a mysterious edge.', 'NB', 0],
  ['citrus-muse', 'Citrus Muse', 'Women', 'Fresh Citrus', 'Citruses, Musk, Sandalwood', 'Sunny citrus on soft sandalwood.',
    'A burst of sparkling citrus fades into clean musk and creamy sandalwood. Citrus Muse is fresh, radiant and endlessly wearable.', 'CM', 0],
];

if (db.prepare('SELECT COUNT(*) n FROM products').get().n === 0) {
  const insP = db.prepare(`INSERT INTO products (slug, name, gender, family, notes, tagline, description, image, cutout, featured, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insV = db.prepare('INSERT INTO variants (product_id, size, price, stock) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    CATALOGUE.forEach(([slug, name, gender, family, notes, tagline, description, , featured], i) => {
      const { lastInsertRowid: id } = insP.run(slug, name, gender, family, notes, tagline, description,
        `/images/products/${slug}.jpg`, `/images/products/${slug}-bottle.png`, featured, i);
      insV.run(id, '10ml', 2500, 10);
      insV.run(id, '30ml', 6500, 10);
    });
  })();
}

module.exports = { db, dbPath, getSettings, DEFAULT_SETTINGS };
