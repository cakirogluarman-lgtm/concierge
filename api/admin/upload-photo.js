// /api/admin/upload-photo — admin uploads a base64-encoded JPEG.
// Stored in Vercel Blob, public URL saved into the subscription's Stripe metadata
// so /mark-visit-complete can embed it in the email.
//
// Requires env vars:
//   STRIPE_SECRET_KEY
//   BLOB_READ_WRITE_TOKEN   (auto-set by Vercel when you connect a Blob store)
//   ADMIN_TOKEN_SECRET

const Stripe = require('stripe');
const { put } = require('@vercel/blob');
const { verifyAdmin } = require('./_auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Vercel hobby tier limit is ~4.5MB. Keep a defensive cap.
const MAX_BYTES = 4_500_000;

module.exports.config = {
  api: { bodyParser: { sizeLimit: '5mb' } }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Not authenticated' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { subscriptionId, dataUrl } = body || {};

  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId required' });
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'dataUrl (base64 image) required' });
  }

  try {
    // Parse base64 image → Buffer
    const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid data URL' });
    const mime = match[1];
    const ext  = mime.split('/')[1].replace('jpeg', 'jpg');
    const buf  = Buffer.from(match[2], 'base64');
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: 'Photo too large after compression. Try a smaller image.' });
    }

    // Upload to Vercel Blob — public so the customer's email client can fetch it
    const filename = `yard-photos/${subscriptionId}/${Date.now()}.${ext}`;
    const blob = await put(filename, buf, {
      access: 'public',
      contentType: mime,
      addRandomSuffix: false
    });

    // Stash latest photo URL in Stripe metadata so mark-visit-complete can use it
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const meta = sub.metadata || {};
    await stripe.subscriptions.update(subscriptionId, {
      metadata: {
        ...meta,
        lastPhotoUrl: blob.url,
        lastPhotoAt: new Date().toISOString()
      }
    });

    return res.status(200).json({ ok: true, url: blob.url });
  } catch (err) {
    console.error('upload-photo error:', err);
    return res.status(500).json({ error: err.message || 'Upload failed' });
  }
};
