// /api/stripe-webhook — listens for Stripe events and emails the owner
// when a new subscription is created or a payment fails.
//
// Requires env vars in Vercel:
//   STRIPE_SECRET_KEY      (already set)
//   STRIPE_WEBHOOK_SECRET  (whsec_... from Stripe → Developers → Webhooks)
//   RESEND_API_KEY         (re_... from Resend)
//   NOTIFY_EMAIL           (the owner's notification inbox)

const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// IMPORTANT: Stripe signature verification needs the raw request body.
// Tell Vercel not to JSON-parse it.
module.exports.config = {
  api: { bodyParser: false }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  let event;
  try {
    const buf = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'customer.subscription.created') {
      await handleNewSubscription(event.data.object);
    } else if (event.type === 'invoice.payment_failed') {
      await handlePaymentFailed(event.data.object);
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    // Return 200 so Stripe doesn't retry; we've already logged the failure
    return res.status(200).json({ received: true, error: err.message });
  }
};

// ============================================
// New subscription → send a beautifully formatted welcome notification
// ============================================
async function handleNewSubscription(subscription) {
  const meta = subscription.metadata || {};
  const customer = await stripe.customers.retrieve(subscription.customer);

  // Total monthly amount across all line items
  const totalCents = subscription.items.data.reduce(
    (sum, item) => sum + (item.price.unit_amount || 0) * (item.quantity || 1),
    0
  );
  const totalMonthly = (totalCents / 100).toFixed(0);

  const planLabel = ({ biweekly: 'Bi-Weekly', weekly: 'Weekly', twiceweekly: 'Twice-Weekly' })[meta.plan] || meta.plan;
  const customerName = `${meta.firstName || ''} ${meta.lastName || ''}`.trim() || customer.name || 'New member';
  const phone = meta.phone || customer.phone || '';
  const email = customer.email || '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>New member</title></head>
<body style="margin:0;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#FAF6EE;color:#1B2B4D;line-height:1.5;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:580px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 16px rgba(27,43,77,0.08);overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#2D6A3E 0%,#1F4F2D 100%);padding:28px 32px;color:#FAF6EE;">
      <div style="font-size:13px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.85;">🐾 New Member Alert</div>
      <h1 style="margin:8px 0 4px;font-size:26px;font-weight:700;color:#FAF6EE;">${escape(customerName)} just signed up!</h1>
      <div style="font-size:36px;font-weight:800;color:#F4D58D;margin-top:8px;">$${totalMonthly}<span style="font-size:16px;font-weight:500;color:rgba(250,246,238,0.7);"> / month</span></div>
      <div style="margin-top:6px;font-size:14px;opacity:0.85;">${escape(planLabel)} plan${meta.addons ? ' · ' + escape(meta.addons.split(',').filter(Boolean).map(a => a === 'deodorize' ? 'Turf Deodorize' : a).join(' + ')) : ''}</div>
    </td></tr>

    <tr><td style="padding:24px 32px;">

      <h2 style="font-size:14px;letter-spacing:0.1em;text-transform:uppercase;color:#5A6580;margin:0 0 12px;">Contact</h2>
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:15px;">
        <tr><td style="padding:6px 0;color:#5A6580;width:120px;">Name</td><td style="padding:6px 0;font-weight:600;">${escape(customerName)}</td></tr>
        <tr><td style="padding:6px 0;color:#5A6580;">Email</td><td style="padding:6px 0;font-weight:600;"><a href="mailto:${escape(email)}" style="color:#2D6A3E;text-decoration:none;">${escape(email)}</a></td></tr>
        <tr><td style="padding:6px 0;color:#5A6580;">Phone</td><td style="padding:6px 0;font-weight:600;"><a href="tel:${escape(phone)}" style="color:#2D6A3E;text-decoration:none;">${escape(phone)}</a></td></tr>
      </table>

      <h2 style="font-size:14px;letter-spacing:0.1em;text-transform:uppercase;color:#5A6580;margin:24px 0 12px;">Address</h2>
      <div style="font-weight:600;font-size:15px;">${escape(meta.address || '—')}<br>West Palm Beach, FL ${escape(meta.zip || '')}</div>

      <h2 style="font-size:14px;letter-spacing:0.1em;text-transform:uppercase;color:#5A6580;margin:24px 0 12px;">Dog${meta.dogCount && Number(meta.dogCount) > 1 ? 's' : ''} (${escape(meta.dogCount || '1')})</h2>
      <div style="font-size:15px;">${escape(meta.dogs || '—')}</div>

      <h2 style="font-size:14px;letter-spacing:0.1em;text-transform:uppercase;color:#5A6580;margin:24px 0 12px;">Yard Access</h2>
      <div style="font-weight:600;text-transform:capitalize;font-size:15px;">${escape((meta.accessType || '').replace(/-/g, ' '))}</div>
      ${meta.gateCode ? `<div style="margin-top:8px;font-size:15px;"><span style="color:#5A6580;">Code:</span> <code style="background:#E8F1E4;padding:4px 10px;border-radius:6px;font-family:'SF Mono',Menlo,monospace;font-size:14px;color:#2D6A3E;">${escape(meta.gateCode)}</code></div>` : ''}
      ${meta.accessNotes ? `<div style="margin-top:10px;font-size:14px;color:#5A6580;font-style:italic;">"${escape(meta.accessNotes)}"</div>` : ''}

      <h2 style="font-size:14px;letter-spacing:0.1em;text-transform:uppercase;color:#5A6580;margin:24px 0 12px;">Schedule</h2>
      <div style="font-size:15px;"><strong>${escape((meta.preferredDay || '').replace('any', 'Any weekday') || '—')}</strong> · ${escape((meta.preferredTime || '').replace('morning', 'Morning (8a–12p)').replace('afternoon', 'Afternoon (12–4p)').replace('evening', 'Evening (4–7p)') || '—')}</div>

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:32px;width:100%;">
        <tr><td align="center">
          <a href="https://dashboard.stripe.com/subscriptions/${escape(subscription.id)}" style="display:inline-block;background:#1B2B4D;color:#FAF6EE;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px;">View in Stripe →</a>
        </td></tr>
      </table>

    </td></tr>
    <tr><td style="padding:18px 32px;background:#FBF8F1;border-top:1px solid rgba(27,43,77,0.06);text-align:center;font-size:12px;color:#5A6580;">
      The Yard Concierge · automated notification
    </td></tr>
  </table>
</body></html>`;

  await resend.emails.send({
    from: 'The Yard Concierge <onboarding@resend.dev>',
    to: [process.env.NOTIFY_EMAIL],
    subject: `🐾 New member: ${customerName} · $${totalMonthly}/mo · ${planLabel}`,
    html
  });
}

// ============================================
// Payment failed → tell owner so they can follow up
// ============================================
async function handlePaymentFailed(invoice) {
  const customer = await stripe.customers.retrieve(invoice.customer);
  const amount = (invoice.amount_due / 100).toFixed(2);

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:32px 16px;font-family:-apple-system,sans-serif;background:#FAF6EE;color:#1B2B4D;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;">
    <tr><td style="background:#B8413E;padding:24px 28px;color:#fff;">
      <div style="font-size:13px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.9;">⚠️ Payment Failed</div>
      <h1 style="margin:8px 0 0;font-size:22px;color:#fff;">${escape(customer.email || 'A customer')}'s card was declined</h1>
    </td></tr>
    <tr><td style="padding:24px 28px;font-size:15px;line-height:1.6;">
      <p>Amount due: <strong>$${amount}</strong></p>
      <p>Stripe will automatically retry the card a few times. If it keeps failing, the subscription will be paused and you'll be notified again.</p>
      <p>Consider texting <a href="tel:${escape(customer.phone || '')}" style="color:#2D6A3E;">${escape(customer.phone || 'customer')}</a> to give them a heads up.</p>
      <p style="margin-top:24px;"><a href="https://dashboard.stripe.com/customers/${escape(customer.id)}" style="display:inline-block;background:#1B2B4D;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;">View customer →</a></p>
    </td></tr>
  </table>
</body></html>`;

  await resend.emails.send({
    from: 'The Yard Concierge <onboarding@resend.dev>',
    to: [process.env.NOTIFY_EMAIL],
    subject: `⚠️ Payment failed: ${customer.email || 'customer'} · $${amount}`,
    html
  });
}

function escape(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
