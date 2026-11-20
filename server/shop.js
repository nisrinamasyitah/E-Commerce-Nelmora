// Pricing, shipping and order rules. The server never trusts prices sent by the browser:
// every quote and order is rebuilt here from the database.

const WEST = ['Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak',
  'Perlis', 'Pulau Pinang', 'Putrajaya', 'Selangor', 'Terengganu'];
const EAST = ['Labuan', 'Sabah', 'Sarawak'];
const STATES = [...WEST, ...EAST].sort();

const regionOf = (state) => (EAST.includes(state) ? 'east' : WEST.includes(state) ? 'west' : null);

function shippingFor(subtotal, region, s) {
  if (!region || subtotal <= 0) return 0;
  if (s.free_shipping_min > 0 && subtotal >= s.free_shipping_min) return 0;
  return region === 'east' ? s.shipping_east : s.shipping_west;
}

/**
 * Build a quote from cart items.
 * @param {Array<{variantId:number, qty:number}>} items
 * @param {string} state Malaysian state (optional, for shipping)
 * @param {(id:number)=>object|undefined} findVariant returns {id, price, stock, size, name, slug, active}
 */
function quote(items, state, settings, findVariant) {
  const lines = [];
  const problems = [];
  const merged = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const id = Number(it?.variantId);
    const qty = Math.floor(Number(it?.qty));
    if (!Number.isInteger(id) || !(qty > 0)) continue;
    merged.set(id, Math.min(99, (merged.get(id) || 0) + qty));
  }
  for (const [id, qty] of merged) {
    const v = findVariant(id);
    if (!v || !v.active) { problems.push({ variantId: id, error: 'This item is no longer available.' }); continue; }
    if (v.stock <= 0) { problems.push({ variantId: id, error: `${v.name} ${v.size} is sold out.` }); continue; }
    const q = Math.min(qty, v.stock);
    if (q < qty) problems.push({ variantId: id, error: `Only ${v.stock} left of ${v.name} ${v.size}.` });
    lines.push({ variantId: id, name: v.name, slug: v.slug, size: v.size, image: v.image, price: v.price, qty: q, lineTotal: v.price * q });
  }
  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  const region = regionOf(state);
  const shipping = shippingFor(subtotal, region, settings);
  return { lines, problems, subtotal, shipping, total: subtotal + shipping, region };
}

const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function validateCustomer(body) {
  const c = {
    name: clean(body.name, 120),
    email: clean(body.email, 160).toLowerCase(),
    phone: clean(body.phone, 30),
    address1: clean(body.address1),
    address2: clean(body.address2),
    postcode: clean(body.postcode, 10),
    city: clean(body.city, 80),
    state: clean(body.state, 40),
    note: clean(body.note, 500),
  };
  const errors = {};
  if (c.name.length < 2) errors.name = 'Please enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errors.email = 'Please enter a valid email.';
  if (c.phone.replace(/\D/g, '').length < 9) errors.phone = 'Please enter a valid phone number.';
  if (c.address1.length < 5) errors.address1 = 'Please enter your address.';
  if (!/^\d{5}$/.test(c.postcode)) errors.postcode = 'Postcode must be 5 digits.';
  if (c.city.length < 2) errors.city = 'Please enter your city.';
  if (!regionOf(c.state)) errors.state = 'Please choose your state.';
  return { customer: c, errors };
}

module.exports = { STATES, WEST, EAST, regionOf, shippingFor, quote, validateCustomer, clean };
