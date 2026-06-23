// Shared booking/pricing logic + Stripe key helpers.
// Used by both the local Express server (server.js) and the Vercel functions (api/*).
// The browser never sets the price — it's always recomputed here.

export const CONFIG = {
  bays: {
    B1: 'The Tee Time Tavern Bay',
    B2: 'The Bunker Bistro Bay',
    B3: 'The Bogey Barn Bay',
    B4: 'The Mulligan Manor Bay',
    B5: 'The Sunset Sipper Bay',
  },
  // [openHour, closeHour] by weekday (0 = Sun … 6 = Sat)
  hours: { 0: [9, 20], 1: [15, 23], 2: [11, 23], 3: [11, 23], 4: [11, 23], 5: [11, 23], 6: [9, 23] },
  slotStep: 30,
  peakStartHour: 17,
  maxParty: 4,
  currency: 'cad',
};

export function rateFor(weekday, hour) {
  const weekend = weekday === 0 || weekday === 6;
  const peak = hour >= CONFIG.peakStartHour;
  if (weekend) return peak ? 36 : 30;
  return peak ? 32 : 25;
}

// Validate the requested slot and return the price in cents. Throws on anything invalid.
export function priceForBooking({ dateISO, bayId, startMin, endMin }) {
  if (!CONFIG.bays[bayId]) throw new Error('Unknown bay');
  const date = new Date(dateISO + 'T00:00:00');
  if (Number.isNaN(date.getTime())) throw new Error('Bad date');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (date < today) throw new Error('Date in the past');

  const weekday = date.getDay();
  const [open, close] = CONFIG.hours[weekday];
  startMin = Number(startMin); endMin = Number(endMin);
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin)) throw new Error('Bad times');
  if (startMin % CONFIG.slotStep || endMin % CONFIG.slotStep) throw new Error('Times must align to 30 min');
  if (startMin < open * 60 || endMin > close * 60 || endMin <= startMin) throw new Error('Outside hours');

  let cents = 0;
  for (let m = startMin; m < endMin; m += CONFIG.slotStep) {
    cents += Math.round(rateFor(weekday, Math.floor(m / 60)) * 100 / (60 / CONFIG.slotStep));
  }
  return cents;
}

export const fmtMin = (m) => {
  const h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? 'AM' : 'PM', hh = h % 12 || 12;
  return `${hh}:${String(mm).padStart(2, '0')} ${ap}`;
};

export function summaryFor({ dateISO, startMin, endMin, players }) {
  const dateLabel = new Date(dateISO + 'T00:00:00')
    .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return `${dateLabel} · ${fmtMin(Number(startMin))}–${fmtMin(Number(endMin))} · ${players} ${players > 1 ? 'players' : 'player'}`;
}

// Stripe key gating. This is a prototype — LIVE keys are refused so it can never charge real cards.
const isLiveKey = (k) => !!k && k.includes('_live_');
const looksTestKey = (k, prefixes) =>
  !!k && !k.includes('xxx') && k.includes('test') && prefixes.some((p) => k.startsWith(p));

export function stripeStatus(env) {
  const secretKey = env.STRIPE_SECRET_KEY;
  const publishableKey = env.STRIPE_PUBLISHABLE_KEY;
  const hasLive = isLiveKey(secretKey) || isLiveKey(publishableKey);
  const enabled = !hasLive && looksTestKey(secretKey, ['rk_', 'sk_']) && looksTestKey(publishableKey, ['pk_']);
  return { enabled, hasLive, secretKey, publishableKey };
}
