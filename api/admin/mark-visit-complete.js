// /api/admin/mark-visit-complete — Stark taps "done", customer gets a friendly email,
// and the timestamp is appended to the subscription metadata `visits` field.

const Stripe = require('stripe');
const { Resend } = require('resend');
const { verifyAdmin } = require('./_auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Not authenticated' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { subscriptionId } = body || {};
  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId required' });

  try {
    // Fetch subscription + customer for the email
    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['customer'] });
    const meta = sub.metadata || {};
    const cust = sub.customer;
    const customerEmail = (cust && cust.email) || '';
    const firstName = meta.firstName || (cust && cust.name && cust.name.split(' ')[0]) || 'there';
    const dogNames = (meta.dogs || '').split('|').map(s => {
      const m = s.match(/\d+\.\s*(.+?)\s*\(/);
      return m ? m[1].trim() : '';
    }).filter(n => n && n.toLowerCase() !== 'unnamed');
    const dogPhrase = dogNames.length === 0 ? 'your pup' :
                       dogNames.length === 1 ? dogNames[0] :
                       dogNames.slice(0, -1).join(', ') + ' and ' + dogNames.slice(-1);

    // Append timestamp to visits (Stripe metadata values cap at 500 chars)
    const existing = (meta.visits || '').split(',').filter(Boolean);
    const newTs = new Date().toISOString();
    const updated = [newTs].concat(existing).slice(0, 20); // keep newest 20
    const updatedVisitsStr = updated.join(',');

    await stripe.subscriptions.update(subscriptionId, {
      metadata: { ...meta, visits: updatedVisitsStr }
    });

    // Send the customer a friendly "we just left" email
    if (customerEmail) {
      const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#FAF6EE;color:#1B2B4D;line-height:1.55;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 16px rgba(27,43,77,0.08);overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#2D6A3E 0%,#1F4F2D 100%);padding:32px;text-align:center;color:#FAF6EE;">
      <div style="font-size:42px;line-height:1;margin-bottom:8px;">🐾</div>
      <h1 style="margin:0;font-size:24px;font-weight:700;color:#FAF6EE;">Your yard is sparkling clean.</h1>
    </td></tr>
    <tr><td style="padding:28px 32px 8px;font-size:15.5px;">
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Just wanted to let you know — your visit is complete. The yard's been scooped, double-bagged, and we're on to the next one. ${escapeHtml(dogPhrase)} can run wild again.</p>
      <p style="color:#5A6580;font-size:14.5px;margin-top:18px;">If anything looks off, hit reply and we'll come back same-day. Otherwise, see you next visit.</p>
    </td></tr>
    <tr><td style="padding:0 32px 28px;">
      <div style="border-top:1px solid rgba(27,43,77,0.08);padding-top:18px;font-size:13px;color:#5A6580;text-align:center;">
        — The Yard Concierge<br>
        <a href="tel:+15613868901" style="color:#2D6A3E;text-decoration:none;">(561) 386-8901</a> · <a href="mailto:contact@theyardconcierge.com" style="color:#2D6A3E;text-decoration:none;">contact@theyardconcierge.com</a>
      </div>
    </td></tr>
  </table>
</body></html>`;

      await resend.emails.send({
        from: 'The Yard Concierge <onboarding@resend.dev>',
        to: [customerEmail],
        subject: '🐾 Your yard is sparkling clean!',
        html
      });
    }

    return res.status(200).json({
      ok: true,
      visitedAt: newTs,
      totalVisits: updated.length,
      emailed: !!customerEmail
    });
  } catch (err) {
    console.error('mark-visit-complete error:', err);
    return res.status(500).json({ error: err.message });
  }
};
