// /api/checkout — creates a dynamic Stripe Checkout Session for The Yard Concierge.
// Accepts form data from membership.html, calculates base + add-ons + extra dogs,
// attaches form details as subscription metadata, returns the Stripe checkout URL.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const VISITS_PER_MONTH = { biweekly: 2, weekly: 4, twiceweekly: 8 };
const BASE_MONTHLY     = { biweekly: 60, weekly: 88, twiceweekly: 144 };
const PLAN_LABEL       = { biweekly: 'Bi-Weekly', weekly: 'Weekly', twiceweekly: 'Twice-Weekly' };

// Per-visit add-on rates ($)
const ADDON_PER_VISIT  = { deodorize: 8 };
const ADDON_LABEL      = { deodorize: 'Turf Deodorize' };

// Per-visit extra-dog surcharge ($/visit per extra dog beyond 2)
const EXTRA_DOG_PER_VISIT = 4;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      plan,
      addons = [],
      firstName = '',
      lastName = '',
      email = '',
      phone = '',
      street = '',
      aptUnit = '',
      zip = '',
      dogCount = 1,
      dogs = [],
      accessType = '',
      gateCode = '',
      accessNotes = '',
      day = '',
      time = ''
    } = req.body || {};

    if (!BASE_MONTHLY[plan]) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const visits   = VISITS_PER_MONTH[plan];
    const extraDogs = Math.max(0, Number(dogCount) - 2);

    // === BUILD LINE ITEMS ===
    const lineItems = [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Yard Concierge — ${PLAN_LABEL[plan]} Membership`,
            description: `${visits} visits per month · ${BASE_MONTHLY[plan]}/month`
          },
          unit_amount: BASE_MONTHLY[plan] * 100,
          recurring: { interval: 'month' }
        },
        quantity: 1
      }
    ];

    // Extra dogs surcharge
    if (extraDogs > 0) {
      const extraDogMonthly = extraDogs * EXTRA_DOG_PER_VISIT * visits;
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${extraDogs} Extra Dog${extraDogs > 1 ? 's' : ''}`,
            description: `+$${EXTRA_DOG_PER_VISIT}/visit per extra dog × ${visits} visits/mo`
          },
          unit_amount: extraDogMonthly * 100,
          recurring: { interval: 'month' }
        },
        quantity: 1
      });
    }

    // Paid add-ons (deodorize). Photo proof is free, no line item needed.
    for (const addon of addons) {
      if (ADDON_PER_VISIT[addon]) {
        const monthly = ADDON_PER_VISIT[addon] * visits;
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${ADDON_LABEL[addon]} (Add-on)`,
              description: `+$${ADDON_PER_VISIT[addon]}/visit × ${visits} visits/mo`
            },
            unit_amount: monthly * 100,
            recurring: { interval: 'month' }
          },
          quantity: 1
        });
      }
    }

    // === FLATTEN FORM DATA AS METADATA (visible in Stripe Dashboard) ===
    const dogSummary = (dogs || [])
      .map((d, i) => `${i + 1}. ${d.name || 'unnamed'} (${d.size || '?'}, ${d.breed || 'breed n/a'})`)
      .join(' | ');

    const metadata = {
      firstName,
      lastName,
      phone,
      address: [street, aptUnit].filter(Boolean).join(', '),
      zip,
      dogCount: String(dogCount),
      dogs: dogSummary.substring(0, 500),
      accessType,
      gateCode,
      accessNotes: (accessNotes || '').substring(0, 500),
      preferredDay: day,
      preferredTime: time,
      plan,
      addons: addons.join(','),
      submittedAt: new Date().toISOString()
    };

    // === CREATE STRIPE CHECKOUT SESSION ===
    const origin = req.headers.origin || `https://${req.headers.host}` || 'https://concierge-jade-xi.vercel.app';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: lineItems,
      customer_email: email,
      // Card only — disables Stripe Link's phone verification step.
      // Apple Pay & Google Pay still work (they're card wallets).
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      success_url: `${origin}/membership.html?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/membership.html?status=canceled&plan=${encodeURIComponent(plan)}`,
      subscription_data: {
        description: `${PLAN_LABEL[plan]} membership · ${(firstName + ' ' + lastName).trim()}`,
        metadata
      },
      metadata
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: err.message || 'Stripe checkout failed' });
  }
};
