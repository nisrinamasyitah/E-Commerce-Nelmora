// Shared helpers: API calls, money formatting.
import { useEffect } from 'react';

export const rm = (sen) => {
  const v = (Number(sen) || 0) / 100;
  return 'RM' + (Number.isInteger(v) ? v.toString() : v.toFixed(2));
};

export async function api(path, { method = 'GET', body, token, raw } = {}) {
  const headers = {};
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = raw;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    Object.assign(err, { status: res.status, data });
    throw err;
  }
  return data;
}

export const waLink = (number, text) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

// Scent moods used for "Shop by family" and the Scent Finder. A product can sit in more than one.
export const MOODS = [
  { key: 'fresh', label: 'Fresh & Citrus', blurb: 'Bright, clean, effortless', test: /fresh|aquatic|citrus/i, image: 'citrus-muse' },
  { key: 'sweet', label: 'Sweet & Gourmand', blurb: 'Vanilla, coffee, cocoa', test: /gourmand|powdery/i, image: 'elara' },
  { key: 'fruity', label: 'Fruity', blurb: 'Juicy, playful, radiant', test: /fruity/i, image: 'strawberry-kiss' },
  { key: 'woody', label: 'Woody & Amber', blurb: 'Warm, deep, magnetic', test: /woody|musk|amber/i, image: 'delusion' },
];
export const inMood = (product, key) => MOODS.find((m) => m.key === key)?.test.test(product.family) ?? true;

const DEFAULT_DESC = 'Nelmora Parfums. Twelve eaux de parfum for women and men, made in Malaysia. Shop the Signature 30ml collection and 10ml travel sizes.';

// Sets the tab title, plus the page's search description and canonical address so Google can tell pages apart.
export function useTitle(title, description) {
  useEffect(() => {
    document.title = title ? `${title} | Nelmora Parfums` : 'Nelmora - A story in every scent';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', description || DEFAULT_DESC);
    const link = document.querySelector('link[rel="canonical"]');
    if (link) link.setAttribute('href', `https://nelmoragroup.com${window.location.pathname === '/' ? '/' : window.location.pathname.replace(/\/$/, '')}`);
  }, [title, description]);
}

export const notesList = (notes) => String(notes || '').split(',').map((n) => n.trim()).filter(Boolean);

// Ingredient pictures from the catalogue (public/images/notes). Matches the note name loosely, so
// "Calabrian Bergamot" and "Bourbon Vanilla" still find their picture. Returns null if there is none.
const NOTE_PICS = [
  ['bergamot', 'bergamot'], ['black tea', 'black-tea'], ['guaiac', 'guaiac-wood'], ['patchouli', 'patchouli'], ['tonka', 'tonka-bean'],
  ['cocoa', 'cocoa'], ['marine', 'marine'], ['musk', 'musk'], ['coffee', 'coffee'], ['vanilla', 'vanilla'], ['sugar', 'sugar'],
  ['marshmallow', 'marshmallow'], ['strawberry', 'strawberry'], ['cedar', 'cedarwood'], ['powder', 'powdery'], ['currant', 'black-currant'],
  ['berries', 'berries'], ['woody', 'woody-notes'], ['sandalwood', 'sandalwood'], ['citruses', 'citruses'], ['citrus', 'citrus'],
];
export const noteImage = (note) => {
  const n = String(note || '').toLowerCase();
  const hit = NOTE_PICS.find(([key]) => n.includes(key));
  return hit ? `/images/notes/${hit[1]}.webp` : null;
};
