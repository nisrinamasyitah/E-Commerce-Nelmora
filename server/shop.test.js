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

const { app } = require('./index');
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
