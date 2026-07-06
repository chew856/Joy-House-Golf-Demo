import Stripe from 'stripe';
import { stripeStatus, normalizeSettings } from '../lib/booking.js';
import { insertBooking, getSettings } from '../lib/db.js';

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Source of truth: only record a confirmed booking here, never on the client redirect.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { enabled, secretKey } = stripeStatus(process.env);
  if (!enabled) return res.status(200).json({ received: true });

  const stripe = new Stripe(secretKey);
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    if (whsec) {
      const raw = req.body && Buffer.isBuffer(req.body) ? req.body : await readRaw(req);
      event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], whsec);
    } else {
      // No signing secret configured — accept the parsed event (fine for a test-mode prototype).
      event = req.body && req.body.type ? req.body : JSON.parse((await readRaw(req)).toString());
    }
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const md = pi.metadata || {};
    if (md.dateISO && md.bayId) {
      // Pull the customer's contact info from the charge's billing details.
      let name = null, email = pi.receipt_email || null, phone = null;
      try {
        if (pi.latest_charge) {
          const ch = await stripe.charges.retrieve(pi.latest_charge);
          const bd = ch.billing_details || {};
          name = bd.name || null;
          email = email || bd.email || null;
          phone = bd.phone || null;
        }
      } catch (_) { /* best-effort */ }

      const onlineLabel = normalizeSettings(await getSettings()).onlineStatusLabel;   // manager-chosen default
      const { error } = await insertBooking({
        bay_id: md.bayId,
        booking_date: md.dateISO,
        start_min: Number(md.startMin),
        end_min: Number(md.endMin),
        status: 'confirmed',
        status_label: onlineLabel || null,   // workflow label for a self-booked online reservation
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        amount_cents: pi.amount,
        stripe_payment_intent: pi.id,
        source: 'online',
      });
      console.log(error
        ? `⚠ Booking insert failed (${md.summary}): ${error}`
        : `✅ Booking PAID & saved — ${md.bayName} · ${md.summary}`);
    }
  }
  res.status(200).json({ received: true });
}
