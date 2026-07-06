import Stripe from 'stripe';
import { priceForBooking, summaryFor, stripeStatus, normalizeSettings, bayName, overrideEffects, overrideConflicts, weeklyStatusConflicts } from '../lib/booking.js';
import { getSettings, getBookingsForDate, getOverridesForDate } from '../lib/db.js';

// Creates a PaymentIntent for a booking. Price + availability are validated server-side.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { enabled, secretKey } = stripeStatus(process.env);
  if (!enabled) return res.status(503).json({ error: 'Stripe not configured' });

  try {
    const stripe = new Stripe(secretKey);
    const { dateISO, bayId, startMin, endMin, party } = req.body || {};

    const settings = normalizeSettings(await getSettings());
    const overrides = await getOverridesForDate(dateISO);
    // Resolve schedule overrides up front: dateHours lets priceForBooking accept widened
    // special hours; overrideConflicts rejects blocked/closed slots.
    const fx = overrideEffects(overrides, settings, dateISO);
    const amount = priceForBooking({ settings, dateISO, bayId, startMin, endMin, dateHours: fx.dateHours });
    const players = Math.min(Math.max(parseInt(party, 10) || 1, 1), settings.maxParty);

    // Reject if the slot was already taken (defense in depth; the DB constraint is the final guard).
    const conflict = (await getBookingsForDate(dateISO))
      .some((b) => b.bay_id === bayId && Number(startMin) < b.end_min && Number(endMin) > b.start_min);
    if (conflict) return res.status(409).json({ error: 'That time was just booked — pick another slot.' });

    if (overrideConflicts(fx, settings, dateISO, bayId, Number(startMin), Number(endMin)) ||
        weeklyStatusConflicts(settings, overrides, dateISO, bayId, Number(startMin), Number(endMin))) {
      return res.status(409).json({ error: 'That time is unavailable — pick another slot.' });
    }

    const pi = await stripe.paymentIntents.create({
      amount,
      currency: settings.currency,
      automatic_payment_methods: { enabled: true }, // dynamic payment methods, no hardcoded card-only
      description: `${bayName(settings, bayId)} — simulator session`,
      metadata: {
        bayId,
        bayName: bayName(settings, bayId),
        dateISO,
        startMin: String(startMin),
        endMin: String(endMin),
        players: String(players),
        summary: summaryFor({ dateISO, startMin, endMin, players }),
      },
    });

    res.status(200).json({ clientSecret: pi.client_secret, amount });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
