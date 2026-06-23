import Stripe from 'stripe';
import { CONFIG, priceForBooking, summaryFor, stripeStatus } from '../lib/booking.js';

// Creates a PaymentIntent for a booking. Price is recomputed server-side.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { enabled, secretKey } = stripeStatus(process.env);
  if (!enabled) return res.status(503).json({ error: 'Stripe not configured' });

  try {
    const stripe = new Stripe(secretKey);
    const { dateISO, bayId, startMin, endMin, party } = req.body || {};
    const amount = priceForBooking({ dateISO, bayId, startMin, endMin });
    const players = Math.min(Math.max(parseInt(party, 10) || 1, 1), CONFIG.maxParty);
    const bayName = CONFIG.bays[bayId];

    const pi = await stripe.paymentIntents.create({
      amount,
      currency: CONFIG.currency,
      automatic_payment_methods: { enabled: true }, // dynamic payment methods, no hardcoded card-only
      description: `${bayName} — simulator session`,
      metadata: { bayId, bayName, summary: summaryFor({ dateISO, startMin, endMin, players }), players: String(players) },
    });

    res.status(200).json({ clientSecret: pi.client_secret, amount });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
