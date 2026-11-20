// Tests the Stripe flow (cards + FPX via Stripe Checkout) against a SIMULATED Stripe: no real money, no network.
// Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nelmora-stripe-test-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_PASSWORD = 'test-pass';
process.env.STRIPE_SECRET_KEY = 'sk_test_simulated';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_simulated';
process.env.PUBLIC_URL = 'https://shop.example';

// ---- simulated Stripe API ----
const realFetch = global.fetch;
const stripe = { calls: [], sessions: {}, failNext: false };
global.fetch = async (url, opts = {}) => {
  if (!String(url).startsWith('https://api.stripe.com/v1')) return realFetch(url, opts);
  const endpoint = String(url).replace('https://api.stripe.com/v1', '');
  const form = opts.body ? Object.fromEntries(new URLSearchParams(opts.body)) : {};
  stripe.calls.push({ method: opts.method, endpoint, form, auth: opts.headers?.Authorization });
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (stripe.failNext) { stripe.failNext = false; return reply(400, { error: { message: 'Simulated Stripe failure' } }); }
  if (endpoint === '/coupons') return reply(200, { id: 'cp_sim' });
  if (endpoint === '/checkout/sessions' && opts.method === 'POST') {
    const id = 'cs_test_' + crypto.randomBytes(4).toString('hex');
    stripe.sessions[id] = { id, payment_status: 'unpaid' };
    return reply(200, { id, url: `https://checkout.stripe.com/c/pay/${id}` });
  }
  const m = endpoint.match(/^\/checkout\/sessions\/(.+)$/);
  if (m && stripe.sessions[m[1]]) return reply(200, stripe.sessions[m[1]]);
  return reply(404, { error: { message: 'unknown ' + endpoint } });
};

const { app } = require('./app');
let server, base, token;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await req('POST', '/api/admin/login', { password: 'test-pass' })).body.token;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function req(method, url, body, auth, headers = {}) {
  const res = await realFetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(auth && { Authorization: `Bearer ${token}` }), ...headers },
    body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
// a webhook exactly as Stripe signs it
function webhook(event, { secret = 'whsec_simulated', t = Math.floor(Date.now() / 1000) } = {}) {
  const payload = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return req('POST', '/api/stripe/webhook', payload, false, { 'stripe-signature': `t=${t},v1=${sig}` });
}
const customer = { name: 'Siti Aminah', email: 'siti@example.com', phone: '012-3456789', address1: '12 Jalan Mawar 3', postcode: '40100', city: 'Shah Alam', state: 'Selangor' };
const variant = async (slug, size) => (await req('GET', '/api/products')).body.find((p) => p.slug === slug).variants.find((v) => v.size === size);
const adminOrder = async (code) => (await req('GET', '/api/admin/orders', null, true)).body.find((o) => o.code === code);
const stockOf = async (slug, size) => (await req('GET', '/api/admin/products', null, true)).body.find((p) => p.slug === slug).variants.find((v) => v.size === size).stock;

test('config: online payment is on, in test mode, with cards and FPX shown', async () => {
  const c = (await req('GET', '/api/config')).body;
  assert.equal(c.stripeEnabled, true);
  assert.equal(c.stripeTest, true);
  for (const m of ['visa', 'mastercard', 'fpx', 'duitnow']) assert.ok(c.paymentLogos.includes(m), m);
});

test('order -> Stripe Checkout request is correct (MYR, sen amounts, shipping line, metadata, return links)', async () => {
  const v = await variant('aura', '30ml');
  const r = await req('POST', '/api/orders', { customer, items: [{ variantId: v.id, qty: 2, price: 1 }], paymentMethod: 'stripe' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.redirect, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);

  const call = stripe.calls.filter((c) => c.endpoint === '/checkout/sessions' && c.method === 'POST').at(-1);
  assert.equal(call.auth, 'Bearer sk_test_simulated');
  const f = call.form;
  assert.equal(f.mode, 'payment');
  assert.equal(f['line_items[0][price_data][currency]'], 'myr');
  assert.equal(f['line_items[0][price_data][unit_amount]'], '6500');       // price comes from the server, not the browser (we sent price: 1)
  assert.equal(f['line_items[0][quantity]'], '2');
  assert.equal(f['line_items[0][price_data][product_data][name]'], 'Aura 30ml');
  assert.equal(f['line_items[1][price_data][product_data][name]'], 'Shipping');
  assert.equal(f['line_items[1][price_data][unit_amount]'], '800');
  assert.equal(f['metadata[order_code]'], r.body.code);
  assert.equal(f.customer_email, 'siti@example.com');
  assert.equal(f.success_url, `https://shop.example/order/${r.body.code}?t=${r.body.token}&paid=1`);
  assert.equal(f.cancel_url, `https://shop.example/checkout?cancelled=${r.body.code}`);
  assert.ok(Number(f.expires_at) > Date.now() / 1000 + 1700);                // Stripe needs at least 30 minutes

  const o = await adminOrder(r.body.code);
  assert.equal(o.payment_method, 'stripe');
  assert.equal(o.payment_status, 'unpaid');
  assert.equal(o.total, 13800);
});

test('webhook: bad or missing signatures are rejected, a real one marks the order paid (once)', async () => {
  const v = await variant('onyx', '10ml');
  const r = await req('POST', '/api/orders', { customer, items: [{ variantId: v.id, qty: 1 }], paymentMethod: 'stripe' });
  const sessionId = new URL(r.body.redirect).pathname.split('/').pop();
  const event = { type: 'checkout.session.completed', data: { object: { id: sessionId, payment_status: 'paid', metadata: { order_code: r.body.code } } } };

  assert.equal((await webhook(event, { secret: 'whsec_wrong' })).status, 400);
  assert.equal((await webhook(event, { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400);   // replayed / too old
  assert.equal((await req('POST', '/api/stripe/webhook', JSON.stringify(event), false)).status, 400); // no signature at all
  assert.equal((await adminOrder(r.body.code)).payment_status, 'unpaid');

  assert.equal((await webhook(event)).status, 200);
  assert.equal((await adminOrder(r.body.code)).payment_status, 'paid');
  assert.equal((await webhook(event)).status, 200);                                                    // Stripe retries: harmless
  assert.equal((await adminOrder(r.body.code)).payment_status, 'paid');
});

test('FPX-style delayed payment: completed-but-unpaid waits, async success marks it paid', async () => {
  const v = await variant('elara', '10ml');
  const r = await req('POST', '/api/orders', { customer, items: [{ variantId: v.id, qty: 1 }], paymentMethod: 'stripe' });
  const id = new URL(r.body.redirect).pathname.split('/').pop();
  const obj = (status) => ({ data: { object: { id, payment_status: status, metadata: { order_code: r.body.code } } } });
  await webhook({ type: 'checkout.session.completed', ...obj('unpaid') });
  assert.equal((await adminOrder(r.body.code)).payment_status, 'unpaid');
  await webhook({ type: 'checkout.session.async_payment_succeeded', ...obj('paid') });
  assert.equal((await adminOrder(r.body.code)).payment_status, 'paid');
});

test('customer returns without the webhook having arrived: the order page asks Stripe and updates itself', async () => {
  const v = await variant('horizon', '10ml');
  const r = await req('POST', '/api/orders', { customer, items: [{ variantId: v.id, qty: 1 }], paymentMethod: 'stripe' });
  const id = new URL(r.body.redirect).pathname.split('/').pop();
  assert.equal((await req('GET', `/api/orders/${r.body.code}?t=${r.body.token}`)).body.payment_status, 'unpaid');
  stripe.sessions[id].payment_status = 'paid';
  assert.equal((await req('GET', `/api/orders/${r.body.code}?t=${r.body.token}`)).body.payment_status, 'paid');
});

test('abandoned / expired / failed payments free the stock straight away', async () => {
  const v = await variant('victus-cologne', '30ml');
  const before = await stockOf('victus-cologne', '30ml');
  for (const type of ['checkout.session.expired', 'checkout.session.async_payment_failed']) {
    const r = await req('POST', '/api/orders', { customer, items: [{ variantId: v.id, qty: 2 }], paymentMethod: 'stripe' });
    assert.equal(await stockOf('victus-cologne', '30ml'), before - 2);
    await webhook({ type, data: { object: { id: 'x', payment_status: 'unpaid', metadata: { order_code: r.body.code } } } });
    assert.equal((await adminOrder(r.body.code)).status, 'cancelled');
    assert.equal(await stockOf('victus-cologne', '30ml'), before);
  }
  // an order that was already paid is never cancelled by a stray "expired" event
  const r = await req('POST', '/api/orders', { customer, items: [{ variantId: v.id, qty: 1 }], paymentMethod: 'stripe' });
  await webhook({ type: 'checkout.session.completed', data: { object: { id: 'y', payment_status: 'paid', metadata: { order_code: r.body.code } } } });
  await webhook({ type: 'checkout.session.expired', data: { object: { id: 'y', payment_status: 'unpaid', metadata: { order_code: r.body.code } } } });
  assert.equal((await adminOrder(r.body.code)).status, 'new');
});

test('Stripe being down cancels the order, gives the stock back and tells the customer', async () => {
  const v = await variant('valentus', '10ml');
  const before = await stockOf('valentus', '10ml');
  stripe.failNext = true;
  const r = await req('POST', '/api/orders', { customer, items: [{ variantId: v.id, qty: 3 }], paymentMethod: 'stripe' });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Online payment is unavailable/);
  assert.equal(await stockOf('valentus', '10ml'), before);
});

test('welcome discount is sent to Stripe as a one-time MYR coupon', async () => {
  const sub = (await req('POST', '/api/subscribe', { email: customer.email })).body;
  const v = await variant('noir-berry', '30ml');
  const r = await req('POST', '/api/orders', { customer, items: [{ variantId: v.id, qty: 1 }], paymentMethod: 'stripe', code: sub.code });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const coupon = stripe.calls.filter((c) => c.endpoint === '/coupons').at(-1).form;
  assert.deepEqual([coupon.amount_off, coupon.currency, coupon.duration], ['1000', 'myr', 'once']);
  const session = stripe.calls.filter((c) => c.endpoint === '/checkout/sessions' && c.method === 'POST').at(-1).form;
  assert.equal(session['discounts[0][coupon]'], 'cp_sim');
  assert.equal((await adminOrder(r.body.code)).total, 6500 - 1000 + 800);
});
