import { stripeStatus } from '../lib/booking.js';

// Tells the browser whether Stripe is live (+ publishable key) and hands the admin page
// the PUBLIC Supabase config (URL + anon key) for email/password login.
export default function handler(req, res) {
  const { enabled, publishableKey } = stripeStatus(process.env);
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const dbEnabled = Boolean(url && process.env.SUPABASE_SERVICE_ROLE_KEY);
  res.status(200).json({
    stripeEnabled: enabled,
    publishableKey: enabled ? publishableKey : null,
    dbEnabled,
    supabase: url && anonKey ? { url, anonKey } : null,
  });
}
