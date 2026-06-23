import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, priceForBooking, summaryFor, stripeStatus } from './lib/booking.js';

// Local dev server. On Vercel the same logic runs as serverless functions in /api.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { PORT = 4242, STRIPE_WEBHOOK_SECRET } = process.env;

const { enabled: stripeEnabled, hasLive, secretKey, publishableKey } = stripeStatus(process.env);
const stripe = stripeEnabled ? new Stripe(secretKey) : null;

if (hasLive) {
  console.error('\n⛔  LIVE Stripe keys detected in .env — refusing to start Stripe.');
  console.error('   This is a prototype: use TEST keys (sk_test_ / rk_test_ / pk_test_) only.\n');
} else if (!stripeEnabled) {
  console.warn('\n⚠  Stripe keys not set — running in SIMULATED checkout mode.');
  console.warn('   Copy .env.example to .env and add your test keys to enable real Stripe.\n');
}

const app = express();

// Webhook needs the raw body, so register it BEFORE express.json().
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripeEnabled) return res.json({ received: true });
  let event;
  if (STRIPE_WEBHOOK_SECRET) {
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    event = JSON.parse(req.body.toString());
  }
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    console.log(`✅ Booking PAID — ${pi.metadata?.bayName} · ${pi.metadata?.summary}`);
  }
  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'demo')));

app.get('/api/config', (_req, res) => {
  res.json({ stripeEnabled, publishableKey: stripeEnabled ? publishableKey : null });
});

app.post('/api/create-payment-intent', async (req, res) => {
  if (!stripeEnabled) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    const { dateISO, bayId, startMin, endMin, party } = req.body;
    const amount = priceForBooking({ dateISO, bayId, startMin, endMin });
    const players = Math.min(Math.max(parseInt(party, 10) || 1, 1), CONFIG.maxParty);
    const bayName = CONFIG.bays[bayId];
    const pi = await stripe.paymentIntents.create({
      amount,
      currency: CONFIG.currency,
      automatic_payment_methods: { enabled: true },
      description: `${bayName} — simulator session`,
      metadata: { bayId, bayName, summary: summaryFor({ dateISO, startMin, endMin, players }), players: String(players) },
    });
    res.json({ clientSecret: pi.client_secret, amount });
  } catch (err) {
    console.error('create-payment-intent:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🏌  Joy House Golf booking demo running at  http://localhost:${PORT}\n`);
});
