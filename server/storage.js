// Uploaded product photos.
//  - Online (Netlify): Netlify Blobs, built in, nothing to set up.
//  - Locally: files in data/uploads.
const path = require('path');
const fs = require('fs');

// Checked on every call: Netlify sets its storage context when a request arrives, not at startup.
// Netlify Functions run on AWS Lambda, so AWS_LAMBDA_FUNCTION_NAME is also a reliable sign.
const isOnline = () => !!(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.AWS_LAMBDA_FUNCTION_NAME);
const dir = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const store = () => require('@netlify/blobs').getStore('uploads');

async function put(name, buffer) {
  if (isOnline()) {
    await store().set(name, buffer);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buffer);
}

async function get(name) {
  const type = TYPES[name.split('.').pop()] || 'application/octet-stream';
  if (isOnline()) {
    const data = await store().get(name, { type: 'arrayBuffer' });
    return data ? { buffer: Buffer.from(data), type } : null;
  }
  const file = path.join(dir, name);
  return fs.existsSync(file) ? { buffer: fs.readFileSync(file), type } : null;
}

module.exports = { put, get, isOnline };
