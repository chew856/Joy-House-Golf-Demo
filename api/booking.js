import { admin, getSettings } from '../lib/db.js';
import { normalizeSettings, bayName, fmtMin, hoursUntilBooking } from '../lib/booking.js';

// Public, read-only lookup of a single booking by its id (the value placed in the
// customer's self-service link / SMS). Returns only customer-safe fields.
export default async function handler(req, res) {
  const id = (req.query && req.query.id) || '';
  if (!/^[0-9a-fA-F-]{10,}$/.test(id)) return res.status(400).json({ ok: false, error: 'Invalid link.' });
  const db = admin();
  if (!db) return res.status(503).json({ ok: false, error: 'Not configured.' });

  const { data, error } = await db
    .from('bookings')
    .select('id,bay_id,booking_date,start_min,end_min,status,customer_name')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return res.status(404).json({ ok: false, error: 'Booking not found.' });

  const settings = normalizeSettings(await getSettings());
  const hoursUntil = hoursUntilBooking(data.booking_date, data.start_min);
  res.status(200).json({
    ok: true,
    booking: {
      id: data.id,
      bay: bayName(settings, data.bay_id) || data.bay_id,
      booking_date: data.booking_date,
      start: fmtMin(data.start_min),
      end: fmtMin(data.end_min),
      status: data.status,
      customerName: data.customer_name || null,
      hoursUntil,
      canCancel: data.status === 'confirmed' && hoursUntil >= 24,
    },
  });
}
