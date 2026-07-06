// Replace ALL booking statuses with the exact set + colors from the client's real
// GolfBooking portal (joyhousegolf.golfbooking.ca/admin/statuses.php).
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.  Run: node scripts/seed-statuses.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Faithful transcription of both screenshots.
// kind is also the section marker (kind has no booking-logic use, so it doubles as scope):
//   'booking'         = booking/workflow status (portal list 2 — colour only, no Open/Closed)
//   'open' / 'closed' = schedule/tee-sheet status (portal list 1 — has the Open/Closed toggle)
const STATUSES = [
  // — Booking / workflow statuses —
  { label: 'Booked',                        color: '#f3665e', kind: 'booking' },
  { label: 'Held',                          color: '#ed3623', kind: 'booking' },
  { label: 'Promotion',                     color: '#91226e', kind: 'booking' },
  { label: 'Call-In',                       color: '#ea331f', kind: 'booking' },
  { label: 'Walk-In',                       color: '#ed3623', kind: 'booking' },
  { label: 'Booked (Pending Confirmation)', color: '#ce9f1c', kind: 'booking' },
  { label: 'Group Booking',                 color: '#5a3d3a', kind: 'booking' },
  { label: 'Recurring Booking (Daily)',     color: '#ed3623', kind: 'booking' },
  { label: 'Recurring Booking (Weekly)',    color: '#715753', kind: 'booking' },
  { label: 'Recurring Booking (Monthly)',   color: '#ed3623', kind: 'booking' },
  { label: 'Recurring Booking (Annually)',  color: '#ed3623', kind: 'booking' },
  { label: 'Booked (Payment Accepted)',     color: '#ed3623', kind: 'booking' },
  { label: 'Checked In',                    color: '#8099ff', kind: 'booking' },
  { label: 'Paid',                          color: '#9780ff', kind: 'booking' },
  { label: 'Held (Payment Pending)',        color: '#a08b03', kind: 'booking' },
  // — Schedule / tee-sheet statuses —
  { label: 'Break',                         color: '#c23d3d', kind: 'closed'  },
  { label: 'Closed',                        color: '#ff0000', kind: 'closed'  },
  { label: 'Grand Opening',                 color: '#fe7d05', kind: 'closed'  },
  { label: 'Happy Hour',                    color: '#1398aa', kind: 'open'    },
  { label: 'Lunch Break Golf',              color: '#808811', kind: 'open'    },
  { label: 'Maintenance',                   color: '#000000', kind: 'closed'  },
  { label: 'Open',                          color: '#5fb448', kind: 'open'    },
  { label: 'Open (Prime Rate)',             color: '#329532', kind: 'open'    },
  { label: 'Please call 204-815-4142 for reservations', color: '#329532', kind: 'closed' },
  { label: 'Reserved',                      color: '#f17b3b', kind: 'closed'  },
];

// Wipe the table (delete every row; the where-clause is a no-op filter that matches all).
const del = await sb.from('booking_statuses').delete().not('id', 'is', null);
if (del.error) { console.error('delete failed:', del.error.message); process.exit(1); }

const rows = STATUSES.map((s, i) => ({ ...s, sort: i }));
const ins = await sb.from('booking_statuses').insert(rows).select('label,color,kind,sort');
if (ins.error) { console.error('insert failed:', ins.error.message); process.exit(1); }

console.log(`Replaced booking_statuses with ${ins.data.length} rows:`);
for (const r of ins.data.sort((a, b) => a.sort - b.sort))
  console.log(`  ${String(r.sort).padStart(2)}  ${r.color}  ${r.kind.padEnd(6)}  ${r.label}`);
