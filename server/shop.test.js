// Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nelmora-shop-test-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_PASSWORD = 'test-pass';
process.env.STRIPE_SECRET_KEY = '';

const { app } = require('./app');
const { quote, shippingFor } = require('./shop');
let server, base, token;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await req('POST', '/api/admin/login', { password: 'test-pass' })).body.token;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function req(method, url, body, auth) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(auth && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const customer = { name: 'Siti Aminah', email: 'siti@example.com', phone: '012-3456789', address1: '12 Jalan Mawar 3',
  postcode: '40100', city: 'Shah Alam', state: 'Selangor' };

test('shipping: west, east, free threshold', () => {
  const s = { shipping_west: 800, shipping_east: 1500, free_shipping_min: 15000 };
  assert.equal(shippingFor(6500, 'west', s), 800);
  assert.equal(shippingFor(6500, 'east', s), 1500);
  assert.equal(shippingFor(15000, 'east', s), 0);
  assert.equal(shippingFor(6500, null, s), 0);
});

test('quote merges duplicates and caps at stock', () => {
  const v = { id: 1, price: 2500, stock: 3, size: '10ml', name: 'Aura', slug: 'aura', active: 1 };
  const q = quote([{ variantId: 1, qty: 2 }, { variantId: 1, qty: 2 }], 'Sabah', { shipping_west: 800, shipping_east: 1500, free_shipping_min: 15000 }, (id) => (id === 1 ? v : undefined));
  assert.equal(q.lines[0].qty, 3);
  assert.equal(q.problems.length, 1);
  assert.equal(q.total, 3 * 2500 + 1500);
});

test('catalogue is seeded with 12 scents, RM25 / RM65', async () => {
  const { body } = await req('GET', '/api/products');
  assert.equal(body.length, 12);
  for (const p of body) {
    assert.deepEqual(p.variants.map((v) => [v.size, v.price]), [['10ml', 2500], ['30ml', 6500]]);
    assert.equal(p.variants[0].stock, undefined, 'exact stock is not exposed publicly');
  }
});

test('order: server prices, stock goes down, cancel restores it', async () => {
  const { body: products } = await req('GET', '/api/products');
  const v30 = products.find((p) => p.slug === 'onyx').variants.find((v) => v.size === '30ml');
  const r = await req('POST', '/api/orders', { customer, items: [{ variantId: v30.id, qty: 2, price: 1 }], paymentMethod: 'transfer' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = await req('GET', `/api/orders/${r.body.code}?t=${r.body.token}`);
  assert.equal(o.body.subtotal, 13000);
  assert.equal(o.body.shipping, 800);
  assert.equal(o.body.total, 13800);
  assert.equal(o.body.token, undefined);

  const stockOf = async () => (await req('GET', '/api/admin/products', null, true)).body.find((p) => p.slug === 'onyx').variants.find((v) => v.size === '30ml').stock;
  assert.equal(await stockOf(), 8);
  const list = await req('GET', '/api/admin/orders', null, true);
  const id = list.body.find((x) => x.code === r.body.code).id;
  await req('PATCH', `/api/admin/orders/${id}`, { status: 'cancelled' }, true);
  assert.equal(await stockOf(), 10);
});

test('order lookup needs the right email or token', async () => {
  const { body: products } = await req('GET', '/api/products');
  const r = await req('POST', '/api/orders', { customer, items: [{ variantId: products[0].variants[0].id, qty: 1 }] });
  assert.equal((await req('GET', `/api/orders/${r.body.code}?email=wrong@example.com`)).status, 404);
  assert.equal((await req('GET', `/api/orders/${r.body.code}?t=bad`)).status, 404);
  assert.equal((await req('GET', `/api/orders/${r.body.code}?email=SITI@example.com`)).status, 200);
});

test('cannot order more than stock', async () => {
  const { body: products } = await req('GET', '/api/products');
  const v = products[1].variants[0];
  const r = await req('POST', '/api/orders', { customer, items: [{ variantId: v.id, qty: 50 }] });
  assert.equal(r.status, 409);
});

test('invalid customer details are rejected with field errors', async () => {
  const r = await req('POST', '/api/orders', { customer: { ...customer, postcode: '123', state: 'Atlantis' }, items: [] });
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.postcode && r.body.fields.state);
});

test('admin routes require login', async () => {
  assert.equal((await req('GET', '/api/admin/orders')).status, 401);
  assert.equal((await req('POST', '/api/admin/login', { password: 'nope' })).status, 401);
});

// ---- the Netlify function wrapper (what actually runs online) ----
const { handler } = require('../netlify/functions/shop');
const lambda = (method, path, { body, headers = {}, query = {}, base64 = false } = {}) => handler({
  httpMethod: method,
  path: `/.netlify/functions/shop${path}`,
  rawUrl: `https://example.netlify.app${path}`,
  headers: { host: 'example.netlify.app', 'x-forwarded-proto': 'https', ...headers },
  multiValueHeaders: {},
  queryStringParameters: query,
  body: body ?? null,
  isBase64Encoded: base64,
}, {});

test('netlify function: serves products and config', async () => {
  const r = await lambda('GET', '/api/products');
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).length, 12);
  assert.match(String(r.headers['cache-control']), /no-store/);
  assert.equal((await lambda('GET', '/api/config')).statusCode, 200);
  assert.equal((await lambda('GET', '/api/nope')).statusCode, 404);
});

test('netlify function: places an order with a JSON body', async () => {
  const products = JSON.parse((await lambda('GET', '/api/products')).body);
  const v = products.find((p) => p.slug === 'aura').variants[0];
  const r = await lambda('POST', '/api/orders', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customer, items: [{ variantId: v.id, qty: 1 }], paymentMethod: 'transfer' }),
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.match(JSON.parse(r.body).code, /^NM-/);
});

test('netlify function: admin upload (binary) then image is served back', async () => {
  const login = JSON.parse((await lambda('POST', '/api/admin/login', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-pass' }) })).body);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const up = await lambda('POST', '/api/admin/upload', { headers: { 'content-type': 'image/png', authorization: `Bearer ${login.token}` }, body: png.toString('base64'), base64: true });
  assert.equal(up.statusCode, 200, up.body);
  const { url } = JSON.parse(up.body);
  const img = await lambda('GET', url);
  assert.equal(img.statusCode, 200);
  assert.equal(img.isBase64Encoded, true);
  assert.deepEqual(Buffer.from(img.body, 'base64'), png);
  const noAuth = await lambda('POST', '/api/admin/upload', { headers: { 'content-type': 'image/png' }, body: png.toString('base64'), base64: true });
  assert.equal(noAuth.statusCode, 401);
});

test('admin: edit stock, product and settings; brute force is limited', async () => {
  const token = (await req('POST', '/api/admin/login', { password: 'test-pass' })).body.token;
  const get = (u) => req('GET', u, null, true);
  const products = (await get('/api/admin/products')).body;
  const p = products.find((x) => x.slug === 'horizon');
  const saved = await req('PUT', `/api/admin/products/${p.id}`, { ...p, tagline: 'New tagline', variants: p.variants.map((v) => ({ ...v, stock: 4 })) }, true);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.tagline, 'New tagline');
  assert.deepEqual(saved.body.variants.map((v) => v.stock), [4, 4]);
  const created = await req('POST', '/api/admin/products', { name: 'Test Scent', gender: 'Unisex', variants: [{ size: '50ml', price: 9000, stock: 2 }] }, true);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal((await req('POST', '/api/admin/products', { name: 'Test Scent', variants: [] }, true)).status, 400);
  const st = await req('PUT', '/api/admin/settings', { bank_account_no: '1234 5678', free_shipping_min: 20000 }, true);
  assert.equal(st.body.bank_account_no, '1234 5678');
  assert.equal(st.body.free_shipping_min, 20000);
  assert.equal(typeof token, 'string');

  for (let i = 0; i < 5; i++) await req('POST', '/api/admin/login', { password: 'wrong' });
  assert.equal((await req('POST', '/api/admin/login', { password: 'wrong' })).status, 429);
});

// ---- welcome offer ----
test('welcome offer: signup gives a personal code, same email gets the same code', async () => {
  const a = await req('POST', '/api/subscribe', { name: 'Aisyah', email: 'Aisyah@Example.com', phone: '012-345 6789', month: 5, day: 17, gender: 'Women' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(a.body.code, /^WELCOME-[A-Z0-9]{6}$/);
  assert.equal(a.body.amount, 1000);
  const again = await req('POST', '/api/subscribe', { email: 'aisyah@example.com' });
  assert.equal(again.body.code, a.body.code);
  assert.equal((await req('POST', '/api/subscribe', { email: 'not-an-email' })).status, 400);
  assert.equal((await req('POST', '/api/subscribe', { email: 'x@example.com', phone: '123' })).status, 400);
  const list = (await req('GET', '/api/admin/subscribers', null, true)).body.find((s) => s.email === 'aisyah@example.com');
  assert.equal(list.birthday, '05-17');
  assert.equal(list.name, 'Aisyah');
  assert.equal(list.gender, 'Women');
});

test('welcome offer: discount rules at quote time', async () => {
  const code = (await req('POST', '/api/subscribe', { email: 'rules@example.com' })).body.code;
  const products = (await req('GET', '/api/products')).body;
  const v30 = products.find((p) => p.slug === 'elara').variants.find((v) => v.size === '30ml');
  const v10 = products.find((p) => p.slug === 'elara').variants.find((v) => v.size === '10ml');
  const quoteWith = (items, email, c = code) => req('POST', '/api/quote', { items, state: 'Selangor', code: c, email }).then((r) => r.body);

  const ok = await quoteWith([{ variantId: v30.id, qty: 1 }], 'rules@example.com');
  assert.equal(ok.discount, 1000);
  assert.equal(ok.total, 6500 - 1000 + 800);
  assert.equal(ok.codeMessage, '');
  assert.match((await quoteWith([{ variantId: v30.id, qty: 1 }], 'someone@else.com')).codeMessage, /email you signed up with/);
  assert.match((await quoteWith([{ variantId: v30.id, qty: 1 }], '')).codeMessage, /Enter the email/);
  const small = await quoteWith([{ variantId: v10.id, qty: 1 }], 'rules@example.com');
  assert.equal(small.discount, 0);
  assert.match(small.codeMessage, /Spend RM50/);
  assert.match((await quoteWith([{ variantId: v30.id, qty: 1 }], 'rules@example.com', 'WELCOME-NOPE00')).codeMessage, /not valid/);
});

test('welcome offer: used once, freed when the order is cancelled', async () => {
  const code = (await req('POST', '/api/subscribe', { email: customer.email })).body.code;
  const products = (await req('GET', '/api/products')).body;
  const v30 = products.find((p) => p.slug === 'valentus').variants.find((v) => v.size === '30ml');
  const order = (extra = {}) => req('POST', '/api/orders', { customer, items: [{ variantId: v30.id, qty: 1 }], paymentMethod: 'transfer', code, ...extra });

  const first = await order();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const o = (await req('GET', `/api/orders/${first.body.code}?t=${first.body.token}`)).body;
  assert.equal(o.discount, 1000);
  assert.equal(o.discount_code, code);
  assert.equal(o.total, 6500 - 1000 + 800);

  const second = await order();
  assert.equal(second.status, 400);
  assert.match(second.body.error, /already been used/);

  const id = (await req('GET', '/api/admin/orders', null, true)).body.find((x) => x.code === first.body.code).id;
  await req('PATCH', `/api/admin/orders/${id}`, { status: 'cancelled' }, true);
  const third = await order();
  assert.equal(third.status, 200, JSON.stringify(third.body));
  // a code can never be applied to someone else's email
  const other = await req('POST', '/api/orders', { customer: { ...customer, email: 'thief@example.com' }, items: [{ variantId: v30.id, qty: 1 }], code });
  assert.equal(other.status, 400);
});

test('welcome offer: can be switched off in settings', async () => {
  await req('PUT', '/api/admin/settings', { welcome_discount: 0 }, true);
  assert.equal((await req('GET', '/api/config')).body.welcome.amount, 0);
  const r = await req('POST', '/api/subscribe', { email: 'off@example.com' });
  assert.equal(r.body.code, null);
  await req('PUT', '/api/admin/settings', { welcome_discount: 1000 }, true);
});

// ---- "We accept" payment logos ----
test('payment logos: only DuitNow without Stripe; setting is sanitised', async () => {
  assert.deepEqual((await req('GET', '/api/config')).body.paymentLogos, ['duitnow']);
  const saved = await req('PUT', '/api/admin/settings', { payment_logos: 'visa, atome, <script>, fpx,duitnow,shopeepay' }, true);
  assert.equal(saved.body.payment_logos, 'visa,fpx,duitnow');   // unknown / unsupported names are dropped
  assert.deepEqual((await req('GET', '/api/config')).body.paymentLogos, ['duitnow']);   // still no Stripe -> cards/FPX hidden
  await req('PUT', '/api/admin/settings', { payment_logos: 'visa,mastercard,amex,applepay,googlepay,fpx,duitnow,grabpay' }, true);
});
