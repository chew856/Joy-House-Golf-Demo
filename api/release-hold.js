import { releaseHold } from '../lib/db.js';

// Release a cart hold when checkout is closed/abandoned before payment.
// Best-effort — the 5-minute TTL (cleanupExpiredHolds) is the real backstop.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { dateISO, bayId, startMin, endMin } = req.body || {};
  if (dateISO && bayId) await releaseHold({ dateISO, bayId, startMin: Number(startMin), endMin: Number(endMin) });
  res.status(200).json({ ok: true });
}
