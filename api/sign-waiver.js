import { admin } from '../lib/db.js';

// Find the customer this waiver belongs to: an explicit customer id, the contact on a booking,
// or an email/phone match. Only creates a new customer row when `create` is true (i.e. on submit,
// never on a status check). The waiver lives on the customer so it covers all their visits (clause 12).
async function resolveCustomer(db, { customerId, bookingId, email, phone, name }, create = false) {
  if (customerId) {
    const { data } = await db.from('customers').select('*').eq('id', customerId).maybeSingle();
    if (data) return data;
  }
  let e = (email || '').trim().toLowerCase(), p = (phone || '').trim(), n = (name || '').trim();
  if (bookingId && /^[0-9a-fA-F-]{10,}$/.test(bookingId)) {
    const { data: bk } = await db.from('bookings')
      .select('customer_email,customer_phone,customer_name').eq('id', bookingId).maybeSingle();
    if (bk) { e = e || (bk.customer_email || '').trim().toLowerCase(); p = p || (bk.customer_phone || '').trim(); n = n || (bk.customer_name || '').trim(); }
  }
  if (e) { const { data } = await db.from('customers').select('*').ilike('email', e).limit(1); if (data && data[0]) return data[0]; }
  if (p) { const { data } = await db.from('customers').select('*').eq('phone', p).limit(1); if (data && data[0]) return data[0]; }
  if (create && (e || p || n)) {
    const { data, error } = await db.from('customers')
      .insert({ name: n || null, email: e || null, phone: p || null }).select('*').single();
    if (!error) return data;
  }
  return null;
}

export default async function handler(req, res) {
  const db = admin();
  if (!db) return res.status(503).json({ ok: false, error: 'Waivers are not configured yet.' });

  // Status check — does this person already have a waiver on file?
  if (req.method === 'GET') {
    const q = req.query || {};
    const cust = await resolveCustomer(db, { customerId: q.c, bookingId: q.b, email: q.e }, false);
    if (!cust) return res.status(200).json({ ok: true, signed: false });
    return res.status(200).json({
      ok: true,
      signed: !!cust.waiver_signed_at,
      name: cust.waiver_name || cust.name || null,
      signedAt: cust.waiver_signed_at || null,
    });
  }

  // Sign it.
  if (req.method === 'POST') {
    const { name, version, customerId, bookingId, email, phone } = req.body || {};
    const signer = (name || '').trim();
    if (signer.length < 2) return res.status(400).json({ ok: false, error: 'Please enter your full name to sign.' });

    const cust = await resolveCustomer(db, { customerId, bookingId, email, phone, name: signer }, true);
    if (!cust) return res.status(400).json({ ok: false, error: 'We couldn’t match this to a customer. Please book first, or ask the shop to add you.' });

    const signedAt = new Date().toISOString();
    const code = 'W-' + signedAt.slice(0, 10).replace(/-/g, '') + '-' + String(cust.id).replace(/-/g, '').slice(0, 4).toUpperCase();
    const patch = { waiver_signed_at: signedAt, waiver_name: signer, waiver_version: version || 'v2', waiver_code: code };
    let upd = await db.from('customers').update(patch).eq('id', cust.id);
    if (upd.error && /waiver_name|waiver_version|column/i.test(upd.error.message || '')) {
      // Migration 0013 not applied yet — still record the essentials so the waiver is on file.
      upd = await db.from('customers').update({ waiver_signed_at: signedAt, waiver_code: code }).eq('id', cust.id);
    }
    if (upd.error) return res.status(500).json({ ok: false, error: upd.error.message });
    return res.status(200).json({ ok: true, signedAt });
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
}
