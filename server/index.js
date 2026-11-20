// Local server: the API plus the built website, for `npm start` / `npm run dev` on your computer.
// (Online, Netlify serves the website itself and runs server/app.js as a function.)
const path = require('path');
const fs = require('fs');
const express = require('express');
const { app } = require('./app');
const { url, isFile } = require('./db');
const stripe = require('./stripe');

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || '127.0.0.1';

const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Website not built yet. Run <code>npm run build</code>, or use <code>npm run dev</code> and open http://localhost:5174'));
}

app.listen(PORT, HOST, () => {
  console.log(`Nelmora shop running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Database: ${isFile ? url : 'online (Turso)'}`);
  console.log(process.env.ADMIN_PASSWORD ? 'Admin: /admin' : 'Admin is locked: set ADMIN_PASSWORD in .env to use /admin');
  console.log(stripe.enabled ? 'Stripe online payment: ON' : 'Stripe online payment: off (bank transfer only)');
});
