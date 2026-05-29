// /api/availability — returns a map of which (day, time) slots are already booked.
// Each 15-min slot holds 1 customer = 4 customers per hour automatically.
//
// Response shape:
//   { booked: { "tue|06:30": true, "wed|17:00": true, ... } }

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

let cache = { data: null, expiresAt: 0 };
const TTL_MS = 30 * 1000; // 30s cache to avoid Stripe rate limits

module.exports = async (req, res) => {
  // Cache headers — also let the CDN cache for 30s
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30, stale-while-revalidate=60');

  try {
    const now = Date.now();
    if (cache.data && cache.expiresAt > now) {
      return res.status(200).json(cache.data);
    }

    const booked = {};

    // Paginate through ALL active subscriptions
    let hasMore = true;
    let startingAfter = undefined;
    let safetyCounter = 0;

    while (hasMore && safetyCounter < 20) {
      safetyCounter++;
      const params = { status: 'active', limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;

      const page = await stripe.subscriptions.list(params);

      page.data.forEach(sub => {
        const meta = sub.metadata || {};
        const day = (meta.preferredDay || '').toLowerCase();
        const time = meta.preferredTime || '';
        if (day && time) booked[day + '|' + time] = true;
      });

      hasMore = page.has_more;
      if (hasMore && page.data.length) startingAfter = page.data[page.data.length - 1].id;
    }

    const payload = { booked, updatedAt: new Date().toISOString() };
    cache = { data: payload, expiresAt: now + TTL_MS };
    return res.status(200).json(payload);
  } catch (err) {
    console.error('availability error:', err);
    // Fail open — treat all slots as available if we can't reach Stripe
    return res.status(200).json({ booked: {}, error: err.message });
  }
};
