// Minimal Stripe Checkout client (no SDK needed). Active only when STRIPE_SECRET_KEY is set.
// In Malaysia, Stripe Checkout shows whichever methods you enable in the dashboard: card, FPX, GrabPay.
const crypto = require('crypto');

const KEY = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Stripe expects form encoding with bracket notation: line_items[0][price_data][currency]=myr
function encode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') encode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

async function call(method, path, body) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? encode(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Stripe ${res.status}`);
  return json;
}

async function createCheckout({ code, email, lines, shipping, discount = 0, successUrl, cancelUrl }) {
  const items = lines.map((l) => ({
    quantity: l.qty,
    price_data: { currency: 'myr', unit_amount: l.price, product_data: { name: `${l.name} ${l.size}` } },
  }));
  if (shipping > 0) items.push({ quantity: 1, price_data: { currency: 'myr', unit_amount: shipping, product_data: { name: 'Shipping' } } });
  // Stripe line items cannot be negative, so a discount is sent as a one-time coupon.
  const coupon = discount > 0
    ? await call('POST', '/coupons', { amount_off: discount, currency: 'myr', duration: 'once', name: 'Welcome offer' })
    : null;
  return call('POST', '/checkout/sessions', {
    ...(coupon && { discounts: [{ coupon: coupon.id }] }),
    mode: 'payment',
    customer_email: email,
    client_reference_id: code,
    metadata: { order_code: code },
    payment_intent_data: { metadata: { order_code: code } },
    line_items: items,
    success_url: successUrl,
    cancel_url: cancelUrl,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
  });
}

const getSession = (id) => call('GET', `/checkout/sessions/${encodeURIComponent(id)}`);

function verifyWebhook(raw, header) {
  if (!WEBHOOK_SECRET || !header || !Buffer.isBuffer(raw)) return null;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return null;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  const sigs = String(header).split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  try { return JSON.parse(raw.toString('utf8')); } catch { return null; }
}

module.exports = { enabled: !!KEY, test: KEY.startsWith('sk_test_') || KEY.startsWith('rk_test_'), createCheckout, getSession, verifyWebhook, encode };
