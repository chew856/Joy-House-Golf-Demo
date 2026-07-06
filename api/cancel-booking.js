import { admin } from '../lib/db.js';
import { hoursUntilBooking } from '../lib/booking.js';

// Customer self-service cancellation. Enforces the 24-hour policy on the server so it
// can't be bypassed from the browser.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  const id = (req.body && req.body.id) || '';
  if (!/^[0-9a-fA-F-]{10,}$/.test(id)) return res.status(400).json({ ok: false, error: 'Invalid request.' });
  const db = admin();
  if (!db) return res.status(503).json({ ok: false, error: 'Not configured.' });

  const { data, error } = await db
    .from('bookings')
    .select('id,booking_date,start_min,status')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return res.status(404).json({ ok: false, error: 'Booking not found.' });

  if (data.status === 'cancelled') return res.status(200).json({ ok: true, already: true });
  if (data.status !== 'confirmed') return res.status(400).json({ ok: false, error: "This booking can't be cancelled online." });

  const hoursUntil = hoursUntilBooking(data.booking_date, data.start_min);
  if (hoursUntil < 24) {
    return res.status(403).json({
      ok: false,
      code: 'too_late',
      error: 'Cancellations must be made at least 24 hours before your tee time. Please call the shop to cancel.',
    });
  }

  // Try to record the cancellation time; fall back to a plain status update if the column
  // isn't there yet (migration 0005 not run).
  let upd = await db.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', id);
  if (upd.error && /cancelled_at/.test(upd.error.message || '')) {
    upd = await db.from('bookings').update({ status: 'cancelled' }).eq('id', id);
  }
  if (upd.error) return res.status(500).json({ ok: false, error: upd.error.message });
  res.status(200).json({ ok: true });
}
