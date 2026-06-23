import Stripe from 'stripe';
import { stripeStatus } from '../lib/booking.js';

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Source of truth: only treat a booking as paid here, never on the client redirect.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { enabled, secretKey } = stripeStatus(process.env);
  if (!enabled) return res.status(200).json({ received: true });

  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    if (whsec) {
      const raw = req.body && Buffer.isBuffer(req.body) ? req.body : await readRaw(req);
      const stripe = new Stripe(secretKey);
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
    console.log(`✅ Booking PAID — ${pi.metadata?.bayName} · ${pi.metadata?.summary}`);
    // TODO: in production, write the confirmed booking to your database here.
  }
  res.status(200).json({ received: true });
}
