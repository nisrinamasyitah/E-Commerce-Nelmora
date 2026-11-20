// Netlify serverless function: runs the whole shop API (server/app.js).
// netlify.toml sends /api/* and /uploads/* here.
const serverless = require('serverless-http');
const { app } = require('../../server/app');

const handle = serverless(app, {
  basePath: '/.netlify/functions/shop',
  // send images back as binary
  binary: (headers) => /^image\//.test(String(headers['content-type'] || '')),
});

exports.handler = async (event, context) => {
  try { require('@netlify/blobs').connectLambda(event); } catch { /* not running on Netlify (tests) */ }
  return handle(event, context);
};
