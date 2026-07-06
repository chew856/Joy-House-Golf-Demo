// Supabase access for the server (API routes / webhook).
// Uses the SERVICE-ROLE key, which bypasses Row Level Security — server-only, never shipped to the browser.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const dbEnabled = Boolean(URL && SERVICE_KEY);

// Lazily create a singleton admin client (or null when not configured yet).
let _admin = null;
export function admin() {
  if (!dbEnabled) return null;
  if (!_admin) _admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
  return _admin;
}

// Read the single settings row (or null if DB not configured / not seeded).
export async function getSettings() {
  const db = admin();
  if (!db) return null;
  const { data, error } = await db.from('settings').select('*').eq('id', 1).single();
  if (error) { console.error('getSettings:', error.message); return null; }
  return data;
}

// All schedule overrides that apply on a given ISO date (closures, special hours,
// and time-range blocks). An override applies when it is active and the date falls
// inside [override_date, end_date || override_date].
export async function getOverridesForDate(dateISO) {
  const db = admin();
  if (!db) return [];
  const { data, error } = await db
    .from('schedule_overrides')
    .select('*')
    .lte('override_date', dateISO)
    .order('created_at');
  if (error) { console.error('getOverridesForDate:', error.message); return []; }
  return (data || []).filter((o) =>
    o.is_active !== false && dateISO >= o.override_date && dateISO <= (o.end_date || o.override_date));
}

// Active (non-cancelled) bookings for a given ISO date — used to compute availability.
export async function getBookingsForDate(dateISO) {
  const db = admin();
  if (!db) return [];
  const { data, error } = await db
    .from('bookings')
    .select('bay_id,start_min,end_min,status')
    .eq('booking_date', dateISO)
    .neq('status', 'cancelled');
  if (error) { console.error('getBookingsForDate:', error.message); return []; }
  return data || [];
}

// Insert a confirmed booking (used by the Stripe webhook). The DB exclusion constraint
// guarantees no overlap; a conflict surfaces as an error we log and return.
export async function insertBooking(row) {
  const db = admin();
  if (!db) return { error: 'DB not configured' };
  const { error } = await db.from('bookings').insert(row);
  if (error) console.error('insertBooking:', error.message);
  return { error: error?.message || null };
}
