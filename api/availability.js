import { getSettings, getBookingsForDate, getOverridesForDate, cleanupExpiredHolds } from '../lib/db.js';
import { normalizeSettings, overrideEffects, weeklyStatusBlocked } from '../lib/booking.js';

// Public availability: live settings + busy time ranges per bay for a date (no customer data).
export default async function handler(req, res) {
  const row = await getSettings();
  if (!row) return res.status(200).json({ dbEnabled: false });

  const settings = normalizeSettings(row);
  const dateISO = (req.query && req.query.date) || '';
  const booked = {};
  const closed = {};    // ranges closed by the recurring weekly status pattern (labelled distinctly)
  const held = {};      // live cart holds — shown to other users as "Held"
  let dateHours = null; // effective [open,close] for this exact date, or [0,0] when closed by override
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    await cleanupExpiredHolds();
    for (const b of await getBookingsForDate(dateISO)) {
      (booked[b.bay_id] ||= []).push([b.start_min, b.end_min]);
      if (b.status === 'held') (held[b.bay_id] ||= []).push([b.start_min, b.end_min]);
    }
    const overrides = await getOverridesForDate(dateISO);
    // Overrides: venue-wide hour changes surface as dateHours; per-bay blocks are merged
    // into the busy ranges so those slots simply read as unavailable (no reason leaked).
    const fx = overrideEffects(overrides, settings, dateISO);
    dateHours = fx.dateHours;
    for (const [bayId, ranges] of Object.entries(fx.blocked)) {
      for (const r of ranges) (booked[bayId] ||= []).push(r);
    }
    // Recurring weekly "Closed" bands also make time unavailable — merge them into busy
    // ranges (so they can't be booked) and surface them separately for a clearer label.
    for (const [bayId, ranges] of Object.entries(weeklyStatusBlocked(settings, overrides, dateISO))) {
      for (const r of ranges) { (booked[bayId] ||= []).push(r); (closed[bayId] ||= []).push(r); }
    }
  }

  res.status(200).json({
    dbEnabled: true,
    settings: {
      bays: settings.bays.filter((b) => !b.holding),   // holding bays are manager-only, never bookable online
      hours: settings.hours,
      slotStep: settings.slotStep,
      minMins: settings.minMins,
      maxParty: settings.maxParty,
      peakStartHour: settings.peakStartHour,
      rates: settings.rates,
      bayRates: settings.bayRates,
    },
    dateHours,
    booked,
    closed,
    held,
  });
}
