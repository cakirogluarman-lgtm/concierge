// Shared auth helper for admin endpoints.
// Reads the yc-admin cookie and verifies the HMAC signature + freshness.

const crypto = require('crypto');
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function verifyAdmin(req) {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  if (!secret) return false;
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies['yc-admin'];
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!ts || !sig) return false;
  const tsNum = Number(ts);
  if (!tsNum || Date.now() - tsNum > MAX_AGE_MS) return false;
  const expected = sign(ts, secret);
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch (e) { return false; }
}

module.exports = { verifyAdmin };
