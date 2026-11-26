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

// Scent names, notes, taglines and descriptions come from the first-run catalogue in server/db.js.
const Q = "'((?:[^'\\\\]|\\\\.)*)'";
const unq = (t) => t.replace(/\\'/g, "'");
const products = [...readFileSync(join(root, 'server', 'db.js'), 'utf8')
  .matchAll(new RegExp(`^\\s*\\['([a-z0-9-]+)', ${Q}, '(?:Men|Women)', ${Q}, ${Q}, ${Q},\\s*${Q}`, 'gm'))]
  .map(([, slug, name, family, notes, tagline, description]) => ({ slug, name: unq(name), family: unq(family), notes: unq(notes), tagline: unq(tagline), description: unq(description) }));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const pages = [
  ['shop', 'All Fragrances', 'All Fragrances: Twelve signature eaux de parfum, each available in 10ml and 30ml.', 'list'],
  ['finder', 'Scent Finder', 'Not sure which Nelmora scent to pick? Answer a few quick questions and find your perfect eau de parfum.'],
  ['about', 'Our Story', 'The story behind Nelmora Parfums: a Malaysian fragrance house making long-lasting eau de parfum, one scent at a time.'],
  ['contact', 'Contact', 'Contact Nelmora Parfums for orders, bulk and gift enquiries, or help choosing a scent.'],
  ['policies/shipping', 'Shipping & Returns', 'Shipping and returns information for Nelmora Parfums orders.'],
  ['policies/privacy', 'Privacy Policy', 'How Nelmora Parfums collects, uses and protects your personal information.'],
  ['policies/terms', 'Terms of Sale', 'The terms that apply when you buy from Nelmora Parfums.'],
  ...products.map((p) => [`shop/${p.slug}`, `${p.name} Eau de Parfum`,
    `${p.name} eau de parfum by Nelmora. ${p.tagline} Notes of ${p.notes}. Available in 10ml and 30ml. Made in Malaysia.`,
    `<p>${esc(p.tagline)}</p><p>${esc(p.description)}</p><p>Notes: ${esc(p.notes)}. Fragrance family: ${esc(p.family)}. Available in 10ml and 30ml.</p>`]),
];

const nav = `<nav><a href="/">Home</a> · <a href="/shop">All fragrances</a> · <a href="/finder">Scent Finder</a> · <a href="/about">Our story</a> · <a href="/contact">Contact</a></nav>`;
const scentLinks = `<ul>${products.map((p) => `<li><a href="/shop/${p.slug}">${esc(p.name)}</a>: ${esc(p.tagline)}</li>`).join('')}</ul>`;

for (const [path, title, desc, extra] of pages) {
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
  // Written as shop/horizon.html (not shop/horizon/index.html): Netlify then serves /shop/horizon directly, with no redirect to a trailing slash.
  // Real text inside #root: Google sees the page's content immediately, without waiting for the shop's data to load.
  // React replaces all of this the moment the app starts, so visitors still see the normal page.
  const body = `<main style="max-width:760px;margin:0 auto;padding:7rem 1.5rem 4rem"><h1>${esc(title)}</h1>${desc && !extra?.startsWith('<') ? `<p>${esc(desc)}</p>` : ''}${extra === 'list' ? scentLinks : extra || ''}${nav}</main>`;
  out = out.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  mkdirSync(dirname(join(dist, path)), { recursive: true });
  writeFileSync(join(dist, `${path}.html`), out);
}
console.log(`prerender-meta: wrote ${pages.length} pages (${products.length} scents)`);
