// /api/admin/login — Stark types a passcode, we set a signed cookie.
//
// Required env vars:
//   ADMIN_PASSCODE      — what Stark types (e.g. "7392")
//   ADMIN_TOKEN_SECRET  — random secret for HMAC (any 32+ char string)

const crypto = require('crypto');

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { passcode } = body || {};

  const expected = process.env.ADMIN_PASSCODE;
  const secret   = process.env.ADMIN_TOKEN_SECRET;

  if (!expected || !secret) {
    return res.status(500).json({ error: 'Admin not configured (missing env vars).' });
  }
  if (!passcode || passcode !== expected) {
    // Light delay to discourage brute force
    await new Promise(r => setTimeout(r, 600));
    return res.status(401).json({ error: 'Incorrect passcode.' });
  }

  const ts = Date.now().toString();
  const token = ts + '.' + sign(ts, secret);

  res.setHeader('Set-Cookie',
    `yc-admin=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}`
  );
  return res.status(200).json({ ok: true });
};
