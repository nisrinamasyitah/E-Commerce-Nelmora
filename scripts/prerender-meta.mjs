// Runs after `vite build`. The shop is a single-page app, so every address used to return the SAME index.html
// (title + canonical = home page). Google reads that raw HTML first and treated most pages as copies of the home page.
// This writes one copy of index.html per page with its own title, description and canonical address.
// The React app still takes over in the browser, so nothing changes for visitors.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'client', 'dist');
const SITE = 'https://nelmoragroup.com';
const html = readFileSync(join(dist, 'index.html'), 'utf8');

// Scent names, notes and taglines come from the first-run catalogue in server/db.js.
const products = [...readFileSync(join(root, 'server', 'db.js'), 'utf8').matchAll(/^\s*\['([a-z0-9-]+)', '([^']+)', '(?:Men|Women)', '[^']*', '([^']*)', '([^']*)',/gm)]
  .map(([, slug, name, notes, tagline]) => ({ slug, name, notes, tagline }));

const pages = [
  ['shop', 'All Fragrances', 'All Fragrances: Twelve signature eaux de parfum, each available in 10ml and 30ml.'],
  ['finder', 'Scent Finder', 'Not sure which Nelmora scent to pick? Answer a few quick questions and find your perfect eau de parfum.'],
  ['about', 'Our Story', 'The story behind Nelmora Parfums: a Malaysian fragrance house making long-lasting eau de parfum, one scent at a time.'],
  ['contact', 'Contact', 'Contact Nelmora Parfums for orders, bulk and gift enquiries, or help choosing a scent.'],
  ['policies/shipping', 'Shipping & Returns'],
  ['policies/privacy', 'Privacy Policy'],
  ['policies/terms', 'Terms of Sale'],
  ...products.map((p) => [`shop/${p.slug}`, `${p.name} Eau de Parfum`,
    `${p.name} eau de parfum by Nelmora. ${p.tagline} Notes of ${p.notes}. Available in 10ml and 30ml. Made in Malaysia.`]),
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
for (const [path, title, desc] of pages) {
  const url = `${SITE}/${path}`;
  const fullTitle = `${title} | Nelmora Parfums`;
  let out = html
    .replace(/<title>.*?<\/title>/, `<title>${esc(fullTitle)}</title>`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(fullTitle)}$2`);
  if (desc) {
    out = out
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(desc)}$2`);
  }
  mkdirSync(join(dist, path), { recursive: true });
  writeFileSync(join(dist, path, 'index.html'), out);
}
console.log(`prerender-meta: wrote ${pages.length} pages (${products.length} scents)`);
