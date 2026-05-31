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

// ===========================================================================
// LAUNCH BUFFER — no first visit (and no charge) within this many days of
// signup. Lets Stark batch new members + prepare. Easy to lower to 0 later.
// ===========================================================================
const MIN_LEAD_DAYS = 10;

// Compute the actual first-visit date based on the customer's chosen day-of-week,
// the launch buffer, and "today". Used to set Stripe's trial_period_days so the
// first charge lands exactly on (or 1 day before) the first visit.
const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function daysUntilFirstVisit(dayKey) {
  const target = DAY_INDEX[(dayKey || '').toLowerCase()];
  if (target === undefined) return MIN_LEAD_DAYS;

  // Earliest possible date is today + MIN_LEAD_DAYS
  const earliest = new Date();
  earliest.setHours(0, 0, 0, 0);
  earliest.setDate(earliest.getDate() + MIN_LEAD_DAYS);

  // From there, walk forward to the next occurrence of the chosen day-of-week
  const earliestDow = earliest.getDay();
  const offset = (target - earliestDow + 7) % 7;

  return MIN_LEAD_DAYS + offset;
}

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
    if (!day || !time) {
      return res.status(400).json({ error: 'Please pick a day and time slot' });
    }

    // === SLOT-AVAILABILITY GUARD ===
    // Each 15-min slot holds exactly 1 customer. Re-check live so we never overbook.
    try {
      let hasMore = true, startingAfter, safety = 0;
      while (hasMore && safety < 20) {
        safety++;
        const params = { status: 'active', limit: 100 };
        if (startingAfter) params.starting_after = startingAfter;
        const page = await stripe.subscriptions.list(params);
        for (const sub of page.data) {
          const m = sub.metadata || {};
          if ((m.preferredDay || '').toLowerCase() === day.toLowerCase()
              && (m.preferredTime || '') === time) {
            return res.status(409).json({
              error: 'That slot was just booked by someone else. Please pick another time.'
            });
          }
        }
        hasMore = page.has_more;
        if (hasMore && page.data.length) startingAfter = page.data[page.data.length - 1].id;
      }
    } catch (slotErr) {
      console.error('slot check failed:', slotErr.message);
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

    // === COMPUTE FIRST-VISIT DATE + TRIAL PERIOD ===
    // The trial period ends on the day BEFORE the first visit, so Stripe charges
    // exactly when service starts. (e.g., signs up Fri picks Tue → 11-day trial →
    // first charge Mon evening → first visit Tue morning.)
    const leadDays = daysUntilFirstVisit(day);
    const firstVisitDate = new Date();
    firstVisitDate.setHours(0, 0, 0, 0);
    firstVisitDate.setDate(firstVisitDate.getDate() + leadDays);
    const firstVisitISO = firstVisitDate.toISOString().slice(0, 10);

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
      firstVisitDate: firstVisitISO,
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
        description: `${PLAN_LABEL[plan]} membership · ${(firstName + ' ' + lastName).trim()} · first visit ${firstVisitISO}`,
        trial_period_days: leadDays,
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
