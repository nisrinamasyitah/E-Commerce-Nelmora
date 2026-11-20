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

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} | Nelmora Parfums` : 'Nelmora Parfums | Eau de Parfum, Made in Malaysia';
  }, [title]);
}

export const notesList =(notes) => String(notes || '').split(',').map((n) => n.trim()).filter(Boolean);
