// /api/admin/members — returns all active members with their schedule, dog info, address.
// Pulls directly from Stripe (subscriptions + their attached customers).

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { verifyAdmin } = require('./_auth');

const PLAN_LABEL = { biweekly: 'Bi-Weekly', weekly: 'Weekly', twiceweekly: 'Twice-Weekly' };
const DAY_LABEL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

function fmtSlot(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return hh + ':' + String(m).padStart(2,'0') + ' ' + period;
}

module.exports = async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const members = [];
    let hasMore = true, startingAfter, safety = 0;

    while (hasMore && safety < 30) {
      safety++;
      const params = { status: 'all', limit: 100, expand: ['data.customer'] };
      if (startingAfter) params.starting_after = startingAfter;
      const page = await stripe.subscriptions.list(params);

      for (const sub of page.data) {
        const meta = sub.metadata || {};
        const cust = (sub.customer && typeof sub.customer === 'object') ? sub.customer : {};

        // Total monthly amount
        const totalCents = (sub.items?.data || []).reduce(
          (sum, item) => sum + (item.price?.unit_amount || 0) * (item.quantity || 1), 0
        );

        const visitsLog = (meta.visits || '').split(',').filter(Boolean);

        members.push({
          id: sub.id,
          customerId: cust.id,
          status: sub.status,
          createdAt: sub.created * 1000,
          monthlyTotal: totalCents / 100,
          name: ((meta.firstName || '') + ' ' + (meta.lastName || '')).trim() || cust.name || 'Member',
          email: cust.email || '',
          phone: meta.phone || cust.phone || '',
          address: meta.address || '',
          zip: meta.zip || '',
          dogs: meta.dogs || '',
          dogCount: Number(meta.dogCount || 1),
          plan: meta.plan || '',
          planLabel: PLAN_LABEL[meta.plan] || meta.plan,
          addons: (meta.addons || '').split(',').filter(Boolean),
          accessType: meta.accessType || '',
          gateCode: meta.gateCode || '',
          accessNotes: meta.accessNotes || '',
          preferredDay: meta.preferredDay || '',
          preferredDayLabel: DAY_LABEL[meta.preferredDay] || meta.preferredDay,
          preferredTime: meta.preferredTime || '',
          preferredTimeLabel: fmtSlot(meta.preferredTime),
          visits: visitsLog,
          lastPhotoUrl: meta.lastPhotoUrl || '',
          lastPhotoAt: meta.lastPhotoAt || ''
        });
      }

      hasMore = page.has_more;
      if (hasMore && page.data.length) startingAfter = page.data[page.data.length - 1].id;
    }

    return res.status(200).json({ members });
  } catch (err) {
    console.error('members fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
};
