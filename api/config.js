import { stripeStatus } from '../lib/booking.js';

// Tells the browser whether Stripe is live and hands it the publishable key.
export default function handler(req, res) {
  const { enabled, publishableKey } = stripeStatus(process.env);
  res.status(200).json({ stripeEnabled: enabled, publishableKey: enabled ? publishableKey : null });
}
